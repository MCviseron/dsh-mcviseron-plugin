import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'

/**
 * Public component configuration. Every field is optional; invalid values fail
 * at plugin load instead of degrading.
 */
export interface TaskGuardConfig {
  /** Master switch. Defaults to `true`. */
  enabled?: boolean
  /** Language of the model-facing guard text. Defaults to `zh`. */
  locale?: 'zh' | 'en'
  /** Successful tool calls allowed after a `todo_write` before the first notice. Defaults to 5. */
  staleAfterCalls?: number
  /** Tool calls between later notices; `0` sends the first notice only. Defaults to 4. */
  repeatEveryCalls?: number
  /** Hard stop after this many stale calls; `0` disables blocking. Defaults to 0. */
  blockAfterCalls?: number
  /**
   * Reject a `todo_write` that leaves pending work with no `in_progress` task.
   * Off by default: the default mode only adds an advisory notice, so a write
   * is never turned into a tool error.
   */
  rejectMissingActive?: boolean
  /**
   * Notice source kind. `auto` (default) reads `session.header.version`:
   * format v3 uses `{ kind: 'plugin', plugin: 'task-guard' }`, v4 uses
   * `{ kind: 'plugin:task-guard' }`. Force `v3`/`v4` only for unusual
   * deployments.
   */
  sourceKind?: 'auto' | 'v3' | 'v4'
  /** Only these tool names advance the stale counter; empty covers every tool. */
  include?: string[]
  /** Tool names that never advance the stale counter. Defaults to `todo_write`, `ask_user_question`. */
  exclude?: string[]
  /** Remaining items quoted in a notice. Defaults to 6. */
  maxListItems?: number
  /**
   * Watch the assistant's streamed text/reasoning for a step-intent phrase
   * ("Now I will …", "接下来我会 …") that matches a pending todo, and attach one
   * targeted advisory notice per step. Defaults to `true`; advisory only.
   */
  detectStepIntent?: boolean
  /** Translate English todo titles in notices into Chinese for display. Defaults to `true`. */
  translateTodoContent?: boolean
  /** Timeout for one batch todo translation, 500–15000ms. Defaults to 3000. */
  todoTranslationTimeoutMs?: number
}

type TodoStatus = 'pending' | 'in_progress' | 'completed'

interface TodoItem {
  content: string
  status: TodoStatus
}

interface PluginSourceV4 {
  kind: 'plugin:task-guard'
  form: 'notice'
  summary: string
}

interface PluginSourceV3 {
  kind: 'plugin'
  plugin: 'task-guard'
  form: 'notice'
  summary: string
}

type PluginSource = PluginSourceV4 | PluginSourceV3

interface NoticeMessage {
  id: string
  role: 'user'
  content: [{ type: 'text'; text: string }]
  source: PluginSource
}

interface AgentLike {
  readonly session?: {
    readonly id?: unknown
    readonly header?: { readonly version?: unknown }
    readonly requestHeader?: () => unknown
  }
}

/** One transient assistant frame (see `agent/assistant-stream`). */
interface AssistantFrame {
  readonly type?: unknown
  readonly attemptId?: unknown
  readonly chunk?: { readonly type?: unknown; readonly text?: unknown; readonly reason?: { readonly kind?: unknown } }
}

interface AssistantStreamPayload {
  readonly frame?: AssistantFrame
}

interface ToolExecutionLike {
  readonly name: string
  readonly arguments: unknown
  readonly parent?: unknown
  readonly agent?: AgentLike
}

interface ToolResultLike {
  readonly isError: boolean
}

type PreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason?: string }

interface PostToolDecision {
  readonly kind: 'accept' | 'block'
  readonly additionalContexts?: NoticeMessage[]
  readonly [key: string]: unknown
}

interface PreStepPayload {
  agent: AgentLike
}

