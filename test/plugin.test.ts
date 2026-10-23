/**
 * Whole-package integration: the three components load as separate bundle
 * entries in one Cordis context, exactly as the bundle patch inserts them.
 *
 * `node --experimental-strip-types test/plugin.test.ts`
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as master from '../src/index.ts'
import { MCVISERON_SETTINGS_NAMESPACE } from '../src/namespace.ts'

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

interface Harness {
  root: Context
  routes: Array<{ path: string }>
  approvals: any[]
  presetWrites: string[]
}

function harness(): Harness {
  const routes: Array<{ path: string }> = []
  const approvals: any[] = []
  const presetWrites: string[] = []
  const root = new Context()
  root.provide('webServer', { register: (route: { path: string }) => { routes.push(route); return () => {} } })
  root.provide('settings', {
    writable: true,
    configure: () => () => {},
    describe: () => [{ ns: MCVISERON_SETTINGS_NAMESPACE, value: { enabled: true, lightStart: '08:00', lightEnd: '23:00' }, revision: 0 }],
    mutate: async () => {},
  })
  root.provide('approval', { request: async (request: unknown) => { approvals.push(request); return 'allowed-once' } })
  root.provide('permissionPresets', { set: (_session: unknown, name: string) => { presetWrites.push(name) } })
  root.provide('llm', {
    stream: () => (async function* () {
      yield { type: 'text-delta', index: 0, text: '该操作会删除已存在的生产数据行' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })(),
  })
  return { root, routes, approvals, presetWrites }
}

async function load(h: Harness): Promise<unknown> {
  const fiber = await (h.root.plugin as any)(master, {
    enabled: true,
    lightStart: '08:00',
    lightEnd: '23:00',
    autoReviewFix: { translateApprovalReason: true, keepPresetGuard: true },
    taskGuard: { locale: 'en', staleAfterCalls: 1 },
    restart: { enabled: true },
  })
  await settle()
  return { dispose: async () => { await (fiber as any).dispose() } }
}

test('the master entry installs all components into one context', async () => {
  const h = harness()
  const bundle = await load(h) as { dispose: () => Promise<void> }
  try {
    // Appearance: the loopback bridge is registered on the Host web server.
    assert.deepEqual(h.routes.map(route => route.path).sort(), [
      '/api/dsh-mcviseron/auth-cookies/prune',
      '/api/dsh-mcviseron/diagnostics',
      '/api/dsh-mcviseron/restart/execute',
      '/api/dsh-mcviseron/restart/status',
      '/api/dsh-mcviseron/session-end/set',
      '/api/dsh-mcviseron/session-end/state',
      '/api/dsh-mcviseron/settings/describe',
      '/api/dsh-mcviseron/settings/mutate',
    ])

    // Auto-review: preset guard + approval translation.
    const request = {
      agent: { session: { requestHeader: () => ({ config: { provider: 'deepseek-official', model: 'deepseek-flash' } }) } },
      toolName: 'pwsh',
      reason: 'Auto review denied tool "pwsh": deletes rows',
      displayReason: { en: 'Auto review denied this call: deletes rows', zh: 'Auto review 拒绝了此调用：deletes rows' },
    }
    assert.equal(await (h.root as any).approval.request(request), 'allowed-once')
    assert.match(h.approvals[0].displayReason.zh, /【审查理由 · 中文翻译】/)
    assert.equal(h.approvals[0].displayReason.en, request.displayReason.en)

    // Task-guard: a pending-without-active write attaches its advisory notice.
    const exec = {
      name: 'todo_write',
      arguments: { todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'pending' }] },
      agent: { session: { id: 'integration-session' } },
    }
    const decision = await (h.root as any).waterfall(
      'tools/post-execute',
      exec,
      { isError: false },
      () => Promise.resolve({ kind: 'accept' }),
    )
    const [notice] = decision.additionalContexts
    assert.equal(notice.source.kind, 'plugin:task-guard')
    assert.match(notice.content[0].text, /no task is in_progress/)
  } finally {
    await bundle.dispose()
  }
})

test('the master entry also loads with no config at all', async () => {
  const h = harness()
  const fiber = await (h.root.plugin as any)(master)
  try {
    await settle()
    assert.equal(h.root.fiber.state, 2)
    assert.equal(h.routes.length, 8)
  } finally {
    await (fiber as any).dispose()
  }
})
