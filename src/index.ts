import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import * as appearance from './appearance/index.ts'
import * as authCookie from './auth-cookie/index.ts'
import * as automationTasks from './automation-tasks/index.ts'
import * as autoReviewFix from './auto-review-fix/index.ts'
import { DEFAULT_AUTO_REVIEW_CONFIG } from './auto-review-fix/index.ts'
import * as restart from './restart/index.ts'
import * as sessionEnd from './session-end/index.ts'
import { DEFAULT_SESSION_END_CONFIG } from './session-end/index.ts'
import { DEFAULT_RESTART_CONFIG } from './restart/index.ts'
import * as taskGuard from './task-guard/index.ts'
import { DEFAULT_TASK_GUARD_CONFIG } from './task-guard/index.ts'
import { DEFAULT_SCHEDULE_CONFIG } from './schedule.ts'
import { toPlain } from './volatile.ts'

/**
 * Master entry Config. DSH composes a package's client half only when a Loader
 * row names the exact package root (subpath rows resolve to no package), so the
 * plugin ships ONE entry and mounts the components as sub-plugins. The
 * Appearance fields stay top-level because the settings bridge addresses them
 * by field name under this entry's namespace.
 */
export const Config = z.object({
  enabled: z.boolean().default(DEFAULT_SCHEDULE_CONFIG.enabled).volatile(),
  lightStart: z.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).default(DEFAULT_SCHEDULE_CONFIG.lightStart).volatile(),
  lightEnd: z.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).default(DEFAULT_SCHEDULE_CONFIG.lightEnd).volatile(),
  autoReviewFix: autoReviewFix.Config,
  taskGuard: taskGuard.Config,
  restart: restart.Config,
  sessionEnd: sessionEnd.Config,
}).default({
  enabled: DEFAULT_SCHEDULE_CONFIG.enabled,
  lightStart: DEFAULT_SCHEDULE_CONFIG.lightStart,
  lightEnd: DEFAULT_SCHEDULE_CONFIG.lightEnd,
  autoReviewFix: DEFAULT_AUTO_REVIEW_CONFIG,
  taskGuard: DEFAULT_TASK_GUARD_CONFIG,
  restart: DEFAULT_RESTART_CONFIG,
  sessionEnd: DEFAULT_SESSION_END_CONFIG,
})

export interface MasterConfig {
  enabled?: boolean
  lightStart?: string
  lightEnd?: string
  autoReviewFix?: unknown
  taskGuard?: unknown
  restart?: unknown
  sessionEnd?: unknown
}

/** Mount one component without letting a missing service fail the master entry. */
function mount(ctx: Context, component: unknown, config: unknown): void {
  try {
    (ctx.plugin as unknown as (plugin: unknown, config?: unknown) => unknown).call(ctx, component, config)
  } catch (error) {
    const logger = (ctx as unknown as { logger?: { warn?: (value: unknown) => void } }).logger
    logger?.warn?.(new Error('mcviseron: cannot mount a component', { cause: error }))
  }
}

/**
 * Install every component as a sub-plugin. Each child keeps its own `inject`
 * list, so a missing service only holds that component back.
 * @param ctx - the profile entry context.
 * @param rawConfig - the resolved entry Config (volatile refs are unwrapped).
 */
export function apply(ctx: Context, rawConfig?: MasterConfig): void {
  const config = (toPlain(rawConfig) ?? {}) as MasterConfig
  mount(ctx, automationTasks, {})
  mount(ctx, authCookie, {})
  mount(ctx, appearance, {
    enabled: config.enabled ?? DEFAULT_SCHEDULE_CONFIG.enabled,
    lightStart: config.lightStart ?? DEFAULT_SCHEDULE_CONFIG.lightStart,
    lightEnd: config.lightEnd ?? DEFAULT_SCHEDULE_CONFIG.lightEnd,
  })
  mount(ctx, autoReviewFix, toPlain(config.autoReviewFix) ?? DEFAULT_AUTO_REVIEW_CONFIG)
  mount(ctx, taskGuard, toPlain(config.taskGuard) ?? DEFAULT_TASK_GUARD_CONFIG)
  const restartConfig = (toPlain(config.restart) ?? DEFAULT_RESTART_CONFIG) as { appPath?: unknown }
  mount(ctx, restart, restartConfig)
  const sessionEndConfig = (toPlain(config.sessionEnd) ?? DEFAULT_SESSION_END_CONFIG) as Record<string, unknown>
  mount(ctx, sessionEnd, {
    ...sessionEndConfig,
    appPath: typeof restartConfig.appPath === 'string' ? restartConfig.appPath : '',
  })
}