/** The subset of the Cordis plugin context this component needs. */
export interface TaskGuardBus {
  on(
    event: 'tools/pre-execute',
    listener: (exec: ToolExecutionLike, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision>,
  ): unknown
  on(
    event: 'tools/post-execute',
    listener: (exec: ToolExecutionLike, result: ToolResultLike, next: () => Promise<PostToolDecision>) => Promise<PostToolDecision>,
  ): unknown
  on(
    event: 'agent/pre-step',
    listener: (payload: PreStepPayload, next: () => Promise<unknown>) => Promise<unknown>,
  ): unknown
  on(
    event: 'session/event',
    listener: (session: { id?: unknown }, event: { type: string; data?: unknown }) => void,
  ): unknown
  on(
    event: 'agent/assistant-stream',
    listener: (payload: AssistantStreamPayload) => void,
  ): unknown
}

interface SessionState {
  todos: TodoItem[] | null
  callsSinceWrite: number
  remindersSent: number
  reminderDeliveredThisStep: boolean
  /** One step-intent notice per step at most. */
  intentNotifiedThisStep: boolean
}

interface ResolvedConfig {
  enabled: boolean
  locale: 'zh' | 'en'
  staleAfterCalls: number
  repeatEveryCalls: number
  blockAfterCalls: number
  rejectMissingActive: boolean
  sourceKind: 'auto' | 'v3' | 'v4'
  include: RegExp[]
  exclude: RegExp[]
  maxListItems: number
  detectStepIntent: boolean
  translateTodoContent: boolean
  todoTranslationTimeoutMs: number
}

const SUMMARY_MAX_CHARS = 120
const DEFAULT_EXCLUDES = ['todo_write', 'ask_user_question']
const STATUSES: ReadonlySet<string> = new Set(['pending', 'in_progress', 'completed'])
const CONFIG_KEYS: ReadonlySet<string> = new Set([
  'enabled',
  'locale',
  'staleAfterCalls',
  'repeatEveryCalls',
  'blockAfterCalls',
  'rejectMissingActive',
  'sourceKind',
  'include',
  'exclude',
  'maxListItems',
  'detectStepIntent',
  'translateTodoContent',
  'todoTranslationTimeoutMs',
])

/** Whether text already contains CJK characters (no translation needed). */
function containsCjk(text: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(text)
}

/** Lowercase and strip markdown noise for token comparison. */
function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[\`*_#>\[\](){}]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Comparable tokens: latin words of 3+ chars plus CJK bigrams. */
function tokensOf(value: string): string[] {
  const normalized = normalizeText(value)
  const tokens: string[] = []
  for (const token of normalized.split(/[^a-z0-9\u4e00-\u9fff]+/)) {
    if (token.length >= 3) tokens.push(token)
  }
  const chars = Array.from(normalized).filter(char => /[\u4e00-\u9fff]/.test(char))
  for (let index = 0; index + 1 < chars.length; index += 1) tokens.push(chars[index] + chars[index + 1])
  return tokens
}

const INTENT_MARKERS: RegExp[] = [
  /\b(?:now|next|then)\s*,?\s*i(?:'ll| will| am going to|'m going to)\b([^\n]{2,160})/gi,
  /\bi(?:'ll| will| am going to|'m going to)\s+(?:now\s+)?([^\n]{2,160})/gi,
  /\blet me\s+(?:now\s+)?([^\n]{2,160})/gi,
  /(?:接下来|下一步|现在|然后|下面)(?:我会|我将|我要|我来|就开始|开始|准备)([^\n。；;]{2,120})/g,
]

/** One matched step intent. */
export interface StepIntentMatch {
  todo: TodoItem
  phrase: string
  score: number
}

/** The step-intent phrases found in streamed text, in stream order. */
function intentPhrases(text: string): string[] {
  const found: Array<{ index: number; phrase: string }> = []
  for (const marker of INTENT_MARKERS) {
    marker.lastIndex = 0
    let match = marker.exec(text)
    while (match !== null) {
      const raw = (match[1] ?? '').trim()
      const phrase = raw.replace(/^[：:,\-\s]+/, '').split(/[.。!！?？;；\n]/)[0].trim()
      if (phrase.length >= 2) found.push({ index: match.index, phrase })
      match = marker.exec(text)
    }
  }
  found.sort((left, right) => left.index - right.index)
  return found.map(item => item.phrase)
}

/**
 * Match the last "Now I will ..." / "接下来我会 ..." phrase against pending
 * todos. Advisory only: the caller decides whether to attach a notice.
 *
 * @param text - streamed assistant text/reasoning for the current step.
 * @param todos - the current plan.
 * @returns the best pending match, if any.
 */
export function detectStepIntent(text: string, todos: TodoItem[]): StepIntentMatch | undefined {
  if (text.length === 0 || todos.length === 0) return undefined
  const phrases = intentPhrases(text).slice(-3)
  if (phrases.length === 0) return undefined
  let best: StepIntentMatch | undefined
  for (const phrase of phrases) {
    const phraseNormalized = normalizeText(phrase)
    const phraseTokens = new Set(tokensOf(phrase))
    for (const todo of todos) {
      if (todo.status !== 'pending') continue
      const contentNormalized = normalizeText(todo.content)
      let score = 0
      if (contentNormalized.length >= 4 && (phraseNormalized.includes(contentNormalized) || contentNormalized.includes(phraseNormalized))) {
        score = 1
      } else {
        const contentTokens = tokensOf(todo.content)
        if (contentTokens.length === 0) continue
        let shared = 0
        for (const token of contentTokens) if (phraseTokens.has(token)) shared += 1
        score = shared / contentTokens.length
        if (shared < 2 && score < 0.6) continue
      }
      if (score >= 0.6 && (best === undefined || score > best.score)) best = { todo, phrase, score }
    }
  }
  return best
}

/** Display translation settings for one notice. */
interface NoticeContext {
  readonly llm?: { stream?: (options: unknown) => unknown }
  readonly route?: { provider: string; model: string }
  readonly translate: boolean
  readonly timeoutMs: number
}

function serviceOf(scope: Context, name: string): unknown {
  try {
    const direct = (scope as unknown as Record<string, unknown>)[name]
    if (direct !== undefined) return direct
  } catch {
    /* fall through to the registry */
  }
  try {
    const get = (scope as unknown as { get?: (key: string) => unknown }).get
    return typeof get === 'function' ? get.call(scope, name) : undefined
  } catch {
    return undefined
  }
}

function sessionRoute(agent: AgentLike | undefined): { provider: string; model: string } | undefined {
  try {
    const read = agent?.session?.requestHeader
    const header = typeof read === 'function' ? read.call(agent?.session) : undefined
    const config = (header as { config?: { provider?: unknown; model?: unknown } } | null)?.config
    const provider = config?.provider
    const model = config?.model
    if (typeof provider === 'string' && provider.length > 0 && typeof model === 'string' && model.length > 0) {
      return { provider, model }
    }
  } catch {
    /* a host without a readable header simply has no route */
  }
  return undefined
}

function noticeContext(agent: AgentLike | undefined, config: ResolvedConfig, ctx: Context): NoticeContext {
  const route = sessionRoute(agent)
  const llm = serviceOf(ctx, 'llm') as NoticeContext['llm']
  return {
    llm,
    route,
    translate: config.translateTodoContent && route !== undefined && llm !== undefined,
    timeoutMs: config.todoTranslationTimeoutMs,
  }
}

const TRANSLATION_CACHE_LIMIT = 256
const translationCache = new Map<string, string>()

function parseStringArray(raw: string): string[] | undefined {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start < 0 || end <= start) return undefined
  try {
    const value = JSON.parse(raw.slice(start, end + 1)) as unknown
    if (Array.isArray(value) && value.every(item => typeof item === 'string')) return value as string[]
  } catch {
    /* malformed model output falls back to the original titles */
  }
  return undefined
}

async function translateBatch(contents: string[], context: NoticeContext): Promise<string[] | undefined> {
  if (context.llm === undefined || typeof context.llm.stream !== 'function' || context.route === undefined) return undefined
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('todo translation timeout')), context.timeoutMs)
  try {
    const stream = await context.llm.stream({
      provider: context.route.provider,
      model: context.route.model,
      system: 'Translate the items of a software todo list into Simplified Chinese. Output only a JSON array of strings with the same length and order. Keep code, file paths, identifiers, acronyms and URLs exactly as written.',
      messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(contents) }] }],
      temperature: 0,
      signal: controller.signal,
    })
    if (stream === null || typeof stream !== 'object') return undefined
    let text = ''
    for await (const chunk of stream as AsyncIterable<{ type?: unknown; text?: unknown; reason?: { kind?: unknown } }>) {
      if (controller.signal.aborted) return undefined
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
      if (chunk?.type === 'finish') {
        const kind = chunk.reason?.kind
        if (typeof kind === 'string' && kind !== 'stop') return undefined
      }
    }
    const parsed = parseStringArray(text)
    if (parsed === undefined || parsed.length !== contents.length) return undefined
    return parsed
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/** Race a promise against a hard timeout so a stalled stream cannot delay a notice. */
async function withTimeout<T>(value: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms)
    timer.unref?.()
  })
  try {
    return await Promise.race([value, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Translate English todo titles for display as "中文（English）". */
async function displayTodoContents(contents: string[], context: NoticeContext): Promise<string[]> {
  if (!context.translate) return contents
  const pending: string[] = []
  const seen = new Set<string>()
  for (const content of contents) {
    if (containsCjk(content) || translationCache.has(content) || seen.has(content)) continue
    seen.add(content)
    pending.push(content)
  }
  if (pending.length > 0) {
    const translated = await withTimeout(translateBatch(pending, context), context.timeoutMs + 250)
    if (translated !== undefined) {
      for (let index = 0; index < pending.length; index += 1) {
        const value = translated[index]
        if (typeof value !== 'string' || value.trim() === '') continue
        if (translationCache.size >= TRANSLATION_CACHE_LIMIT) {
          const oldest = translationCache.keys().next()
          if (oldest.done !== true) translationCache.delete(oldest.value)
        }
        translationCache.set(pending[index], value.trim())
      }
    }
  }
  return contents.map((content) => {
    const translated = translationCache.get(content)
    if (translated === undefined || containsCjk(content)) return content
    return translated + '（' + content + '）'
  })
}

/** A ready-to-send todo_write payload for the matched pending task. */
function suggestedTodoPayload(todos: TodoItem[], matched: TodoItem): string | undefined {
  const active = todos.filter(todo => todo.status === 'in_progress')
  if (active.length > 1) return undefined
  const next = todos.map(todo => ({
    content: todo.content,
    status: todo.content === matched.content ? 'in_progress' : todo.status === 'in_progress' ? 'completed' : todo.status,
  }))
  return JSON.stringify({ todos: next })
}

/**
 * Install the todo plan guard on the master plugin context.
 *
 * The guard never rewrites the model's plan on its own: it observes
 * `todo_write`, attaches advisory notices to tool results, and optionally
 * refuses writes or calls when configured to be strict.
 *
 * @param ctx - the master plugin context.
 * @param input - the `taskGuard` config group.
 */
export function installTaskGuard(ctx: Context, input?: TaskGuardConfig): void {
  const config = resolveConfig(input)
  const bus = ctx as unknown as TaskGuardBus
  const sessions = new Map<string, SessionState>()
  const intentBuffers = new Map<string, string>()

  bus.on('tools/pre-execute', async (exec, next) => {
    if (!config.enabled) return next()

    if (exec.name === 'todo_write') {
      const todos = readTodos(exec.arguments)
      if (config.rejectMissingActive && todos !== null && leavesPendingWithoutActive(todos)) {
        return { kind: 'deny', reason: denyMissingActive(todos, config) }
      }
      return next()
    }

    if (config.blockAfterCalls > 0 && exec.parent === undefined && isTracked(exec.name, config)) {
      const state = sessions.get(sessionIdOf(exec.agent))
      if (
        state?.todos != null &&
        hasUnfinished(state.todos) &&
        state.callsSinceWrite >= config.blockAfterCalls
      ) {
        return { kind: 'deny', reason: denyStale(state, config) }
      }
    }

    return next()
  })

  bus.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next()
    if (!config.enabled) return downstream

    if (exec.name === 'todo_write') {
      if (result.isError) return downstream
      const todos = readTodos(exec.arguments)
      if (todos === null) return downstream
      const sessionId = sessionIdOf(exec.agent)
      if (sessionId !== '') {
        resetState(sessions, sessionId, todos)
        intentBuffers.delete(sessionId)
      }
      if (!config.rejectMissingActive && leavesPendingWithoutActive(todos)) {
        const notice = await noticeMissingActive(
          todos,
          config,
          sourceKindFor(exec.agent, config),
          noticeContext(exec.agent, config, ctx),
        )
        return attachContext(downstream, notice)
      }
      return downstream
    }

    if (exec.parent !== undefined || result.isError || !isTracked(exec.name, config)) return downstream

    const sessionId = sessionIdOf(exec.agent)
    if (sessionId === '') return downstream
    const state = sessions.get(sessionId)
    if (state?.todos == null || !hasUnfinished(state.todos)) return downstream

    state.callsSinceWrite += 1

    // A "Now I will ..." / "接下来我会 ..." phrase that matches a pending todo is
    // the strongest signal that the plan drifted; one advisory notice per step.
    if (config.detectStepIntent && !state.intentNotifiedThisStep) {
      const match = detectStepIntent(intentBuffers.get(sessionId) ?? '', state.todos)
      if (match !== undefined) {
        state.intentNotifiedThisStep = true
        const notice = await buildIntentNotice(
          state,
          match,
          config,
          sourceKindFor(exec.agent, config),
          noticeContext(exec.agent, config, ctx),
        )
        return attachContext(downstream, notice)
      }
    }

    if (state.reminderDeliveredThisStep) return downstream

    const threshold = config.staleAfterCalls + state.remindersSent * config.repeatEveryCalls
    if (state.callsSinceWrite < threshold) return downstream
    if (config.repeatEveryCalls === 0 && state.remindersSent > 0) return downstream

    const reminder = await buildReminder(
      state,
      config,
      sourceKindFor(exec.agent, config),
      noticeContext(exec.agent, config, ctx),
    )
    if (reminder === undefined) return downstream

    state.remindersSent += 1
    state.reminderDeliveredThisStep = true
    return attachContext(downstream, reminder)
  })

  bus.on('agent/pre-step', async (payload, next) => {
    const sessionId = sessionIdOf(payload.agent)
    if (sessionId !== '') intentBuffers.delete(sessionId)
    const state = sessions.get(sessionId)
    if (state !== undefined) {
      state.reminderDeliveredThisStep = false
      state.intentNotifiedThisStep = false
    }
    return next()
  })

  bus.on('agent/assistant-stream', (payload) => {
    if (!config.enabled || !config.detectStepIntent) return
    const frame = payload?.frame
    if (frame === null || typeof frame !== 'object' || frame.type !== 'chunk') return
    const chunk = frame.chunk
    if (chunk === null || typeof chunk !== 'object') return
    if (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta') return
    if (typeof chunk.text !== 'string' || chunk.text === '') return
    const attemptId = typeof frame.attemptId === 'string' ? frame.attemptId : ''
    const separator = attemptId.lastIndexOf(':')
    const sessionId = separator > 0 ? attemptId.slice(0, separator) : ''
    if (sessionId === '') return
    const next = ((intentBuffers.get(sessionId) ?? '') + chunk.text).slice(-4000)
    intentBuffers.set(sessionId, next)
  })

  bus.on('session/event', (session, event) => {
    const sessionId = sessionIdOf({ session })
    if (sessionId === '') return

    if (event.type === 'turn/start' || event.type === 'turn/end') {
      sessions.delete(sessionId)
      intentBuffers.delete(sessionId)
      return
    }

    if (event.type === 'todo/write') {
      const todos = readTodos(event.data)
      if (todos !== null) resetState(sessions, sessionId, todos)
      intentBuffers.delete(sessionId)
    }
  })
}

function resolveConfig(input?: TaskGuardConfig): ResolvedConfig {
  if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input))) {
    throw new TypeError('task-guard: config must be an object')
  }
  const raw = (input ?? {}) as Record<string, unknown>
  for (const key of Object.keys(raw)) {
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`task-guard: unknown config field "${key}"`)
  }

  const enabled = readBoolean(raw.enabled, true, 'enabled')
  const locale = readLocale(raw.locale)
  const staleAfterCalls = readInteger(raw.staleAfterCalls, 5, 1, 'staleAfterCalls')
  const repeatEveryCalls = readInteger(raw.repeatEveryCalls, 4, 0, 'repeatEveryCalls')
  const blockAfterCalls = readInteger(raw.blockAfterCalls, 0, 0, 'blockAfterCalls')
  const rejectMissingActive = readBoolean(raw.rejectMissingActive, false, 'rejectMissingActive')
  const sourceKind = readSourceKind(raw.sourceKind)
  const maxListItems = readInteger(raw.maxListItems, 6, 1, 'maxListItems')
  const detectStepIntent = readBoolean(raw.detectStepIntent, true, 'detectStepIntent')
  const translateTodoContent = readBoolean(raw.translateTodoContent, true, 'translateTodoContent')
  const todoTranslationTimeoutMs = readInteger(raw.todoTranslationTimeoutMs, 3000, 500, 'todoTranslationTimeoutMs')
  const include = compilePatterns(readStringArray(raw.include, [], 'include'))
  const exclude = compilePatterns(readStringArray(raw.exclude, DEFAULT_EXCLUDES, 'exclude'))

  if (blockAfterCalls > 0 && blockAfterCalls <= staleAfterCalls) {
    throw new TypeError('task-guard: blockAfterCalls must be greater than staleAfterCalls')
  }

  return {
    enabled,
    locale,
    staleAfterCalls,
    repeatEveryCalls,
    blockAfterCalls,
    rejectMissingActive,
    sourceKind,
    include,
    exclude,
    maxListItems,
    detectStepIntent,
    translateTodoContent,
    todoTranslationTimeoutMs,
  }
}

function readBoolean(value: unknown, fallback: boolean, field: string): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new TypeError(`task-guard: ${field} must be a boolean`)
  return value
}

function readLocale(value: unknown): 'zh' | 'en' {
  if (value === undefined) return 'zh'
  if (value !== 'zh' && value !== 'en') throw new TypeError('task-guard: locale must be "zh" or "en"')
  return value
}

function readSourceKind(value: unknown): 'auto' | 'v3' | 'v4' {
  if (value === undefined) return 'auto'
  if (value !== 'auto' && value !== 'v3' && value !== 'v4') {
    throw new TypeError('task-guard: sourceKind must be "auto", "v3", or "v4"')
  }
  return value
}

function readInteger(value: unknown, fallback: number, minimum: number, field: string): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new TypeError(`task-guard: ${field} must be an integer >= ${minimum}`)
  }
  return value as number
}

function readStringArray(value: unknown, fallback: string[], field: string): string[] {
  if (value === undefined) return [...fallback]
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(`task-guard: ${field} must be an array of non-empty strings`)
  }
  return [...value]
}

function compilePatterns(patterns: string[]): RegExp[] {
  return patterns.map((pattern) => {
    const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`)
    return new RegExp(`^${escaped.replaceAll('*', '.*')}$`)
  })
}

