/**
 * Chinese display translation for an English tool-approval reason.
 *
 * DSH's Auto-review layer escalates a denied call to a human approval prompt and
 * carries the reviewer's own English explanation in `displayReason`. That text
 * is the reviewer's reasoning: it is audited and must stay byte-identical. This
 * module therefore never rewrites it — it only *appends* a translation to the
 * localized display value the Web client resolves for the active language.
 *
 * Every host seam is optional. A host without `approval.request`,
 * `displayReason`, `llm`, or a session request route simply keeps showing the
 * untranslated reason. Translation is cached per source string and bounded by a
 * timeout so an approval can never be held open indefinitely.
 */

/** Locale-text record used by `ctx.locale.resolveText` (a map of locale id to text). */
export type LocaleText = Record<string, string>

/** Resolved, validated settings for this component. */
export interface TranslationSettings {
  enabled: boolean
  timeoutMs: number
  maxChars: number
  provider: string
  model: string
}

/** Marker that keeps the appended block visually separate from the audited text. */
export const TRANSLATION_LABEL = '【审查理由 · 中文翻译】'

/** Instruction for the display-only translator. */
const SYSTEM_PROMPT = [
  'You translate the internal reviewer notes of an AI tool-approval system into Simplified Chinese.',
  'Rules:',
  '- Output the translation only: no preamble, no quotes, no Markdown fences.',
  '- Keep tool names, file paths, identifiers, URLs, JSON and code exactly as written.',
  '- Preserve meaning and ordering; do not summarize, add or omit anything.',
].join('\n')

/** Bounded source-string cache; FIFO eviction, process lifetime. */
const CACHE_LIMIT = 256
const cache = new Map<string, string>()

/** Languages whose key is already a Chinese translation slot. */
const CHINESE_KEY = /^zh(?:[-_]|$)/i

/** Whether one value is a plain locale-text record rather than a string or array. */
function isLocaleText(value: unknown): value is LocaleText {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** The localized key that already holds Chinese text, if this host defines one. */
export function chineseKey(display: LocaleText): string | undefined {
  if (typeof display['zh'] === 'string') return 'zh'
  for (const key of Object.keys(display)) {
    if (CHINESE_KEY.test(key) && typeof display[key] === 'string') return key
  }
  return undefined
}

/** The English surface the reviewer's own wording lives on. */
export function englishText(display: LocaleText): string | undefined {
  if (typeof display['en'] === 'string') return display['en']
  const key = chineseKey(display)
  if (key !== undefined) return undefined
  for (const value of Object.values(display)) if (typeof value === 'string') return value
  return undefined
}

/** Whether one display string is the Auto-review escalation this component targets. */
export function isAutoReviewText(text: string): boolean {
  return /auto[\s\-_]*review/i.test(text)
}

/**
 * Strip Auto-review's own English lead-in so only the reviewer's wording is
 * translated ("Auto review denied this call: <reason>" -> "<reason>").
 */
export function reviewerExcerpt(text: string): string {
  const match = /^\s*auto[\s\-_]*review\s+denied\s+this\s+call\s*[:：.]?\s*/i.exec(text)
  if (match === null) return text.trim()
  const rest = text.slice(match[0].length).trim()
  return rest.length === 0 ? text.trim() : rest
}

/** Compose the display value: the audited original, then the appended translation. */
export function withTranslation(original: string, translation: string): string {
  return original.length === 0
    ? `${TRANSLATION_LABEL}\n${translation}`
    : `${original}\n\n${TRANSLATION_LABEL}\n${translation}`
}

/** Whether one display value already carries an appended translation. */
export function hasTranslation(value: string): boolean {
  return value.includes(TRANSLATION_LABEL)
}

/** Drop wrapping quotes, fences, and stray whitespace a model may add. */
export function cleanTranslation(raw: string): string {
  let text = raw.trim()
  const fenced = /^\s*```[a-zA-Z]*\n([\s\S]*?)\n```\s*$/.exec(text)
  const fencedBody = fenced?.[1]
  if (fencedBody !== undefined) text = fencedBody.trim()
  if (text.length >= 2) {
    const first = text[0]
    const last = text[text.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === '「' && last === '」')) {
      text = text.slice(1, -1).trim()
    }
  }
  return text
}

/** Read the session's current request route without trusting any of it. */
function sessionRoute(request: unknown): { provider: string; model: string } | undefined {
  try {
    const agent = (request as { agent?: { session?: { requestHeader?: () => unknown } } } | null)?.agent
    const header = typeof agent?.session?.requestHeader === 'function' ? agent.session.requestHeader() : undefined
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

/** Choose the model route for the display translation. */
export function translationRoute(
  settings: TranslationSettings,
  request: unknown,
): { provider: string; model: string } | undefined {
  if (settings.provider.length > 0 && settings.model.length > 0) {
    return { provider: settings.provider, model: settings.model }
  }
  return sessionRoute(request)
}

/** Collect one streamed translation, tolerating every chunk shape. */
async function readStream(stream: AsyncIterable<unknown>, controller: AbortController): Promise<string | undefined> {
  let text = ''
  for await (const chunk of stream) {
    if (controller.signal.aborted) return undefined
    const value = chunk as { type?: unknown; text?: unknown; reason?: { kind?: unknown } } | null
    if (value === null || typeof value !== 'object') continue
    if (value.type === 'text-delta' && typeof value.text === 'string') {
      text += value.text
      if (text.length > 16000) break
      continue
    }
    if (value.type === 'finish') {
      const kind = value.reason?.kind
      if (typeof kind === 'string' && kind !== 'stop') return undefined
    }
  }
  return text
}

/**
 * Translate one English reviewer note into Chinese for display only.
 *
 * @param llm - the host `llm` service (`stream(options)` returning chunks).
 * @param settings - resolved component settings.
 * @param request - the borrowed approval request, read for its session route.
 * @param text - the English text to translate.
 * @returns the cleaned Chinese text, or `undefined` when translation is unavailable.
 */
export async function translateForDisplay(
  llm: { stream?: (options: unknown) => unknown } | undefined,
  settings: TranslationSettings,
  request: unknown,
  text: string,
): Promise<string | undefined> {
  const source = text.trim()
  if (source.length === 0 || source.length > settings.maxChars) return undefined
  const cached = cache.get(source)
  if (cached !== undefined) return cached
  if (llm === undefined || typeof llm.stream !== 'function') return undefined
  const route = translationRoute(settings, request)
  if (route === undefined) return undefined

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('translation timeout')), settings.timeoutMs)
  try {
    const stream = await llm.stream({
      provider: route.provider,
      model: route.model,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [{ type: 'text', text: source }] }],
      temperature: 0,
      signal: controller.signal,
    })
    if (stream === null || typeof stream !== 'object') return undefined
    const collected = await readStream(stream as AsyncIterable<unknown>, controller)
    if (collected === undefined) return undefined
    const cleaned = cleanTranslation(collected)
    if (cleaned.length === 0) return undefined
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next()
      if (oldest.done !== true) cache.delete(oldest.value)
    }
    cache.set(source, cleaned)
    return cleaned
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/** Test seam: forget every cached translation. */
export function clearTranslationCache(): void {
  cache.clear()
}
