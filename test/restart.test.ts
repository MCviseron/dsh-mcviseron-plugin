/**
 * Restart component: target resolution, helper script, and route guards.
 *
 * `node --experimental-strip-types test/restart.test.ts`
 */
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { deriveDesktopAppPath, makeRestartRoutes, makeTaskScript, RESTART_API, resolveRestartTarget, type RestartTarget } from '../src/restart/index.ts'

const exists = (path: string) => path === 'D:/DeepSeek Harness/DeepSeek Harness.exe'

test('resolveRestartTarget accepts the desktop executable', () => {
  const target = resolveRestartTarget('D:/DeepSeek Harness/DeepSeek Harness.exe', 4242, exists, '', [], 'win32')
  assert.deepEqual(target, {
    mainPid: 4242,
    hostPid: process.pid,
    exePath: 'D:/DeepSeek Harness/DeepSeek Harness.exe',
  })
})

test('resolveRestartTarget rejects node hosts, missing files, and missing parents', () => {
  assert.equal(resolveRestartTarget('C:/node/node.exe', 4242, () => true, '', [], 'win32'), undefined)
  assert.equal(resolveRestartTarget('D:/DeepSeek Harness/DeepSeek Harness.exe', 0, exists, '', [], 'win32'), undefined)
  assert.equal(resolveRestartTarget('D:/missing.exe', 4242, exists, '', [], 'win32'), undefined)
})

test('resolveRestartTarget honours an explicit appPath override', () => {
  const target = resolveRestartTarget('C:/node/node.exe', 7, (path) => path === 'D:/Custom/app.exe', ' D:/Custom/app.exe ', [], 'win32')
  assert.equal(target?.exePath, 'D:/Custom/app.exe')
})

test('resolveRestartTarget is Windows-only', () => {
  assert.equal(resolveRestartTarget('D:/app.exe', 1, () => true, '', [], 'darwin'), undefined)
  assert.equal(resolveRestartTarget('D:/app.exe', 1, () => true, '', [], 'linux'), undefined)
})

test('resolveRestartTarget tolerates a leaked volatile override', () => {
  const target = resolveRestartTarget('D:/tools/DeepSeek Harness.exe', 1234, () => true, { get: () => '' } as any, [], 'win32')
  assert.deepEqual(target, { mainPid: 1234, hostPid: process.pid, exePath: 'D:/tools/DeepSeek Harness.exe' })
})

test('deriveDesktopAppPath recovers the desktop exe from the runtime directory', () => {
  const runtimeDir = 'D:/DeepSeek Harness/resources/app.asar/dsh'
  const app = join(resolve(runtimeDir, '../../..'), 'DeepSeek Harness.exe')
  const argv = ['C:/node/node.exe', '--expose-internals', runtimeDir, 'C:/profile']
  assert.equal(deriveDesktopAppPath('C:/node/node.exe', argv, (path) => path === app), app)
  assert.equal(deriveDesktopAppPath(app, argv, () => true), app)
})

test('makeTaskScript schedules the application executable directly', () => {
  const target: RestartTarget = { mainPid: 11, hostPid: 22, exePath: 'D:/DeepSeek Harness/DeepSeek Harness.exe' }
  const script = makeTaskScript(target, 'DSH-MCviseron-Restart', 6)
  assert.match(script, /New-ScheduledTaskAction -Execute 'D:\/DeepSeek Harness\/DeepSeek Harness\.exe'/)
  assert.match(script, /-WorkingDirectory 'D:\/DeepSeek Harness'/)
  assert.match(script, /AddSeconds\(6\)/)
  assert.match(script, /Register-ScheduledTask/)
  assert.doesNotMatch(script, /Start-Process/)
})

interface Captured {
  status: number
  body: Record<string, unknown>
}

function makeRequest(body: unknown, options: { remoteAddress?: string; fetchSite?: string } = {}): unknown {
  const stream = Readable.from([Buffer.from(JSON.stringify(body))])
  return Object.assign(stream, {
    method: 'POST',
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    headers: {
      host: '127.0.0.1:57880',
      ...(options.fetchSite === undefined ? {} : { 'sec-fetch-site': options.fetchSite }),
    },
  })
}

function call(route: { handler: (req: never, res: never) => void | Promise<void> }, request: unknown): Promise<Captured> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = []
    const res = {
      writeHead(status: number) { this.status = status },
      status: 0,
      end(body?: unknown) {
        if (body !== undefined) chunks.push(String(body))
        try { resolve({ status: this.status, body: JSON.parse(chunks.join('')) as Record<string, unknown> }) }
        catch (error) { reject(error) }
      },
    }
    Promise.resolve(route.handler(request as never, res as never)).catch(reject)
  })
}

function route(path: string, deps: Parameters<typeof makeRestartRoutes>[0]) {
  const found = makeRestartRoutes(deps).find(candidate => candidate.path === path)
  assert.notEqual(found, undefined)
  return found!
}

const target: RestartTarget = { mainPid: 11, hostPid: 22, exePath: 'D:/DeepSeek Harness/DeepSeek Harness.exe' }

test('status reports availability and the resolved app path', async () => {
  const deps = { target: () => target, launch: () => {}, now: () => 1000 }
  const available = await call(route(RESTART_API.status, deps), makeRequest({}))
  assert.equal(available.status, 200)
  assert.equal(available.body.available, true)
  assert.equal(available.body.appPath, target.exePath)

  const unavailable = await call(route(RESTART_API.status, { target: () => undefined, launch: () => {} }), makeRequest({}))
  assert.equal(unavailable.body.available, false)
})

test('execute requires explicit confirmation and launches once', async () => {
  const launched: RestartTarget[] = []
  const deps = { target: () => target, launch: (value: RestartTarget) => { launched.push(value) }, now: () => 1000 }
  const rejected = await call(route(RESTART_API.execute, deps), makeRequest({}))
  assert.equal(rejected.status, 400)
  assert.equal(launched.length, 0)

  const accepted = await call(route(RESTART_API.execute, deps), makeRequest({ confirm: true }))
  assert.equal(accepted.status, 200)
  assert.equal(accepted.body.restarting, true)
  assert.deepEqual(launched, [target])
})

test('execute rate-limits repeated requests and refuses cross-site callers', async () => {
  let launches = 0
  const deps = { target: () => target, launch: () => { launches += 1 }, now: () => 5000 }
  const execute = route(RESTART_API.execute, deps)
  assert.equal((await call(execute, makeRequest({ confirm: true }))).status, 200)
  assert.equal((await call(execute, makeRequest({ confirm: true }))).status, 429)
  assert.equal(launches, 1)
  const crossSite = await call(execute, makeRequest({ confirm: true }, { fetchSite: 'cross-site' }))
  assert.equal(crossSite.status, 403)
  const remote = await call(execute, makeRequest({ confirm: true }, { remoteAddress: '10.0.0.7' }))
  assert.equal(remote.status, 403)
})
