/**
 * Host settings-bridge tests for the appearance entry.
 *
 * `node --experimental-strip-types test/routes.test.ts`
 */
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { makeSettingsRoutes, type SettingsBridge, type SettingsBridgeView } from '../src/routes.ts'
import { MCVISERON_API } from '../src/api.ts'
import { MCVISERON_SETTINGS_NAMESPACE } from '../src/namespace.ts'

class FakeSettings implements SettingsBridge {
  writable = true
  revision = 3
  value: Record<string, unknown> = { enabled: true, lightStart: '08:00', lightEnd: '23:00' }

  describe(): SettingsBridgeView[] {
    return [{ ns: MCVISERON_SETTINGS_NAMESPACE, value: { ...this.value }, revision: this.revision }]
  }

  async mutate(ns: string, ops: readonly { op: 'set' | 'unset'; path: readonly string[]; value?: unknown }[]): Promise<void> {
    assert.equal(ns, MCVISERON_SETTINGS_NAMESPACE)
    for (const op of ops) {
      let target: Record<string, unknown> = this.value
      for (const key of op.path.slice(0, -1)) {
        const next = target[key]
        if (next === null || typeof next !== 'object' || Array.isArray(next)) target[key] = {}
        target = target[key] as Record<string, unknown>
      }
      const field = op.path[op.path.length - 1] as string
      if (op.op === 'set') target[field] = op.value
      else delete target[field]
    }
    this.revision += 1
  }
}

interface Captured {
  status: number
  body: Record<string, unknown>
}

function makeRequest(body: unknown, options: { remoteAddress?: string; origin?: string; fetchSite?: string; method?: string } = {}): unknown {
  const stream = Readable.from([Buffer.from(JSON.stringify(body))])
  return Object.assign(stream, {
    method: options.method ?? 'POST',
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    headers: {
      host: '127.0.0.1:57880',
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      ...(options.fetchSite === undefined ? {} : { 'sec-fetch-site': options.fetchSite }),
    },
  })
}

function call(route: { handler: (req: never, res: never) => void | Promise<void> }, request: unknown): Promise<Captured> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = []
    const res = {
      writeHead(status: number) {
        this.status = status
      },
      status: 0,
      end(body?: unknown) {
        if (body !== undefined) chunks.push(String(body))
        try {
          resolve({ status: this.status, body: JSON.parse(chunks.join('')) as Record<string, unknown> })
        } catch (error) {
          reject(error)
        }
      },
    }
    Promise.resolve(route.handler(request as never, res as never)).catch(reject)
  })
}

function route(path: string, settings: SettingsBridge) {
  const found = makeSettingsRoutes(settings).find(candidate => candidate.path === path)
  assert.notEqual(found, undefined)
  return found!
}

test('describe returns the normalized appearance entry', async () => {
  const settings = new FakeSettings()
  settings.value = { enabled: 'yes', lightStart: '09:15', lightEnd: 'nope', extra: 1 }
  const response = await call(route(MCVISERON_API.describe, settings), makeRequest({}))
  assert.equal(response.status, 200)
  assert.equal(response.body.ok, true)
  const value = response.body.value as { namespaces: Array<{ ns: string; value: unknown; revision: number }>; writable: boolean }
  assert.equal(value.writable, true)
  assert.deepEqual(value.namespaces[0], {
    ns: MCVISERON_SETTINGS_NAMESPACE,
    value: {
      enabled: false,
      lightStart: '09:15',
      lightEnd: '23:00',
      autoReviewFix: {},
      taskGuard: {},
      restart: {},
      sessionEnd: {},
    },
    revision: 3,
  })
})

test('mutate writes the appearance fields and returns the persisted view', async () => {
  const settings = new FakeSettings()
  const response = await call(route(MCVISERON_API.mutate, settings), makeRequest({
    ns: MCVISERON_SETTINGS_NAMESPACE,
    ops: [
      { op: 'set', path: ['enabled'], value: false },
      { op: 'set', path: ['lightStart'], value: '08:30' },
      { op: 'set', path: ['lightEnd'], value: '22:30' },
    ],
  }))
  assert.equal(response.status, 200)
  assert.equal(response.body.ok, true)
  const view = response.body.value as { ns: string; value: Record<string, unknown> }
  assert.equal(view.ns, MCVISERON_SETTINGS_NAMESPACE)
  assert.deepEqual(view.value, {
    enabled: false,
    lightStart: '08:30',
    lightEnd: '22:30',
    autoReviewFix: {},
    taskGuard: {},
    restart: {},
    sessionEnd: {},
  })
  assert.equal(settings.revision, 4)
})