function isTracked(toolName: string, config: ResolvedConfig): boolean {
  if (config.include.length > 0 && !config.include.some((pattern) => pattern.test(toolName))) return false
  return !config.exclude.some((pattern) => pattern.test(toolName))
}

function readTodos(value: unknown): TodoItem[] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => key !== 'todos')) return null
  if (!Array.isArray(record.todos)) return null

  const todos: TodoItem[] = []
  const seen = new Set<string>()
  for (const item of record.todos) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return null
    const entry = item as Record<string, unknown>
    if (Object.keys(entry).some((key) => key !== 'content' && key !== 'status')) return null
    if (typeof entry.content !== 'string' || typeof entry.status !== 'string' || !STATUSES.has(entry.status)) {
      return null
    }
    const content = entry.content.trim()
    if (content === '' || seen.has(content)) return null
    seen.add(content)
    todos.push({ content, status: entry.status as TodoStatus })
  }
  return todos
}

function resetState(sessions: Map<string, SessionState>, sessionId: string, todos: TodoItem[]): void {
  sessions.set(sessionId, {
    todos: todos.map((todo) => ({ ...todo })),
    callsSinceWrite: 0,
    remindersSent: 0,
    reminderDeliveredThisStep: false,
    intentNotifiedThisStep: false,
  })
}

