import { MCVISERON_API } from '../api.ts'
import { MCVISERON_SETTINGS_NAMESPACE } from '../namespace.ts'
import { normalizeScheduleConfig, type ScheduleConfig } from '../schedule.ts'

interface DescribeResponse {
  ok?: boolean
  value?: {
    namespaces?: Array<{ ns?: unknown; value?: unknown; revision?: unknown }>
    writable?: boolean
  }
}

interface MutateResponse {
  ok?: boolean
  value?: { value?: unknown; revision?: unknown }
  code?: string
  message?: string
}

/** Full component config as the Host bridge serializes it. */
export interface PluginConfigView {
  value: Record<string, unknown>
  revision?: number
  writable: boolean
}

/** Result of one component-config write. */
export interface PluginWriteResult {
  ok: boolean
  value?: Record<string, unknown>
  code?: string
  message?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function post(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error('HTTP ' + response.status)
  return await response.json()
}

/**
 * Read the appearance entry through the Host bridge.
 * @returns the stored schedule, or undefined when the bridge or namespace is
 * unavailable (the caller keeps the built-in defaults).
 */
export async function readScheduleConfig(): Promise<ScheduleConfig | undefined> {
  try {
    const body = await post(MCVISERON_API.describe, {}) as DescribeResponse
    if (body.ok !== true) return undefined
    const view = body.value?.namespaces?.find(candidate => String(candidate.ns) === MCVISERON_SETTINGS_NAMESPACE)
    if (view === undefined) return undefined
    return normalizeScheduleConfig(view.value)
  } catch {
    return undefined
  }
}

/**
 * Write the whole appearance config through the Host bridge (one atomic batch,
 * so a partial window can never be persisted).
 * @param config - the desired schedule.
 * @returns the persisted schedule, or undefined when the write was refused.
 */
export async function writeScheduleConfig(config: ScheduleConfig): Promise<ScheduleConfig | undefined> {
  try {
    const body = await post(MCVISERON_API.mutate, {
      ns: MCVISERON_SETTINGS_NAMESPACE,
      ops: [
        { op: 'set', path: ['enabled'], value: config.enabled },
        { op: 'set', path: ['lightStart'], value: config.lightStart },
        { op: 'set', path: ['lightEnd'], value: config.lightEnd },
      ],
    }) as MutateResponse
    if (body.ok !== true) return undefined
    return normalizeScheduleConfig(body.value?.value)
  } catch {
    return undefined
  }
}

/**
 * Read the whole master-entry config (appearance fields + component groups).
 * @returns the config view, or undefined when the bridge/namespace is unavailable.
 */
export async function readPluginConfig(): Promise<PluginConfigView | undefined> {
  try {
    const body = await post(MCVISERON_API.describe, {}) as DescribeResponse
    if (body.ok !== true) return undefined
    const view = body.value?.namespaces?.find(candidate => String(candidate.ns) === MCVISERON_SETTINGS_NAMESPACE)
    if (view === undefined) return undefined
    return {
      value: isRecord(view.value) ? view.value : {},
      revision: typeof view.revision === 'number' ? view.revision : undefined,
      writable: body.value?.writable !== false,
    }
  } catch {
    return undefined
  }
}

/**
 * Write one component-config field through the Host bridge.
 * @param path - nested config path (e.g. ['autoReviewFix', 'translateApprovalReason']).
 * @param value - JSON value validated by the Host bridge.
 * @returns the write result and the freshly read config when accepted.
 */
export async function writePluginConfig(path: readonly string[], value: unknown): Promise<PluginWriteResult> {
  try {
    const body = await post(MCVISERON_API.mutate, {
      ns: MCVISERON_SETTINGS_NAMESPACE,
      ops: [{ op: 'set', path: [...path], value }],
    }) as MutateResponse
    if (body.ok !== true) {
      return { ok: false, code: body.code, message: body.message }
    }
    return {
      ok: true,
      value: isRecord(body.value?.value) ? body.value.value : undefined,
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
