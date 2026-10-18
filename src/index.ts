import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import { componentConfigs, Config, type McviseronConfig } from './config.ts'
import { installAutoReview } from './components/auto-review/index.ts'
import { installTaskGuard, type TaskGuardConfig } from './components/task-guard/index.ts'
import { makeSettingsRoutes, type SettingsBridge } from './routes.ts'

export { Config } from './config.ts'
export { MCVISERON_SETTINGS_NAMESPACE } from './namespace.ts'
export { DEFAULT_SCHEDULE_CONFIG, formatTimeOfDay, nextTransition, normalizeScheduleConfig, parseTimeOfDay, periodAt } from './schedule.ts'
export type { Period, ScheduleConfig } from './schedule.ts'

/** Settings-service faces this plugin probes, newest first. */
interface SettingsFormsFace extends SettingsBridge {
  /** DSH >= 0.2: choose whether the auto-generated Config page is shown. */
  configure?: (presentation: { auto?: boolean }) => () => void
}

export const inject = ['webServer']

/**
 * Host half of the master plugin.
 *
 * Three components share one profile entry (`mcviseron`), one settings
 * namespace, and one lifecycle:
 *
 * - **appearance** — no Host work; the browser half drives the theme and the
 *   loopback bridge persists `appearance.*`.
 * - **auto-review** — wraps `permissionPresets.set` during whole-Host shutdown
 *   and appends a Chinese translation to the manual-approval prompt.
 * - **task-guard** — observes the todo plan and attaches advisory notices.
 *
 * @param ctx - Host plugin context.
 * @param config - resolved profile-entry config.
 */
export function apply(ctx: Context, config?: McviseronConfig): void {
  const groups = componentConfigs(config)
  installAutoReview(ctx, groups.autoReview)
  installTaskGuard(ctx, groups.taskGuard as TaskGuardConfig | undefined)

  ctx.inject(['settings'], (sctx) => {
    const settings = sctx.settings as unknown as SettingsFormsFace
    if (typeof settings.configure === 'function') {
      ctx.effect(() => settings.configure!({ auto: false }), 'mcviseron: settings page policy')
    }
    sctx.effect(() => {
      const disposers = makeSettingsRoutes(settings).map(route => ctx.webServer.register(route))
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'mcviseron: settings bridge')
  })
}