function sessionIdOf(agent: AgentLike | undefined): string {
  const id = agent?.session?.id
  return typeof id === 'string' && id !== '' ? id : ''
}

/**
 * Format v3 used `{ kind: 'plugin', plugin }`; v4 retired that wrapper for
 * producer-owned kinds such as `plugin:task-guard`. `session.header.version`
 * is present on both generations (3 on 0.1.5, 4 on 0.2.x).
 */
function sourceKindFor(agent: AgentLike | undefined, config: ResolvedConfig): 'v3' | 'v4' {
  if (config.sourceKind !== 'auto') return config.sourceKind
  const version = agent?.session?.header?.version
  return typeof version === 'number' && version < 4 ? 'v3' : 'v4'
}

function hasUnfinished(todos: TodoItem[]): boolean {
  return todos.some((todo) => todo.status !== 'completed')
}

function leavesPendingWithoutActive(todos: TodoItem[]): boolean {
  const pending = todos.some((todo) => todo.status === 'pending')
  const active = todos.some((todo) => todo.status === 'in_progress')
  return pending && !active
}

function denyMissingActive(todos: TodoItem[], config: ResolvedConfig): string {
  const pending = todos.filter((todo) => todo.status === 'pending').length
  if (config.locale === 'en') {
    return `todo_write rejected: ${pending} task(s) are still pending but no task is in_progress. While work remains, keep exactly one task in_progress. Resend the COMPLETE list with the next task you are about to work on marked in_progress, and finished tasks marked completed.`
  }
  return `todo_write 未执行：清单里还有 ${pending} 个待办，但没有任何 in_progress 任务。只要还有工作，就必须保持恰好一个任务为 in_progress。请重新提交完整清单：把已完成的阶段标为 completed，并把下一阶段标为 in_progress。`
}

