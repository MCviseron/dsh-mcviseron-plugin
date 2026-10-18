/**
 * Auto-review component inside a real Cordis context.
 *
 * `node --experimental-strip-types test/auto-review-cordis.test.ts`
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { clearTranslationCache, installAutoReview } from '../src/components/auto-review-fix/index.ts'

test.beforeEach(() => { clearTranslationCache() })

/** Wait for cordis to settle child fibers scheduled by ctx.inject. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

/** A host context that provides the given services as plain objects. */
function host(services: Record<string, unknown>): Context {
  const root = new Context()
  for (const [name, value] of Object.entries(services)) root.provide(name, value)
  return root
}

const plugin = {
  name: 'mcviseron-auto-review-test',
  apply: (ctx: Context): void => {
    installAutoReview(ctx)
  },
}

function approvalOf(ctx: Context): { request: (request: unknown) => Promise<unknown> } {
  return (ctx as unknown as { approval: { request: (request: unknown) => Promise<unknown> } }).approval
}

test('the ACTIVE constant still matches the composed cordis', () => {
  const root = new Context()
  // FiberState.ACTIVE; the shutdown guard compares against this number.
  assert.equal(root.fiber.state, 2)
})

test('the component loads into a bare cordis context with no host services', async () => {
  const root = new Context()
  await (root.plugin as any)(plugin)
  await settle()
  assert.equal(root.fiber.state, 2, 'loading must not fail the host fiber')
})

test('the component wraps the real approval service through ctx.inject', async () => {
  const seen: any[] = []
  const approval = { request: async (request: unknown) => { seen.push(request); return 'allowed-once' } }
  const llm = {
    calls: 0,
    stream() {
      this.calls += 1
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: '该操作会删除已存在的生产数据行' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  const presets = { set: () => { throw new Error('the migration must not run while the host shuts down') } }
  const root = host({ approval, llm, permissionPresets: presets })
  await (root.plugin as any)(plugin)
  await settle()

  const request = {
    agent: { session: { requestHeader: () => ({ config: { provider: 'deepseek-official', model: 'deepseek-flash' } }) } },
    toolName: 'pwsh',
    reason: 'Auto review denied tool "pwsh": deletes pre-existing rows',
    displayReason: {
      en: 'Auto review denied this call: deletes pre-existing rows',
      zh: 'Auto review 拒绝了此调用：deletes pre-existing rows',
    },
  }
  assert.equal(await approvalOf(root).request(request), 'allowed-once')
  assert.equal(seen.length, 1)
  assert.equal(seen[0].displayReason.en, request.displayReason.en)
  assert.match(seen[0].displayReason.zh, /^Auto review 拒绝了此调用：deletes pre-existing rows\n\n【审查理由 · 中文翻译】\n该操作会删除已存在的生产数据行$/)
  assert.equal(llm.calls, 1)
})

test('the preset guard is installed on the composed service', async () => {
  const writes: string[] = []
  const presets = { set: (_session: unknown, name: string) => { writes.push(name) } }
  const root = host({ permissionPresets: presets })
  await (root.plugin as any)(plugin)
  await settle()
  presets.set({}, 'auto')
  assert.deepEqual(writes, ['auto'], 'an ACTIVE root must stay a pass-through')
})

test('unloading the component restores the approval service', async () => {
  const original = async () => 'rejected'
  const approval = { request: original }
  const root = host({ approval })
  const fiber = await (root.plugin as any)(plugin)
  await settle()
  assert.notEqual(approval.request, original)
  await fiber.dispose()
  assert.equal(approval.request, original, 'the approval seam is restored on unload')
})
