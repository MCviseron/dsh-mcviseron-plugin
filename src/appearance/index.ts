import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { makeSettingsRoutes, type SettingsBridge } from '../routes.ts'
import { DEFAULT_SCHEDULE_CONFIG } from '../schedule.ts'

/**
 * Appearance component (Host half).
 *
 * The schedule itself runs in the browser, so the Host contributes only the
 * durable Config and the narrow loopback bridge the Appearance row writes
 * through. The auto-generated settings page is switched off because the row is
 * this component's shipped surface.
 */

/** Settings-service faces this component probes. */
interface SettingsFormsFace extends SettingsBridge {
  /** DSH >= 0.2: choose whether the auto-generated Config page is shown. */
  configure?: (presentation: { auto?: boolean }) => () => void
}

export const Config = z.object({
  enabled: z.boolean().default(DEFAULT_SCHEDULE_CONFIG.enabled).volatile(),
  lightStart: z.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).default(DEFAULT_SCHEDULE_CONFIG.lightStart).volatile(),
  lightEnd: z.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).default(DEFAULT_SCHEDULE_CONFIG.lightEnd).volatile(),
}).default({ ...DEFAULT_SCHEDULE_CONFIG })

export interface AppearanceConfig {
  enabled?: boolean
  lightStart?: string
  lightEnd?: string
}

export const inject = ['webServer']

/**
 * Register the loopback settings bridge for the Appearance component.
 * @param ctx - the component's plugin context.
 * @param _config - resolved entry config (the browser reads it live).
 */
export function apply(ctx: Context, _config?: AppearanceConfig): void {
  ctx.inject(['settings'], (sctx) => {
    const settings = sctx.settings as unknown as SettingsFormsFace
    if (typeof settings.configure === 'function') {
      ctx.effect(() => settings.configure!({ auto: false }), 'mcviseron-appearance: settings page policy')
    }
    sctx.effect(() => {
      const disposers = makeSettingsRoutes(settings).map(route => ctx.webServer.register(route))
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'mcviseron-appearance: settings bridge')
  })
}