async function noticeMissingActive(
  todos: TodoItem[],
  config: ResolvedConfig,
  sourceKind: 'v3' | 'v4',
  context: NoticeContext,
): Promise<NoticeMessage> {
  const pending = todos.filter((todo) => todo.status === 'pending').length
  const completed = todos.some((todo) => todo.status === 'completed')
  const remaining = todos.filter((todo) => todo.status !== 'completed')
  const display = await displayTodoContents(remaining.map((todo) => todo.content), context)
  const quoted = remaining
    .slice(0, config.maxListItems)
    .map((todo, index) => (todo.status === 'in_progress' ? '[~] ' : '[ ] ') + truncate(display[index], 60))
    .join('\n')
  const omitted = remaining.length - config.maxListItems
  const items = omitted > 0 ? quoted + '\n… +' + omitted : quoted
  const text = config.locale === 'en'
    ? (completed
      ? '[Todo sync] A task was marked completed, but ' + pending + ' task(s) remain pending and no task is in_progress. Mark the next task in_progress before continuing, or clear the list / mark everything completed if this work is finished.'
      : '[Todo sync] No task is in_progress while ' + pending + ' task(s) are pending. Mark the task you are about to start as in_progress.')
      + '\n\nRemaining:\n' + items
      + '\n\n(Tip: todo titles can be written in Chinese.)'
    : (completed
      ? '【todo 同步】已有任务被标为 completed，但清单里还有 ' + pending + ' 个待办，且没有任何 in_progress 任务。继续之前请把下一阶段标为 in_progress；如果本次工作已经结束，请清空清单或把任务全部标为 completed。'
      : '【todo 同步】清单里还有 ' + pending + ' 个待办，但还没有任何 in_progress 任务。请把即将开始的阶段标为 in_progress。')
      + '\n\n剩余：\n' + items
      + '\n\n（提示：todo 内容可以直接用中文书写。）'
  return createNotice(text, config.locale === 'en' ? 'todo has no active task' : 'todo 没有进行中任务', sourceKind)
}

