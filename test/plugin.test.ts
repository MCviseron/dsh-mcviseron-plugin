/**
 * Whole-plugin integration: the three components installed together behind one
 * Host entry, with the same loopback bridge the Web GUI uses.
 *
 * `node --experimental-strip-types test/plugin.test.ts`
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../src/index.ts'

const settle = () => new Promise((resolve) => setTimeout(resolve, 25))

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
    describe: () => [{ ns: 'mcviseron', value: { appearance: { enabled: true, lightStart: '08:00', lightEnd: '23:00' } }, revision: 0 }],
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

const config = {
  appearance: { enabled: true, lightStart: '08:00', lightEnd: '23:00' },
  autoReview: { translateApprovalReason: true, keepPresetGuard: true },
  taskGuard: { locale: 'en', staleAfterCalls: 1 },
}

test('the merged Host entry installs all three components into one context', async () => {
  const h = harness()
  const fiber = await h.root.plugin(plugin as never, config as never)
  await settle()
  try {
    // Appearance: the loopback bridge is registered on the Host web server.
    assert.deepEqual(h.routes.map(route => route.path).sort(), [
      '/api/dsh-mcviseron/settings/describe',
      '/api/dsh-mcviseron/settings/mutate',
    ])

    // Auto-review: preset guard + approval translation share the same plugin.
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
    await fiber.dispose()
  }
})

test('the merged Host entry loads with no config at all', async () => {
  const h = harness()
  const fiber = await (h.root.plugin as any)(plugin)
  await settle()
  try {
    assert.equal(h.root.fiber.state, 2)
    assert.equal(h.routes.length, 2)
  } finally {
    await fiber.dispose()
  }
})
