import type { Context } from '@deepseek-ai/cordis'
import {
  chineseKey,
  cleanTranslation,
  clearTranslationCache,
  englishText,
  hasTranslation,
  isAutoReviewText,
  reviewerExcerpt,
  translateForDisplay,
  translationRoute,
  withTranslation,
  type LocaleText,
  type TranslationSettings,
} from './translate.ts'

/**
 * Two independent guards for the DSH Auto-review permission preset.
 *
 * 1. **Shutdown preset guard** — the Auto-review package migrates every live
 *    Auto session to Full access in its disposal effect. That is correct when
 *    the plugin is removed while the Host keeps running, but during a whole-Host
 *    shutdown it silently rewrites the stored preset, so the next launch comes
 *    back as Full access. The guard drops `permissionPresets.set` writes while
 *    the root fiber is not ACTIVE.
 *
 * 2. **Approval-reason translation** — when a review denies a call, the Web
 *    approval prompt shows the reviewer's own English note. That note is audited
 *    reasoning and must not be edited, so this guard only appends a Chinese
 *    translation to the localized display value.
 *
 * Both guards are feature-detected and degrade to a no-op, so the component
 * keeps working across DSH generations that add or remove either seam.
 */

/** Cordis `FiberState.ACTIVE` (see `@deepseek-ai/cordis` FiberState). */
const FIBER_STATE_ACTIVE = 2

/** Settings actually used at runtime. */
export interface AutoReviewSettings extends TranslationSettings {
  keepPresetGuard: boolean
}

/** Service objects already guarded in this process (survives plugin reloads). */
const guardedPresets = new WeakSet<object>()
const guardedApproval = new WeakSet<object>()

/** Read one boolean setting without trusting its type. */
function boolSetting(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = source[key]
  return typeof value === 'boolean' ? value : fallback
}

/** Read one string setting without trusting its type. */
function stringSetting(source: Record<string, unknown>, key: string, fallback: string): string {
  const value = source[key]
  return typeof value === 'string' ? value.trim() : fallback
}

/** Read one bounded integer setting without trusting its type. */
function numberSetting(source: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const value = source[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), min), max)
}

/**
 * Resolve the `autoReview` config group. The group is validated by the Host
 * schema, but every field is re-validated here so a hand-written patch or an
 * older settings document can never break the component.
 *
 * @param config - the raw config group, if any.
 * @returns the settings used at runtime.
 */
export function normalizeConfig(config?: unknown): AutoReviewSettings {
  const source = config !== null && typeof config === 'object' && !Array.isArray(config)
    ? config as Record<string, unknown>
    : {}
  const translate = boolSetting(source, 'translateApprovalReason', true)
  return {
    keepPresetGuard: boolSetting(source, 'keepPresetGuard', true),
    enabled: translate,
    timeoutMs: numberSetting(source, 'translateTimeoutMs', 6000, 500, 60000),
    maxChars: numberSetting(source, 'translateMaxChars', 4000, 100, 20000),
    provider: stringSetting(source, 'translateProvider', ''),
    model: stringSetting(source, 'translateModel', ''),
  }
}

/** Reach one optional host service through the scoped injection seam. */
function whenService(ctx: Context, name: string, run: (scope: Context) => void): void {
  try {
    const inject = (ctx as unknown as { inject?: (deps: string[], callback: (scope: Context) => void) => unknown }).inject
    if (typeof inject === 'function') {
      inject.call(ctx, [name], run)
      return
    }
    const get = (ctx as unknown as { get?: (key: string) => unknown }).get
    const service = typeof get === 'function' ? get.call(ctx, name) : undefined
    if (service !== undefined) run(ctx)
  } catch {
    /* a host without the seam simply keeps the unguarded behaviour */
  }
}

/** Resolve one service value from a scope or its service registry. */
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

/** Register one teardown on the scoped context when the host supports effects. */
function effectOf(scope: Context, setup: () => () => void, label: string): void {
  try {
    const effect = (scope as unknown as { effect?: (body: () => () => void, label: string) => unknown }).effect
    if (typeof effect === 'function') effect.call(scope, setup, label)
  } catch {
    /* diagnostics-only: a host without effect() still gets the guard */
  }
}

/** Whether the root fiber is still ACTIVE, read defensively. */
function rootIsActive(root: unknown): boolean {
  try {
    const fiber = (root as { fiber?: { state?: unknown } } | null)?.fiber
    const state = fiber?.state
    if (typeof state !== 'number') return true
    return state === FIBER_STATE_ACTIVE
  } catch {
    return true
  }
}

