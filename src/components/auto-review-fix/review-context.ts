import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

/**
 * Auto review serializes the whole session surface into FILTERED_HISTORY and
 * asks the reviewer model to judge one pending call. A long session can exceed
 * the reviewer's context window before it even starts. This module projects
 * only the reviewer request: current action, project instructions, and every
 * human/direct-parent instruction stay; old tool calls and oversized payloads
 * are compacted.
 */

export interface ReviewContextSettings {
  enabled: boolean
  maxHistoryChars: number
  keepRecentEntries: number
}

export interface ReviewOptions {
  system?: unknown
  messages?: unknown
  [key: string]: unknown
}

interface ReviewMessage {
  role?: unknown
  content?: unknown
  [key: string]: unknown
}

const REVIEW_MARKER = 'REVIEW_POLICY'
const REVIEW_MARKER_2 = 'final authorization reviewer'
const HISTORY_HEADER = 'FILTERED_HISTORY\n\n'
const PROJECT_HEADER = 'PROJECT_INSTRUCTIONS\n\n'
const ACTION_HEADER = '\n\nPENDING_ACTION\n\n'
const USER_TEXT_CHARS = 4_000
const TOOL_ARGUMENT_CHARS = 2_000
const PROJECT_MAX_CHARS = 40_000

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function textOf(message: unknown): string | undefined {
  if (!record(message) || !Array.isArray(message.content)) return undefined
  const texts: string[] = []
  for (const block of message.content) {
    if (!record(block) || block.type !== 'text' || typeof block.text !== 'string') return undefined
    texts.push(block.text)
  }
  return texts.join('')
}

/** Detect the exact one-message request shape Auto review sends to llm.stream. */
export function isLegacyAutoReviewRequest(options: unknown): options is ReviewOptions {
  if (!record(options)) return false
  const system = options.system
  if (typeof system !== 'string' || !system.includes(REVIEW_MARKER) || !system.includes(REVIEW_MARKER_2)) return false
  if (!Array.isArray(options.messages) || options.messages.length === 0) return false
  const text = textOf(options.messages[0])
  return text !== undefined && text.includes(HISTORY_HEADER) && text.includes(ACTION_HEADER)
}

function truncateText(text: string, limit: number): string {
  if (text.length <= limit) return text
  return text.slice(0, limit) + '\n…[' + String(text.length - limit) + ' characters omitted]'
}

function compactBlock(block: unknown): unknown {
  if (!record(block)) return { type: 'text', text: '[non-text history block omitted from reviewer context]' }
  if (block.type === 'text' && typeof block.text === 'string') {
    return { ...block, text: truncateText(block.text, USER_TEXT_CHARS) }
  }
  return {
    type: 'text',
    text: '[' + String(block.type ?? 'attachment') + ' omitted from reviewer context]',
  }
}

function compactEntry(entry: unknown): unknown {
  if (!record(entry)) return { kind: 'summary', role: 'fact', content: [{ type: 'text', text: '[invalid history entry omitted]' }] }
  if (entry.kind === 'user-message' && Array.isArray(entry.content)) {
    return { ...entry, content: entry.content.map(compactBlock) }
  }
  if (entry.kind === 'tool-call') {
    const value = entry.arguments
    if (typeof value === 'string') {
      return { ...entry, arguments: truncateText(value, TOOL_ARGUMENT_CHARS) }
    }
    if (value !== undefined) {
      let rendered: string
      try {
        rendered = JSON.stringify(value) ?? ''
      } catch {
        rendered = ''
      }
      return { ...entry, arguments: truncateText(rendered, TOOL_ARGUMENT_CHARS) }
    }
  }
  return entry
}

function protectedEntry(entry: unknown): boolean {
  if (!record(entry)) return false
  return entry.role === 'human-instruction' || entry.role === 'direct-parent-instruction'
}

function summaryEntry(omitted: number, originalChars: number): Record<string, unknown> {
  return {
    kind: 'summary',
    role: 'fact',
    content: [{
      type: 'text',
      text: '[auto-review-fix] ' + String(omitted)
        + ' earlier history entries omitted from the reviewer context (original history '
        + String(originalChars) + ' chars). Current action and human instructions are retained.',
    }],
  }
}

function jsonLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return Number.MAX_SAFE_INTEGER
  }
}

