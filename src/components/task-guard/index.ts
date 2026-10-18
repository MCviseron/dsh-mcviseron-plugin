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
  }
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
}

interface SessionState {
  todos: TodoItem[] | null
  callsSinceWrite: number
  remindersSent: number
  reminderDeliveredThisStep: boolean
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
])

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
      if (sessionId !== '') resetState(sessions, sessionId, todos)
      if (!config.rejectMissingActive && leavesPendingWithoutActive(todos)) {
        return attachContext(downstream, noticeMissingActive(todos, config, sourceKindFor(exec.agent, config)))
      }
      return downstream
    }

    if (exec.parent !== undefined || result.isError || !isTracked(exec.name, config)) return downstream

    const sessionId = sessionIdOf(exec.agent)
    if (sessionId === '') return downstream
    const state = sessions.get(sessionId)
    if (state?.todos == null || !hasUnfinished(state.todos)) return downstream

    state.callsSinceWrite += 1
    if (state.reminderDeliveredThisStep) return downstream

    const threshold = config.staleAfterCalls + state.remindersSent * config.repeatEveryCalls
    if (state.callsSinceWrite < threshold) return downstream
    if (config.repeatEveryCalls === 0 && state.remindersSent > 0) return downstream

    const reminder = buildReminder(state, config, sourceKindFor(exec.agent, config))
    if (reminder === undefined) return downstream

    state.remindersSent += 1
    state.reminderDeliveredThisStep = true
    return attachContext(downstream, reminder)
  })

  bus.on('agent/pre-step', async (payload, next) => {
    const state = sessions.get(sessionIdOf(payload.agent))
    if (state !== undefined) state.reminderDeliveredThisStep = false
    return next()
  })

  bus.on('session/event', (session, event) => {
    const sessionId = sessionIdOf({ session })
    if (sessionId === '') return

    if (event.type === 'turn/start' || event.type === 'turn/end') {
      sessions.delete(sessionId)
      return
    }

    if (event.type === 'todo/write') {
      const todos = readTodos(event.data)
      if (todos !== null) resetState(sessions, sessionId, todos)
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

function noticeMissingActive(
  todos: TodoItem[],
  config: ResolvedConfig,
  sourceKind: 'v3' | 'v4',
): NoticeMessage {
  const pending = todos.filter((todo) => todo.status === 'pending').length
  const completed = todos.some((todo) => todo.status === 'completed')
  const text =
    config.locale === 'en'
      ? completed
        ? `[Todo sync] A task was marked completed, but ${pending} task(s) remain pending and no task is in_progress. Mark the next task in_progress before continuing, or clear the list / mark everything completed if this work is finished.`
        : `[Todo sync] No task is in_progress while ${pending} task(s) are pending. Mark the task you are about to start as in_progress.`
      : completed
        ? `【todo 同步】已有任务被标为 completed，但清单里还有 ${pending} 个待办，且没有任何 in_progress 任务。继续之前请把下一阶段标为 in_progress；如果本次工作已经结束，请清空清单或把任务全部标为 completed。`
        : `【todo 同步】清单里还有 ${pending} 个待办，但还没有任何 in_progress 任务。请把即将开始的阶段标为 in_progress。`
  return createNotice(
    text,
    config.locale === 'en' ? 'todo has no active task' : 'todo 没有进行中任务',
    sourceKind,
  )
}

function denyStale(state: SessionState, config: ResolvedConfig): string {
  if (config.locale === 'en') {
    return `task-guard paused this call: ${state.callsSinceWrite} tool calls have run since the last todo_write and unfinished tasks remain. Call todo_write first — mark finished tasks completed and the next task in_progress — then retry the operation.`
  }
  return `task-guard 已暂停本次工具调用：距上次 todo_write 已过 ${state.callsSinceWrite} 次工具调用，但仍有未完成的待办。请先调用 todo_write 更新清单（已完成标为 completed，下一阶段标为 in_progress），然后重试刚才的操作。`
}

function buildReminder(
  state: SessionState,
  config: ResolvedConfig,
  sourceKind: 'v3' | 'v4',
): NoticeMessage | undefined {
  const todos = state.todos
  if (todos === null) return undefined

  const remaining = todos.filter((todo) => todo.status !== 'completed')
  if (remaining.length === 0) return undefined

  const active = todos.filter((todo) => todo.status === 'in_progress')
  const activeText =
    active.length === 0
      ? config.locale === 'en'
        ? '(none)'
        : '（无）'
      : active.map((todo) => todo.content).join(config.locale === 'en' ? ', ' : '、')

  const quoted = remaining
    .slice(0, config.maxListItems)
    .map((todo) => `${todo.status === 'in_progress' ? '[~]' : '[ ]'} ${truncate(todo.content, 48)}`)
    .join('\n')
  const omitted = remaining.length - config.maxListItems
  const items = omitted > 0 ? `${quoted}\n… +${omitted}` : quoted

  const text =
    config.locale === 'en'
      ? [
          `[Todo sync] ${state.callsSinceWrite} tool calls have run since the last todo_write.`,
          `In progress: ${activeText}`,
          `Remaining:\n${items}`,
          'If the current phase is not finished yet, ignore this reminder. The moment it is finished, call todo_write: mark it completed and the next task in_progress (never leave pending work with no active task).',
        ].join('\n')
      : [
          `【todo 同步】距上次 todo_write 已过 ${state.callsSinceWrite} 次工具调用。`,
          `进行中：${activeText}`,
          `剩余：\n${items}`,
          '如果当前阶段还没完成，请忽略本提醒；一旦完成，请立刻调用 todo_write：把该阶段标为 completed，并把下一阶段标为 in_progress（有剩余任务时不要留空）。',
        ].join('\n')

  const summary =
    config.locale === 'en'
      ? `todo stale · ${state.callsSinceWrite} calls`
      : `todo 未更新 · ${state.callsSinceWrite} 次调用`

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