/**
 * Suppress `permissionPresets.set` while the whole Host is going away.
 *
 * The wrapper is deliberately *not* removed on unload. Unload order decides
 * whether an unwrap would run before the Auto-review migration; keeping the
 * wrapper installed makes the guard independent of mount order, plugin reloads,
 * and disposal ordering. While the root fiber is ACTIVE the wrapper is a
 * pass-through, so a normal runtime removal still behaves like the bare service.
 */
function installPresetGuard(ctx: Context): void {
  whenService(ctx, 'permissionPresets', (scope) => {
    const presets = serviceOf(scope, 'permissionPresets') as { set?: unknown } | undefined
    if (presets === null || typeof presets !== 'object') return
    if (typeof presets.set !== 'function') return
    if (guardedPresets.has(presets)) return
    const original = presets.set as (session: unknown, name: string) => unknown
    const root = (scope as unknown as { root?: unknown }).root
    const wrapper = function (this: unknown, session: unknown, name: string): unknown {
      if (!rootIsActive(root)) return undefined
      return original.call(this, session, name)
    }
    try {
      presets.set = wrapper
      guardedPresets.add(presets)
    } catch {
      /* a frozen service definition keeps the unguarded behaviour */
    }
  })
}

/**
 * Append a Chinese translation of the reviewer's English note to one approval
 * request's `displayReason`.
 *
 * The audited `reason` is never touched, and the localized value keeps the
 * reviewer's wording verbatim ahead of the appended translation.
 *
 * @param scope - the scoped host context (may carry `llm`).
 * @param settings - resolved component settings.
 * @param request - the borrowed approval request; never mutated.
 * @param translate - translation seam (replaceable in tests).
 * @returns the request to hand to the approval service.
 */
export async function decorateApprovalRequest(
  scope: Context,
  settings: AutoReviewSettings,
  request: unknown,
  translate: typeof translateForDisplay = translateForDisplay,
): Promise<unknown> {
  if (!settings.enabled || request === null || typeof request !== 'object') return request
  const display = (request as { displayReason?: unknown }).displayReason
  if (display === null || typeof display !== 'object' || Array.isArray(display)) return request
  const record = display as LocaleText
  const key = chineseKey(record)
  if (key === undefined) return request
  const english = englishText(record)
  if (english === undefined || !isAutoReviewText(english)) return request
  const localized = record[key]
  if (typeof localized !== 'string' || hasTranslation(localized)) return request
  const excerpt = reviewerExcerpt(english)
  if (excerpt.length === 0 || excerpt.length > settings.maxChars) return request
  if (translationRoute(settings, request) === undefined) return request

  const llm = serviceOf(scope, 'llm') as { stream?: (options: unknown) => unknown } | undefined
  const translated = await translate(llm, settings, request, excerpt)
  if (translated === undefined) return request
  const cleaned = cleanTranslation(translated)
  if (cleaned.length === 0 || !/[\u4e00-\u9fff]/.test(cleaned)) return request

  return {
    ...(request as Record<string, unknown>),
    displayReason: { ...record, [key]: withTranslation(localized, cleaned) },
  }
}

/** Guard the approval seam so the escalation prompt carries a translation. */
function installApprovalTranslation(ctx: Context, settings: AutoReviewSettings): void {
  whenService(ctx, 'approval', (scope) => {
    const approval = serviceOf(scope, 'approval') as { request?: unknown } | undefined
    if (approval === null || typeof approval !== 'object') return
    const original = approval.request
    if (typeof original !== 'function') return
    if (guardedApproval.has(approval)) return
    const call = original as (this: unknown, request: unknown) => Promise<unknown>
    const wrapper = async function (this: unknown, request: unknown): Promise<unknown> {
      let decorated: unknown = request
      try {
        decorated = await decorateApprovalRequest(scope, settings, request)
      } catch {
        decorated = request
      }
      return call.call(this, decorated)
    }
    try {
      approval.request = wrapper
      guardedApproval.add(approval)
    } catch {
      return
    }
    effectOf(scope, () => () => {
      if (approval.request === wrapper) approval.request = call
    }, 'mcviseron: restore approval.request')
  })
}

/**
 * Install the Auto-review hardening component.
 *
 * @param ctx - the master plugin context supplied by the Cordis loader.
 * @param config - the `autoReview` config group (validated by hand as well).
 */
export function installAutoReview(ctx: Context, config?: unknown): void {
  const settings = normalizeConfig(config)
  if (settings.keepPresetGuard) installPresetGuard(ctx)
  if (settings.enabled) installApprovalTranslation(ctx, settings)
}

/** Test seam: forget every cached display translation. */
export { clearTranslationCache }
