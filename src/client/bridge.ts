import { MCVISERON_API } from '../api.ts'
import { MCVISERON_SETTINGS_NAMESPACE } from '../namespace.ts'
import { normalizeScheduleConfig, type ScheduleConfig } from '../schedule.ts'

interface DescribeResponse {
  ok?: boolean
  value?: {
    namespaces?: Array<{ ns?: unknown; value?: unknown }>
    writable?: boolean
  }
}

interface MutateResponse {
  ok?: boolean
  value?: { value?: unknown }
  code?: string
  message?: string
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