test('mutate rejects an unknown namespace, field, or nested path', async () => {
  const settings = new FakeSettings()
  const wrongNs = await call(route(MCVISERON_API.mutate, settings), makeRequest({ ns: 'other', ops: [{ op: 'set', path: ['enabled'], value: true }] }))
  assert.equal(wrongNs.status, 400)
  const wrongField = await call(route(MCVISERON_API.mutate, settings), makeRequest({ ns: MCVISERON_SETTINGS_NAMESPACE, ops: [{ op: 'set', path: ['smtpPassword'], value: 'x' }] }))
  assert.equal(wrongField.status, 400)
  const nested = await call(route(MCVISERON_API.mutate, settings), makeRequest({ ns: MCVISERON_SETTINGS_NAMESPACE, ops: [{ op: 'set', path: ['appearance', 'enabled'], value: true }] }))
  assert.equal(nested.status, 400)
})

test('mutate accepts nested component config paths and rejects bad values', async () => {
  const settings = new FakeSettings()
  settings.value = {
    enabled: true,
    lightStart: '08:00',
    lightEnd: '23:00',
    autoReviewFix: { translateApprovalReason: true, translateTimeoutMs: 6000 },
    taskGuard: { enabled: true, locale: 'zh', staleAfterCalls: 5 },
  }
  const ok = await call(route(MCVISERON_API.mutate, settings), makeRequest({
    ns: MCVISERON_SETTINGS_NAMESPACE,
    ops: [
      { op: 'set', path: ['autoReviewFix', 'translateApprovalReason'], value: false },
      { op: 'set', path: ['taskGuard', 'locale'], value: 'en' },
      { op: 'set', path: ['taskGuard', 'staleAfterCalls'], value: 3 },
      { op: 'set', path: ['sessionEnd', 'graceMs'], value: 2500 },
      { op: 'set', path: ['sessionEnd', 'notifyEmailOnAi'], value: false },
      { op: 'set', path: ['sessionEnd', 'emailSubject'], value: 'subject' },
    ],
  }))
  assert.equal(ok.status, 200)
  assert.equal(ok.body.ok, true)
  const view = ok.body.value as { value: Record<string, any> }
  assert.equal(view.value.autoReviewFix.translateApprovalReason, false)
  assert.equal(view.value.taskGuard.locale, 'en')
  assert.equal(view.value.taskGuard.staleAfterCalls, 3)
  assert.equal(view.value.sessionEnd.graceMs, 2500)
  assert.equal(view.value.sessionEnd.notifyEmailOnAi, false)
  assert.equal(view.value.sessionEnd.emailSubject, 'subject')

  const badLocale = await call(route(MCVISERON_API.mutate, settings), makeRequest({
    ns: MCVISERON_SETTINGS_NAMESPACE,
    ops: [{ op: 'set', path: ['taskGuard', 'locale'], value: 'fr' }],
  }))
  assert.equal(badLocale.status, 400)
  const badNumber = await call(route(MCVISERON_API.mutate, settings), makeRequest({
    ns: MCVISERON_SETTINGS_NAMESPACE,
    ops: [{ op: 'set', path: ['taskGuard', 'staleAfterCalls'], value: 0 }],
  }))
  assert.equal(badNumber.status, 400)
})

test('mutate rejects a malformed time and a non-boolean toggle', async () => {
  const settings = new FakeSettings()
  const badTime = await call(route(MCVISERON_API.mutate, settings), makeRequest({ ns: MCVISERON_SETTINGS_NAMESPACE, ops: [{ op: 'set', path: ['lightStart'], value: '25:00' }] }))
  assert.equal(badTime.status, 400)
  const badToggle = await call(route(MCVISERON_API.mutate, settings), makeRequest({ ns: MCVISERON_SETTINGS_NAMESPACE, ops: [{ op: 'set', path: ['enabled'], value: 'true' }] }))
  assert.equal(badToggle.status, 400)
})

test('both routes refuse non-loopback and cross-site callers', async () => {
  const settings = new FakeSettings()
  const describe = route(MCVISERON_API.describe, settings)
  const mutate = route(MCVISERON_API.mutate, settings)
  const body = { ns: MCVISERON_SETTINGS_NAMESPACE, ops: [{ op: 'set', path: ['enabled'], value: true }] }

  const remote = await call(describe, makeRequest({}, { remoteAddress: '10.0.0.7' }))
  assert.equal(remote.status, 403)
  const crossSite = await call(mutate, makeRequest(body, { fetchSite: 'cross-site' }))
  assert.equal(crossSite.status, 403)
  const foreignOrigin = await call(mutate, makeRequest(body, { origin: 'http://evil.example' }))
  assert.equal(foreignOrigin.status, 403)
})

test('mutate refuses a GET', async () => {
  const settings = new FakeSettings()
  const response = await call(route(MCVISERON_API.mutate, settings), makeRequest({}, { method: 'GET' }))
  assert.equal(response.status, 405)
})
