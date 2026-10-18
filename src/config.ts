import z from '@deepseek-ai/schemastery'
import { DEFAULT_SCHEDULE_CONFIG, normalizeScheduleConfig, type ScheduleConfig } from './schedule.ts'

/**
 * One master Config, one settings namespace. Every component owns a group so
 * fields can never collide, and each field is `volatile` so the Host settings
 * service exposes it as a live-editable value.
 *
 * The auto-generated settings page stays off (see `src/index.ts`): the
 * Appearance row is the shipped surface for the appearance component, while the
 * other two components are configured through this profile entry.
 */
const AppearanceConfig = z.object({
  enabled: z.boolean().default(DEFAULT_SCHEDULE_CONFIG.enabled).volatile(),
  lightStart: z.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).default(DEFAULT_SCHEDULE_CONFIG.lightStart).volatile(),
  lightEnd: z.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).default(DEFAULT_SCHEDULE_CONFIG.lightEnd).volatile(),
}).default({ ...DEFAULT_SCHEDULE_CONFIG })

/**
 * Auto-review hardening group. Field names match the standalone plugin so an
 * existing `auto-review-restart-fix` config can be moved here verbatim.
 */
const AutoReviewConfig = z.object({
  keepPresetGuard: z.boolean().default(true).volatile(),
  translateApprovalReason: z.boolean().default(true).volatile(),
  translateTimeoutMs: z.number().min(500).max(60000).default(6000).volatile(),
  translateMaxChars: z.number().min(100).max(20000).default(4000).volatile(),
  translateProvider: z.string().default('').volatile(),
  translateModel: z.string().default('').volatile(),
}).default({
  keepPresetGuard: true,
  translateApprovalReason: true,
  translateTimeoutMs: 6000,
  translateMaxChars: 4000,
  translateProvider: '',
  translateModel: '',
})

/** Todo plan guard group; `exclude` ships the component's default tool filter. */
const TaskGuardConfigSchema = z.object({
  enabled: z.boolean().default(true).volatile(),
  locale: z.union(['zh', 'en'] as const).default('zh').volatile(),
  staleAfterCalls: z.number().min(1).default(5).volatile(),
  repeatEveryCalls: z.number().min(0).default(4).volatile(),
  blockAfterCalls: z.number().min(0).default(0).volatile(),
  rejectMissingActive: z.boolean().default(false).volatile(),
  sourceKind: z.union(['auto', 'v3', 'v4'] as const).default('auto').volatile(),
  maxListItems: z.number().min(1).default(6).volatile(),
  include: z.array(z.string()).default([]).volatile(),
  exclude: z.array(z.string()).default(['todo_write', 'ask_user_question']).volatile(),
}).default({
  enabled: true,
  locale: 'zh',
  staleAfterCalls: 5,
  repeatEveryCalls: 4,
  blockAfterCalls: 0,
  rejectMissingActive: false,
  sourceKind: 'auto',
  maxListItems: 6,
  include: [],
  exclude: ['todo_write', 'ask_user_question'],
})

/** The profile entry Config, i.e. this plugin's settings namespace on DSH >= 0.2. */
export const Config = z.object({
  appearance: AppearanceConfig,
  autoReview: AutoReviewConfig,
  taskGuard: TaskGuardConfigSchema,
})

/** Appearance component group (also validated by hand on the browser side). */
export interface AppearanceGroup {
  enabled?: boolean
  lightStart?: string
  lightEnd?: string
}

/** Auto-review component group. */
export interface AutoReviewGroup {
  keepPresetGuard?: boolean
  translateApprovalReason?: boolean
  translateTimeoutMs?: number
  translateMaxChars?: number
  translateProvider?: string
  translateModel?: string
}

/** Todo plan guard component group. */
export interface TaskGuardGroup {
  enabled?: boolean
  locale?: 'zh' | 'en'
  staleAfterCalls?: number
  repeatEveryCalls?: number
  blockAfterCalls?: number
  rejectMissingActive?: boolean
  sourceKind?: 'auto' | 'v3' | 'v4'
  maxListItems?: number
  include?: string[]
  exclude?: string[]
}

/** Raw profile-entry config as the loader hands it to `apply()`. */
export interface McviseronConfig {
  appearance?: AppearanceGroup
  autoReview?: AutoReviewGroup
  taskGuard?: TaskGuardGroup
}

/** Config groups resolved once per plugin load. */
export interface ResolvedComponentConfig {
  appearance: ScheduleConfig
  autoReview: AutoReviewGroup | undefined
  taskGuard: TaskGuardGroup | undefined
}

/** A DSH >= 0.2 volatile Config value: a frozen reference read through `get()`. */
type VolatileLike = { get: () => unknown }

function isVolatileLike(value: unknown): value is VolatileLike {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  if (typeof (value as { get?: unknown }).get !== 'function') return false
  // createVolatile() freezes { get, [symbol]: setter }: the symbol is the
  // cross-copy marker, while the string keys are only ever ['get'].
  return Object.getOwnPropertySymbols(value).length > 0
    || Object.keys(value as object).every(key => key === 'get')
}

/**
 * Recursively unwrap DSH volatile references. The loader hands `.volatile()`
 * values (and, for nested groups, the group object itself) through frozen
 * references whose live value is read via `get()`.
 * @param value - any config value.
 * @returns the same shape with every reference replaced by its live value.
 */
export function toPlain<T>(value: T): T {
  if (isVolatileLike(value)) return toPlain(value.get() as T)
  if (Array.isArray(value)) return value.map(item => toPlain(item)) as T
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) result[key] = toPlain(child)
    return result as T
  }
  return value
}

/**
 * Split the master config into component groups. Each component keeps its own
 * validation/defaults, so a missing group simply behaves like the component's
 * shipped defaults.
 * @param config - the loader-supplied config (possibly volatile references).
 * @returns resolved appearance and raw component groups.
 */
export function componentConfigs(config: unknown): ResolvedComponentConfig {
  const plain = toPlain(config)
  const source = plain !== null && typeof plain === 'object' && !Array.isArray(plain)
    ? plain as Record<string, unknown>
    : {}
  return {
    appearance: normalizeScheduleConfig(source.appearance),
    autoReview: source.autoReview as AutoReviewGroup | undefined,
    taskGuard: source.taskGuard as TaskGuardGroup | undefined,
  }
}