/** Compact and bound one history array while preserving authorization entries. */
export function boundEntries(entries: unknown[], maxChars: number, keepRecent: number): unknown[] {
  const normalized = entries.map(compactEntry)
  const originalChars = jsonLength(normalized)
  const recentStart = Math.max(0, normalized.length - Math.max(1, keepRecent))
  const selected = normalized.filter((entry, index) => protectedEntry(entry) || index >= recentStart)
  let omitted = normalized.length - selected.length
  while (selected.length > 1 && jsonLength(selected) > maxChars) {
    const at = selected.findIndex(entry => !protectedEntry(entry))
    if (at < 0) selected.shift()
    else selected.splice(at, 1)
    omitted += 1
  }
  if (omitted > 0) selected.unshift(summaryEntry(omitted, originalChars))
  return selected
}

function parseArray(text: string): unknown[] | undefined {
  try {
    const value = JSON.parse(text) as unknown
    return Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

function logTrim(originalChars: number, nextChars: number, originalEntries: number, nextEntries: number): void {
  try {
    appendFileSync(
      join(tmpdir(), 'dsh-mcviseron-auto-review.log'),
      new Date().toISOString() + ' review context trimmed: ' + String(originalChars) + ' -> '
        + String(nextChars) + ' chars, history ' + String(originalEntries) + ' -> ' + String(nextEntries) + '\n',
      'utf8',
    )
  } catch {
    /* diagnostics must never break the reviewer request */
  }
}

/**
 * Return a copy of a reviewer request with bounded FILTERED_HISTORY and compact
 * project instructions. Non-review requests and malformed requests are returned
 * byte-for-byte unchanged.
 */
export function trimReviewRequest<T extends ReviewOptions>(options: T, settings: ReviewContextSettings): T {
  if (!settings.enabled) return options
  if (isModernAutoReviewRequest(options)) return trimModernReviewRequest(options, settings)
  if (!isLegacyAutoReviewRequest(options)) return options
  const messages = options.messages as ReviewMessage[]
  const message = messages[0]
  const text = textOf(message)
  if (text === undefined) return options

  const projectAt = text.indexOf(PROJECT_HEADER)
  const historyAt = text.indexOf(HISTORY_HEADER, projectAt + 1)
  const actionAt = text.indexOf(ACTION_HEADER, historyAt + 1)
  if (projectAt < 0 || historyAt < 0 || actionAt < 0) return options

  const projectJson = text.slice(projectAt + PROJECT_HEADER.length, historyAt - 2)
  const historyJson = text.slice(historyAt + HISTORY_HEADER.length, actionAt)
  const project = parseArray(projectJson)
  const history = parseArray(historyJson)
  if (project === undefined || history === undefined) return options

  const nextProject = boundEntries(project, PROJECT_MAX_CHARS, 4)
  const nextHistory = boundEntries(history, settings.maxHistoryChars, settings.keepRecentEntries)
  const nextText = text.slice(0, projectAt)
    + PROJECT_HEADER + JSON.stringify(nextProject)
    + HISTORY_HEADER + JSON.stringify(nextHistory)
    + text.slice(actionAt)
  if (nextText === text) return options

  logTrim(text.length, nextText.length, history.length, nextHistory.length)
  const content = [{ type: 'text', text: nextText }]
  return {
    ...options,
    messages: [
      { ...message, content },
      ...messages.slice(1),
    ],
  }
}

const MODERN_PURPOSE = 'auto-review'
const ENVIRONMENT_HEADER = 'ENVIRONMENT\n'
const MODERN_USER_ROLES = new Set(['user-instruction', 'direct-parent-instruction', 'constraint', 'checkpoint', 'human-instruction'])
const MODERN_USER_TEXT_CHARS = 8_000
const MODERN_TOOL_ARGUMENT_CHARS = 4_000
const MODERN_SCHEMA_DESCRIPTION_CHARS = 4_000
const MODERN_SCHEMA_PARAMETER_CHARS = 12_000

/** Detect the 0.2.2 review request: purpose auto-review, one message per retained item. */
export function isModernAutoReviewRequest(options: unknown): options is ReviewOptions & { purpose: 'auto-review' } {
  if (!record(options) || options.purpose !== MODERN_PURPOSE) return false
  if (typeof options.system !== 'string' || !options.system.includes(REVIEW_MARKER) || !options.system.includes(REVIEW_MARKER_2)) return false
  if (!Array.isArray(options.messages) || options.messages.length < 2) return false
  const first = textOf(options.messages[0])
  return first !== undefined && first.startsWith(ENVIRONMENT_HEADER)
}

/** Detect either the 0.2.2 request or the older FILTERED_HISTORY request. */
export function isAutoReviewRequest(options: unknown): options is ReviewOptions {
  return isModernAutoReviewRequest(options) || isLegacyAutoReviewRequest(options)
}

function modernRole(entry: unknown): string | undefined {
  return record(entry) && typeof entry.role === 'string' ? entry.role : undefined
}

function modernProtected(entry: unknown, index: number, lastIndex: number, schemaIndexes: ReadonlySet<number>): boolean {
  if (index === lastIndex) return true
  const role = modernRole(entry)
  if (role !== undefined && MODERN_USER_ROLES.has(role)) return true
  return schemaIndexes.has(index)
}

function compactModernContent(content: unknown, textLimit: number): unknown[] {
  if (!Array.isArray(content)) return []
  return content.map((block) => {
    if (!record(block)) return { type: 'text', text: '[non-text history block omitted from reviewer context]' }
    if (block.type === 'text' && typeof block.text === 'string') {
      return { ...block, text: truncateText(block.text, textLimit) }
    }
    return { type: 'text', text: '[' + String(block.type ?? 'attachment') + ' omitted from reviewer context]' }
  })
}

function compactModernEntry(entry: unknown, pending: boolean): unknown {
  if (!record(entry)) return { kind: 'summary', role: 'fact', content: [{ type: 'text', text: '[invalid history entry omitted]' }] }
  if (pending) return entry
  if (entry.kind === 'user-message') {
    return { ...entry, content: compactModernContent(entry.content, MODERN_USER_TEXT_CHARS) }
  }
  if (entry.kind === 'tool-call') {
    if (typeof entry.arguments === 'string') {
      return { ...entry, arguments: truncateText(entry.arguments, MODERN_TOOL_ARGUMENT_CHARS) }
    }
    if (entry.arguments !== undefined) {
      let rendered = ''
      try { rendered = JSON.stringify(entry.arguments) ?? '' } catch { rendered = '' }
      return { ...entry, arguments: truncateText(rendered, MODERN_TOOL_ARGUMENT_CHARS) }
    }
  }
  if (entry.kind === 'tool-schema') {
    const description = typeof entry.description === 'string'
      ? truncateText(entry.description, MODERN_SCHEMA_DESCRIPTION_CHARS)
      : entry.description
    let parameters = entry.parameters
    if (parameters !== undefined) {
      try {
        const rendered = JSON.stringify(parameters) ?? ''
        if (rendered.length > MODERN_SCHEMA_PARAMETER_CHARS) parameters = truncateText(rendered, MODERN_SCHEMA_PARAMETER_CHARS)
      } catch { parameters = '[unserializable schema parameters omitted]' }
    }
    return { ...entry, description, parameters }
  }
  return entry
}

function modernSchemaIndexes(entries: unknown[]): Set<number> {
  const indexes = new Map<string, number>()
  entries.forEach((entry, index) => {
    if (!record(entry) || entry.kind !== 'tool-schema') return
    indexes.set(String(entry.mode) + '\0' + String(entry.name), index)
  })
  return new Set(indexes.values())
}

/**
 * Trim the 0.2.2 review request. The environment and pending action stay
 * byte-identical; instruction entries and the latest schema per tool survive;
 * recent entries and a bounded number of older facts are retained.
 */
export function trimModernReviewRequest<T extends ReviewOptions>(options: T, settings: ReviewContextSettings): T {
  const messages = options.messages as ReviewMessage[]
  const first = textOf(messages[0])
  if (first === undefined || !first.startsWith(ENVIRONMENT_HEADER)) return options
  const entries: unknown[] = []
  for (const message of messages.slice(1)) {
    const text = textOf(message)
    if (text === undefined) return options
    try { entries.push(JSON.parse(text)) } catch { return options }
  }
  if (entries.length === 0) return options
  const lastIndex = entries.length - 1
  const schemaIndexes = modernSchemaIndexes(entries)
  const recentStart = Math.max(0, entries.length - Math.max(1, settings.keepRecentEntries))
  const selected: number[] = []
  for (let index = 0; index < entries.length; index += 1) {
    if (index >= recentStart || modernProtected(entries[index], index, lastIndex, schemaIndexes)) selected.push(index)
  }
  let omitted = entries.length - selected.length
  const compacted = selected.map(index => compactModernEntry(entries[index], index === lastIndex))
  while (selected.length > 2 && jsonLength(compacted) > settings.maxHistoryChars) {
    let at = selected.findIndex((index, position) => index !== lastIndex && position < selected.length - 1 && !modernProtected(entries[index], index, lastIndex, schemaIndexes))
    if (at < 0) at = selected.findIndex((index, position) => index !== lastIndex && position < selected.length - 1)
    if (at < 0) break
    selected.splice(at, 1)
    compacted.splice(at, 1)
    omitted += 1
  }
  const summary = {
    kind: 'summary',
    role: 'fact',
    content: [{
      type: 'text',
      text: '[auto-review-fix] ' + String(omitted)
        + ' earlier history entries omitted from the reviewer context (original history '
        + String(jsonLength(entries)) + ' chars). Current action, instructions and recent context are retained.',
    }],
  }
  const nextMessages: ReviewMessage[] = [messages[0]]
  if (omitted > 0) nextMessages.push({ role: 'user', content: [{ type: 'text', text: JSON.stringify(summary) }] })
  selected.forEach((originalIndex, position) => {
    const original = messages[originalIndex + 1]
    if (originalIndex === lastIndex) nextMessages.push(original)
    else nextMessages.push({ ...original, content: [{ type: 'text', text: JSON.stringify(compacted[position]) }] })
  })
  if (jsonLength(nextMessages) >= jsonLength(messages)) return options
  logTrim(jsonLength(messages), jsonLength(nextMessages), entries.length, selected.length)
  return { ...options, messages: nextMessages }
}

const guardedLlms = new WeakMap<object, { settings: ReviewContextSettings }>()

function whenService(ctx: Context, name: string, run: (scope: Context) => void): void {
  try {
    const inject = (ctx as unknown as { inject?: (deps: string[], callback: (scope: Context) => void) => unknown }).inject
    if (typeof inject === 'function') {
      inject.call(ctx, [name], run)
      return
    }
    const get = (ctx as unknown as { get?: (key: string) => unknown }).get
    if (typeof get === 'function' && get.call(ctx, name) !== undefined) run(ctx)
  } catch {
    /* a host without the seam keeps the original llm.stream */
  }
}

function serviceOf(scope: Context, name: string): unknown {
  try {
    const direct = (scope as unknown as Record<string, unknown>)[name]
    if (direct !== undefined) return direct
  } catch {
    /* fall through */
  }
  try {
    const get = (scope as unknown as { get?: (key: string) => unknown }).get
    return typeof get === 'function' ? get.call(scope, name) : undefined
  } catch {
    return undefined
  }
}

function effectOf(scope: Context, setup: () => () => void, label: string): void {
  try {
    const effect = (scope as unknown as { effect?: (body: () => () => void, label: string) => unknown }).effect
    if (typeof effect === 'function') effect.call(scope, setup, label)
  } catch {
    /* a host without effect() still gets the wrapper */
  }
}

/** Wrap llm.stream, but only rewrite requests that carry the Auto-review policy. */
export function installReviewContextGuard(ctx: Context, settings: ReviewContextSettings): void {
  if (!settings.enabled) return
  whenService(ctx, 'llm', (scope) => {
    const llm = serviceOf(scope, 'llm') as { stream?: unknown } | undefined
    if (llm === null || typeof llm !== 'object' || typeof llm.stream !== 'function') return
    const existing = guardedLlms.get(llm)
    if (existing !== undefined) {
      existing.settings = settings
      return
    }
    const original = llm.stream as (this: unknown, options: unknown) => unknown
    const state = { settings }
    const wrapper = function (this: unknown, options: unknown): unknown {
      let next = options
      try {
        next = trimReviewRequest(options as ReviewOptions, state.settings)
      } catch {
        next = options
      }
      return original.call(this, next)
    }
    try {
      llm.stream = wrapper
      guardedLlms.set(llm, state)
    } catch {
      return
    }
    effectOf(scope, () => () => {
      if (llm.stream === wrapper) llm.stream = original
      guardedLlms.delete(llm)
    }, 'mcviseron: restore llm.stream')
  })
}
