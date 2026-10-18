import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import { Config, type McviseronConfig } from './config.ts'
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
 * The appearance schedule itself runs in the browser (theme state is a
 * browser concern), so the Host only contributes two things:
 *
 * 1. the profile-entry Config, which IS this plugin's settings namespace on
 *    DSH >= 0.2 and therefore the durable store for `enabled`,
 *    `lightStart`, and `lightEnd`;
 * 2. the narrow loopback bridge the Appearance row writes through, because
 *    the official settings apiproxy does not expose third-party namespaces.
 *
 * The auto-generated settings page is switched off: the Appearance row is the
 * shipped surface for this component (and the only place that can live-update
 * the running driver).
 * @param ctx - Host plugin context.
 * @param _config - resolved profile-entry config (the browser reads it live).
 */
export function apply(ctx: Context, _config?: McviseronConfig): void {
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
