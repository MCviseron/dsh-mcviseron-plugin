/**
 * Host settings-bridge tests: the two loopback routes the Appearance row uses.
 *
 * `node --experimental-strip-types test/routes.test.ts`
 *
 * The fake request is a real async iterable (the handler streams the body), so
 * the body-size, JSON, method/fence checks and the nested-path guard run
 * against the same code the Host web server calls.
 */
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { makeSettingsRoutes, type SettingsBridge, type SettingsBridgeView } from '../src/routes.ts'
import { MCVISERON_API } from '../src/api.ts'

class FakeSettings implements SettingsBridge {
  writable = true
  revision = 3
  value: Record<string, unknown> = {
    appearance: { enabled: true, lightStart: '08:00', lightEnd: '23:00' },
    autoReview: { keepPresetGuard: true },
    taskGuard: { enabled: true },
  }

  describe(): SettingsBridgeView[] {
    return [{ ns: 'mcviseron', value: structuredClone(this.value), revision: this.revision }]
  }

  async mutate(ns: string, ops: readonly { op: 'set' | 'unset'; path: readonly string[]; value?: unknown }[]): Promise<void> {
    assert.equal(ns, 'mcviseron')
    for (const op of ops) {
      const [group, field] = op.path
      const bucket = this.value[group as string] as Record<string, unknown>
      if (op.op === 'set') bucket[field as string] = op.value
      else delete bucket[field as string]
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

test('describe returns only the normalized appearance group', async () => {
  const settings = new FakeSettings()
  settings.value = {
    appearance: { enabled: 'yes', lightStart: '09:15', lightEnd: 'nope', extra: 1 },
    autoReview: { secret: 'not exposed' },
    taskGuard: { enabled: true },
  }
  const response = await call(route(MCVISERON_API.describe, settings), makeRequest({}))
  assert.equal(response.status, 200)
  assert.equal(response.body.ok, true)
  const value = response.body.value as { namespaces: Array<{ ns: string; value: unknown; revision: number }>; writable: boolean }
  assert.equal(value.writable, true)
  assert.deepEqual(value.namespaces[0], {
    ns: 'mcviseron',
    value: { appearance: { enabled: false, lightStart: '09:15', lightEnd: '23:00' } },
    revision: 3,
  })
})

test('mutate writes the appearance fields and returns the persisted view', async () => {
  const settings = new FakeSettings()
  const response = await call(route(MCVISERON_API.mutate, settings), makeRequest({
    ns: 'mcviseron',
    ops: [
      { op: 'set', path: ['appearance', 'enabled'], value: false },
      { op: 'set', path: ['appearance', 'lightStart'], value: '08:30' },
      { op: 'set', path: ['appearance', 'lightEnd'], value: '22:30' },
    ],
  }))
  assert.equal(response.status, 200)
  assert.equal(response.body.ok, true)
  const view = response.body.value as { ns: string; value: { appearance: Record<string, unknown> } }
  assert.equal(view.ns, 'mcviseron')
  assert.deepEqual(view.value.appearance, { enabled: false, lightStart: '08:30', lightEnd: '22:30' })
  assert.deepEqual((settings.value.appearance as Record<string, unknown>).lightStart, '08:30')
  assert.equal(settings.revision, 4)
})

test('mutate rejects an unknown namespace, group, or field', async () => {
  const settings = new FakeSettings()
  const wrongNs = await call(route(MCVISERON_API.mutate, settings), makeRequest({ ns: 'other', ops: [{ op: 'set', path: ['appearance', 'enabled'], value: true }] }))
  assert.equal(wrongNs.status, 400)
  const wrongGroup = await call(route(MCVISERON_API.mutate, settings), makeRequest({ ns: 'mcviseron', ops: [{ op: 'set', path: ['taskGuard', 'enabled'], value: false }] }))
  assert.equal(wrongGroup.status, 400)
  const wrongField = await call(route(MCVISERON_API.mutate, settings), makeRequest({ ns: 'mcviseron', ops: [{ op: 'set', path: ['appearance', 'smtpPassword'], value: 'x' }] }))
  assert.equal(wrongField.status, 400)
  const flat = await call(route(MCVISERON_API.mutate, settings), makeRequest({ ns: 'mcviseron', ops: [{ op: 'set', path: ['enabled'], value: true }] }))
  assert.equal(flat.status, 400)
})

test('mutate rejects a malformed time and a non-boolean toggle', async () => {
  const settings = new FakeSettings()
  const badTime = await call(route(MCVISERON_API.mutate, settings), makeRequest({ ns: 'mcviseron', ops: [{ op: 'set', path: ['appearance', 'lightStart'], value: '25:00' }] }))
  assert.equal(badTime.status, 400)
  const badToggle = await call(route(MCVISERON_API.mutate, settings), makeRequest({ ns: 'mcviseron', ops: [{ op: 'set', path: ['appearance', 'enabled'], value: 'true' }] }))
  assert.equal(badToggle.status, 400)
})

test('both routes refuse non-loopback and cross-site callers', async () => {
  const settings = new FakeSettings()
  const describe = route(MCVISERON_API.describe, settings)
  const mutate = route(MCVISERON_API.mutate, settings)
  const body = { ns: 'mcviseron', ops: [{ op: 'set', path: ['appearance', 'enabled'], value: true }] }

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
