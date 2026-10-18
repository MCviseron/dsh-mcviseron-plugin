import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { isLoopbackRequest } from '../loopback.ts'
import { json, makeSettingsRoutes, type SettingsBridge } from '../routes.ts'
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

/** Read-only client-module diagnostics used while a settings page is missing. */
const DIAGNOSTICS_PATH = '/api/dsh-mcviseron/diagnostics'

export const inject = ['webServer']

/**
 * Register the loopback settings bridge for the Appearance component.
 * @param ctx - the component's plugin context.
 * @param _config - resolved entry config (the browser reads it live).
 */
export function apply(ctx: Context, _config?: AppearanceConfig): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: DIAGNOSTICS_PATH,
    handler: async (req, res): Promise<void> => {
      try {
        if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        if (!isLoopbackRequest(req)) return json(res, 403, { ok: false, error: 'forbidden' })
        const modules = (ctx as unknown as { get?: (name: string) => unknown }).get?.('clientModules') as {
          clientPath?: (id: string) => string | undefined
          graph?: () => { batches?: unknown[]; entries?: unknown[] }
          release?: unknown
        } | undefined
        const graph = typeof modules?.graph === 'function' ? modules.graph() : undefined
        const batches = Array.isArray(graph?.batches) ? graph.batches : []
        const rows: unknown[] = []
        const batchSummary: unknown[] = []
        for (const batch of batches as Array<{ descriptor?: { phase?: string; entries?: unknown[] }; entries?: unknown[] }>) {
          const entries = batch?.descriptor?.entries ?? batch?.entries ?? []
          batchSummary.push({ phase: batch?.descriptor?.phase, count: entries.length })
          for (const row of entries) rows.push(row)
        }
        const mcviseronRows = rows.filter((row) => JSON.stringify(row).includes('mcviseron'))
        const loaderEntries: unknown[] = []
        const loader = (ctx as unknown as { loader?: { entries?: () => Iterable<{ options?: { name?: string }; disabled?: boolean; fiber?: unknown }> } }).loader
        for (const entry of loader?.entries?.() ?? []) {
          if (String(entry.options?.name ?? '').includes('mcviseron')) {
            loaderEntries.push({ name: entry.options?.name, disabled: Boolean(entry.disabled), fiber: Boolean(entry.fiber) })
          }
        }
        json(res, 200, {
          ok: true,
          clientPath: modules?.clientPath?.('dsh-mcviseron-plugin') ?? null,
          graphKeys: graph !== undefined ? Object.keys(graph) : null,
          batches: batchSummary,
          mcviseronRows,
          loaderEntries,
          release: modules?.release ?? null,
        })
      } catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'mcviseron-appearance: client diagnostics')

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
