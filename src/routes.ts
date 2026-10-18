import type { ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { SettingsConflictError, type SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { MCVISERON_API } from './api.ts'
import { MCVISERON_SETTINGS_NAMESPACE } from './namespace.ts'
import { isLoopbackRequest } from './loopback.ts'
import { normalizeScheduleConfig, parseTimeOfDay } from './schedule.ts'
import { toPlain } from './volatile.ts'

/**
 * One namespace view as the settings service serializes it. Structural on
 * purpose: DSH 0.2's `SettingsForms` returns these fields, and keeping the
 * face local means the bridge is checked against the live object instead of
 * a package copy that may differ from the running Host.
 */
export interface SettingsBridgeView {
  ns: unknown
  value?: unknown
  revision: number
}

/** The provider face this bridge uses; only the two documented calls. */
export interface SettingsBridge {
  readonly writable?: boolean
  describe: (options?: { redactSecrets?: boolean }) => SettingsBridgeView[]
  mutate: (ns: string, ops: readonly SettingsPathOp[], expectedRevision?: number) => Promise<void>
}

const MAX_BODY_BYTES = 8 * 1024

/** One writable config path and its runtime validation rule. */
type FieldRule =
  | { type: 'boolean' }
  | { type: 'time' }
  | { type: 'string' }
  | { type: 'number'; min: number; max: number }
  | { type: 'enum'; values: readonly string[] }
  | { type: 'strings' }

/** Paths the settings bridge may write: appearance fields plus component groups. */
const FIELD_RULES: Record<string, FieldRule> = {
  enabled: { type: 'boolean' },
  lightStart: { type: 'time' },
  lightEnd: { type: 'time' },
  'autoReviewFix.keepPresetGuard': { type: 'boolean' },
  'autoReviewFix.translateApprovalReason': { type: 'boolean' },
  'autoReviewFix.translateTimeoutMs': { type: 'number', min: 500, max: 60000 },
  'autoReviewFix.translateMaxChars': { type: 'number', min: 100, max: 20000 },
  'autoReviewFix.translateProvider': { type: 'string' },
  'autoReviewFix.translateModel': { type: 'string' },
  'taskGuard.enabled': { type: 'boolean' },
  'taskGuard.locale': { type: 'enum', values: ['zh', 'en'] },
  'taskGuard.staleAfterCalls': { type: 'number', min: 1, max: 1000 },
  'taskGuard.repeatEveryCalls': { type: 'number', min: 0, max: 1000 },
  'taskGuard.blockAfterCalls': { type: 'number', min: 0, max: 10000 },
  'taskGuard.rejectMissingActive': { type: 'boolean' },
  'taskGuard.sourceKind': { type: 'enum', values: ['auto', 'v3', 'v4'] },
  'taskGuard.maxListItems': { type: 'number', min: 1, max: 100 },
  'taskGuard.detectStepIntent': { type: 'boolean' },
  'taskGuard.translateTodoContent': { type: 'boolean' },
  'taskGuard.todoTranslationTimeoutMs': { type: 'number', min: 500, max: 15000 },
  'taskGuard.include': { type: 'strings' },
  'taskGuard.exclude': { type: 'strings' },
  'restart.enabled': { type: 'boolean' },
  'restart.appPath': { type: 'string' },
}

function ruleFor(path: unknown): FieldRule | undefined {
  if (!Array.isArray(path) || path.length === 0 || path.length > 2) return undefined
  if (!path.every(part => typeof part === 'string')) return undefined
  return FIELD_RULES[path.join('.')]
}

function validFieldValue(rule: FieldRule, value: unknown): boolean {
  switch (rule.type) {
    case 'boolean': return typeof value === 'boolean'
    case 'time': return typeof value === 'string' && parseTimeOfDay(value) !== undefined
    case 'string': return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= rule.min && value <= rule.max
    case 'enum': return typeof value === 'string' && rule.values.includes(value)
    case 'strings': return Array.isArray(value) && value.every(item => typeof item === 'string')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
  res.end(JSON.stringify(body))
}

async function readJsonBody(req: Parameters<WebRoute['handler']>[0]): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

/**
 * Whether a settings write was refused as stale. Class check plus the stable
 * machine code, because the throwing Host may run a different copy of
 * `@deepseek-ai/dsh-settings` than this plugin's own types.
 */
function isSettingsConflict(error: unknown): boolean {
  if (error instanceof SettingsConflictError) return true
  return (error as { code?: unknown } | null)?.code === 'SETTINGS_CONFLICT'
}

/**
 * Unwrap a settings value that may be a schemastery live reference. DSH 0.2
 * hands `.volatile()` fields through as frozen references exposing `get()`;
 * plain values pass through untouched.
 */
function unwrapValue(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function') {
    try {
      return (value as { get: () => unknown }).get()
    } catch {
      return undefined
    }
  }
  return value
}

/** The browser-facing view: appearance fields plus every component config group. */
function toPluginView(descriptor: SettingsBridgeView): Record<string, unknown> {
  const plain = toPlain(unwrapValue(descriptor.value))
  const record = isRecord(plain) ? plain : {}
  return {
    ns: String(descriptor.ns),
    value: {
      ...normalizeScheduleConfig(plain),
      autoReviewFix: isRecord(record.autoReviewFix) ? record.autoReviewFix : {},
      taskGuard: isRecord(record.taskGuard) ? record.taskGuard : {},
      restart: isRecord(record.restart) ? record.restart : {},
    },
    revision: descriptor.revision,
  }
}

function findView(settings: SettingsBridge): SettingsBridgeView | undefined {
  return settings.describe({ redactSecrets: true }).find(descriptor => String(descriptor.ns) === MCVISERON_SETTINGS_NAMESPACE)
}

/**
 * Build the two loopback routes the Appearance row uses to read and write its
 * namespace. DSH 0.2's settings apiproxy only serves official namespaces to
 * the browser, so this plugin owns a narrow bridge (same trust fence as the
 * Host web server: loopback socket, loopback Host header, same-origin POST).
 * @param settings - the Host settings service face.
 * @returns routes to register on the Host web server.
 */
export function makeSettingsRoutes(settings: SettingsBridge): WebRoute[] {
  const describe: WebRoute = {
    kind: 'exact',
    path: MCVISERON_API.describe,
    handler: async (req, res): Promise<void> => {
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
      if (!isLoopbackRequest(req)) return json(res, 403, { ok: false, error: 'forbidden' })
      const descriptor = findView(settings)
      json(res, 200, {
        ok: true,
        value: {
          namespaces: descriptor === undefined ? [] : [toPluginView(descriptor)],
          writable: settings.writable !== false,
        },
      })
    },
  }

  const mutate: WebRoute = {
    kind: 'exact',
    path: MCVISERON_API.mutate,
    handler: async (req, res): Promise<void> => {
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
      if (!isLoopbackRequest(req)) return json(res, 403, { ok: false, error: 'forbidden' })
      const body = await readJsonBody(req)
      if (body === undefined || typeof body !== 'object' || body === null) {
        return json(res, 400, { ok: false, code: 'settings-rejected', message: 'unreadable JSON body' })
      }
      const record = body as { ns?: unknown; ops?: unknown; expectedRevision?: unknown }
      if (record.ns !== MCVISERON_SETTINGS_NAMESPACE || !Array.isArray(record.ops)) {
        return json(res, 400, { ok: false, code: 'settings-rejected', message: 'malformed settings request' })
      }
      const ops = record.ops as SettingsPathOp[]
      const valid = ops.every((op) => {
        if (op.op !== 'set' && op.op !== 'unset') return false
        const rule = ruleFor(op.path)
        if (rule === undefined) return false
        if (op.op === 'unset') return true
        return validFieldValue(rule, op.value)
      })
      if (!valid) {
        return json(res, 400, { ok: false, code: 'settings-rejected', message: 'malformed settings operation' })
      }
      const expectedRevision = typeof record.expectedRevision === 'number' ? record.expectedRevision : undefined
      try {
        await settings.mutate(MCVISERON_SETTINGS_NAMESPACE, ops, expectedRevision)
      } catch (error) {
        if (isSettingsConflict(error)) {
          return json(res, 200, { ok: false, code: 'settings-conflict', message: error instanceof Error ? error.message : 'settings conflict' })
        }
        const message = error instanceof Error ? error.message : String(error)
        return json(res, 200, { ok: false, code: 'settings-rejected', message })
      }
      const descriptor = findView(settings)
      if (descriptor === undefined) {
        return json(res, 200, { ok: false, code: 'internal', message: 'mcviseron settings namespace was disposed' })
      }
      json(res, 200, { ok: true, value: toPluginView(descriptor) })
    },
  }

  return [describe, mutate]
}
