import z from '@deepseek-ai/schemastery'
import { DEFAULT_SCHEDULE_CONFIG } from './schedule.ts'

/**
 * The profile entry Config, which IS this plugin's settings namespace on
 * DSH >= 0.2. Every field is `volatile` so the Host settings service exposes
 * it as a live-editable form field and the browser bridge can mutate it
 * without reloading the plugin.
 */
export const Config = z.object({
  enabled: z.boolean().default(DEFAULT_SCHEDULE_CONFIG.enabled).volatile(),
  lightStart: z.string().default(DEFAULT_SCHEDULE_CONFIG.lightStart).volatile(),
  lightEnd: z.string().default(DEFAULT_SCHEDULE_CONFIG.lightEnd).volatile(),
})

/** Raw profile-entry config as the loader hands it to `apply()`. */
export interface McviseronConfig {
  enabled?: boolean
  lightStart?: string
  lightEnd?: string
}