function denyStale(state: SessionState, config: ResolvedConfig): string {
  if (config.locale === 'en') {
    return `task-guard paused this call: ${state.callsSinceWrite} tool calls have run since the last todo_write and unfinished tasks remain. Call todo_write first — mark finished tasks completed and the next task in_progress — then retry the operation.`
  }
  return `task-guard 已暂停本次工具调用：距上次 todo_write 已过 ${state.callsSinceWrite} 次工具调用，但仍有未完成的待办。请先调用 todo_write 更新清单（已完成标为 completed，下一阶段标为 in_progress），然后重试刚才的操作。`
}

async function buildReminder(
  state: SessionState,
  config: ResolvedConfig,
  sourceKind: 'v3' | 'v4',
  context: NoticeContext,
): Promise<NoticeMessage | undefined> {
  const todos = state.todos
  if (todos === null) return undefined

  const remaining = todos.filter((todo) => todo.status !== 'completed')
  if (remaining.length === 0) return undefined

  const active = todos.filter((todo) => todo.status === 'in_progress')
  const activeDisplay = await displayTodoContents(active.map((todo) => todo.content), context)
  const activeText = active.length === 0
    ? (config.locale === 'en' ? '(none)' : '（无）')
    : activeDisplay.join(config.locale === 'en' ? ', ' : '、')

  const display = await displayTodoContents(remaining.map((todo) => todo.content), context)
  const quoted = remaining
    .slice(0, config.maxListItems)
    .map((todo, index) => (todo.status === 'in_progress' ? '[~] ' : '[ ] ') + truncate(display[index], 60))
    .join('\n')
  const omitted = remaining.length - config.maxListItems
  const items = omitted > 0 ? quoted + '\n… +' + omitted : quoted

  const text = config.locale === 'en'
    ? [
        '[Todo sync] ' + state.callsSinceWrite + ' tool calls have run since the last todo_write.',
        'In progress: ' + activeText,
        'Remaining:\n' + items,
        'If the current phase is not finished yet, ignore this reminder. The moment it is finished, call todo_write: mark it completed and the next task in_progress (never leave pending work with no active task).',
        '(Tip: todo titles can be written in Chinese.)',
      ].join('\n')
    : [
        '【todo 同步】距上次 todo_write 已过 ' + state.callsSinceWrite + ' 次工具调用。',
        '进行中：' + activeText,
        '剩余：\n' + items,
        '如果当前阶段还没完成，请忽略本提醒；一旦完成，请立刻调用 todo_write：把该阶段标为 completed，并把下一阶段标为 in_progress（有剩余任务时不要留空）。',
        '（提示：todo 内容可以直接用中文书写。）',
      ].join('\n')

  const summary = config.locale === 'en'
    ? 'todo stale · ' + state.callsSinceWrite + ' calls'
    : 'todo 未更新 · ' + state.callsSinceWrite + ' 次调用'

  return createNotice(text, summary, sourceKind)
}

