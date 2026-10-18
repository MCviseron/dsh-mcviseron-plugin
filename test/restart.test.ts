/**
 * Restart component: target resolution, helper script, and route guards.
 *
 * `node --experimental-strip-types test/restart.test.ts`
 */
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { deriveDesktopAppPath, makeRestartRoutes, makeRestartScript, RESTART_API, resolveRestartTarget, type RestartTarget } from '../src/restart/index.ts'

const exists = (path: string) => path === 'D:/DeepSeek Harness/DeepSeek Harness.exe'

test('resolveRestartTarget accepts the desktop executable', () => {
  const target = resolveRestartTarget('D:/DeepSeek Harness/DeepSeek Harness.exe', 4242, exists)
  assert.deepEqual(target, {
    mainPid: 4242,
    hostPid: process.pid,
    exePath: 'D:/DeepSeek Harness/DeepSeek Harness.exe',
  })
})

test('resolveRestartTarget rejects node hosts, missing files, and missing parents', () => {
  assert.equal(resolveRestartTarget('C:/node/node.exe', 4242, () => true), undefined)
  assert.equal(resolveRestartTarget('D:/DeepSeek Harness/DeepSeek Harness.exe', 0, exists), undefined)
  assert.equal(resolveRestartTarget('D:/missing.exe', 4242, exists), undefined)
})

test('resolveRestartTarget honours an explicit appPath override', () => {
  const target = resolveRestartTarget('C:/node/node.exe', 7, (path) => path === 'D:/Custom/app.exe', ' D:/Custom/app.exe ')
  assert.equal(target?.exePath, 'D:/Custom/app.exe')
})

test('deriveDesktopAppPath recovers the desktop exe from the runtime directory', () => {
  const argv = ['C:/node/node.exe', '--expose-internals', 'D:/DeepSeek Harness/resources/app.asar/dsh', 'C:/profile']
  const app = 'D:\\DeepSeek Harness\\DeepSeek Harness.exe'
  assert.equal(deriveDesktopAppPath('C:/node/node.exe', argv, (path) => path === app), app)
  assert.equal(deriveDesktopAppPath('D:/DeepSeek Harness/DeepSeek Harness.exe', argv, () => true), 'D:/DeepSeek Harness/DeepSeek Harness.exe')
})

test('makeRestartScript closes the main process and clears ELECTRON_RUN_AS_NODE', () => {
  const target: RestartTarget = { mainPid: 11, hostPid: 22, exePath: 'D:/DeepSeek Harness/DeepSeek Harness.exe' }
  const script = makeRestartScript(target)
  assert.match(script, /Stop-Process -Id \$MainPid -Force/)
  assert.match(script, /Remove-Item Env:ELECTRON_RUN_AS_NODE/)
  assert.match(script, /Start-Process -FilePath \$Exe/)
  assert.match(script, /\[int\]\$MainPid/)
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