async function buildIntentNotice(
  state: SessionState,
  match: StepIntentMatch,
  config: ResolvedConfig,
  sourceKind: 'v3' | 'v4',
  context: NoticeContext,
): Promise<NoticeMessage> {
  const todos = state.todos ?? []
  const [display] = await displayTodoContents([match.todo.content], context)
  const suggested = suggestedTodoPayload(todos, match.todo)
  const phrase = truncate(match.phrase, 60)
  const text = config.locale === 'en'
    ? [
        '[Todo sync] Your reasoning says "' + phrase + '", which matches the pending todo "' + display + '", but that task is not in_progress.',
        suggested === undefined
          ? 'Mark it in_progress before continuing and keep the finished phase completed.'
          : 'If the previous phase is done, send this todo_write now:',
        suggested ?? '',
        '(Tip: todo titles can be written in Chinese.)',
      ].filter(line => line !== '').join('\n')
    : [
        '【todo 同步】你在思考中提到「' + phrase + '」，匹配到待办「' + display + '」，但它还不是 in_progress。',
        suggested === undefined
          ? '继续之前请把该待办标为 in_progress，并把已完成阶段标为 completed。'
          : '如果上一阶段已经完成，请直接发送：',
        suggested ?? '',
        '（提示：todo 内容可以直接用中文书写。）',
      ].filter(line => line !== '').join('\n')
  const summary = config.locale === 'en'
    ? 'todo intent · ' + truncate(phrase, 40)
    : 'todo 意图 · ' + truncate(phrase, 40)
  return createNotice(text, summary, sourceKind)
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function createNotice(text: string, summary: string, sourceKind: 'v3' | 'v4'): NoticeMessage {
  const boundedSummary = summary.length <= SUMMARY_MAX_CHARS ? summary : `${summary.slice(0, SUMMARY_MAX_CHARS - 1)}…`
  const source: PluginSource =
    sourceKind === 'v3'
      ? { kind: 'plugin', plugin: 'task-guard', form: 'notice', summary: boundedSummary }
      : { kind: 'plugin:task-guard', form: 'notice', summary: boundedSummary }
  return deepFreeze({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source,
  })
}

function attachContext(decision: PostToolDecision, context: NoticeMessage): PostToolDecision {
  return {
    ...decision,
    additionalContexts: [context, ...(decision.additionalContexts ?? [])],
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key])
  }
  return value
}
