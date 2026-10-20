/**
 * Auto-review component behavior: shutdown preset guard + approval translation.
 *
 * `node --experimental-strip-types test/auto-review.test.ts`
 *
 * Ported from the standalone `dsh-auto-review-restart-fix` suite; the fakes
 * model exactly the two host seams the component wraps.
 */
import assert from 'node:assert/strict'
import test, { beforeEach } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import {
  clearTranslationCache,
  decorateApprovalRequest,
  installAutoReview,
  normalizeConfig,
} from '../src/components/auto-review-fix/index.ts'

// The translation cache lives for the process; isolate every test from the next.
beforeEach(() => { clearTranslationCache() })

const ACTIVE = 2
const UNLOADING = 5

type Services = Record<string, any>

/** Fake host context: exposes services as properties and runs inject callbacks inline. */
function fakeHost(services: Services, root: any = { fiber: { state: ACTIVE } }) {
  const effects: string[] = []
  const handlers = new Map<string, Array<(...args: any[]) => any>>()
  const ctx: any = {
    root,
    effect(body: () => () => void, label: string) {
      effects.push(label)
      body()
    },
    get(name: string) {
      return services[name]
    },
    inject(deps: string[], callback: (scope: unknown) => void) {
      if (deps.every((name) => services[name] !== undefined)) callback(ctx)
      return ctx
    },
    on(event: string, handler: (...args: any[]) => any) {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
      return () => {}
    },
    ...services,
  }
  return { ctx: ctx as Context, raw: ctx, effects, handlers }
}

function approvalOf(ctx: Context): { request: (request: unknown) => Promise<unknown> } {
  return (ctx as unknown as { approval: { request: (request: unknown) => Promise<unknown> } }).approval
}

/** Session header the approval request would carry. */
function routedAgent(provider = 'deepseek-official', model = 'deepseek-flash') {
  return {
    session: {
      id: 'session-1',
      header: { version: 4 },
      requestHeader: () => ({ config: { provider, model } }),
    },
  }
}

/** An LLM whose stream yields one text block. */
function fakeLlm(text: string, calls: any[] = []) {
  return {
    calls,
    stream(options: unknown) {
      calls.push(options)
      return (async function* () {
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

/** The escalation request Auto-review builds under the ask policy. */
function autoReviewRequest(displayOverride?: unknown): any {
  const reason = 'deletes pre-existing production rows outside the session'
  const display = displayOverride ?? {
    en: `Auto review denied this call: ${reason}`,
    zh: `Auto review 拒绝了此调用：${reason}`,
  }
  return {
    agent: routedAgent(),
    toolName: 'pwsh',
    callId: 'call-1',
    reason: `Auto review denied tool "pwsh": ${reason}`,
    displayReason: display,
    signal: undefined,
  }
}

test('preset guard forwards writes while the root fiber is ACTIVE', () => {
  const wrote: string[] = []
  const presets = { set: (_session: unknown, name: string) => { wrote.push(name) } }
  const { ctx } = fakeHost({ permissionPresets: presets })
  installAutoReview(ctx)
  presets.set({ id: 's' }, 'auto')
  assert.deepEqual(wrote, ['auto'])
})

test('preset guard drops writes while the whole host is shutting down', () => {
  const wrote: string[] = []
  const presets = { set: (_session: unknown, name: string) => { wrote.push(name) } }
  const root = { fiber: { state: UNLOADING } }
  const { ctx } = fakeHost({ permissionPresets: presets }, root)
  installAutoReview(ctx)
  presets.set({ id: 's' }, 'danger-full-access')
  assert.deepEqual(wrote, [])

  // The auto-review migration must still work once the host is active again.
  root.fiber.state = ACTIVE
  presets.set({ id: 's' }, 'auto')
  assert.deepEqual(wrote, ['auto'])
})

test('preset guard is order-independent: it survives its own unload', () => {
  const wrote: string[] = []
  const presets = { set: (_session: unknown, name: string) => { wrote.push(name) } }
  const root = { fiber: { state: UNLOADING } }
  const { ctx, effects } = fakeHost({ permissionPresets: presets }, root)
  installAutoReview(ctx)
  // No teardown is registered for the preset wrapper on purpose.
  assert.deepEqual(effects.filter((label) => label.includes('restore set')), [])
  presets.set({ id: 's' }, 'danger-full-access')
  assert.deepEqual(wrote, [])
})

test('preset guard tolerates a host without permissionPresets.set', () => {
  const { ctx } = fakeHost({ permissionPresets: {} })
  assert.doesNotThrow(() => installAutoReview(ctx))
})

test('preset guard fails open when the root fiber state is unreadable', () => {
  const wrote: string[] = []
  const presets = { set: (_session: unknown, name: string) => { wrote.push(name) } }
  const { ctx } = fakeHost({ permissionPresets: presets }, {})
  installAutoReview(ctx)
  presets.set({ id: 's' }, 'auto')
  assert.deepEqual(wrote, ['auto'])
})

test('approval guard appends a Chinese translation and preserves the audited text', async () => {
  const seen: any[] = []
  const approval = { request: async (request: unknown) => { seen.push(request); return 'allowed-once' } }
  const llm = fakeLlm('该操作会删除本会话之外已存在的生产数据行')
  const { ctx } = fakeHost({ approval, llm })
  installAutoReview(ctx)

  const request = autoReviewRequest()
  const outcome = await approvalOf(ctx).request(request)

  assert.equal(outcome, 'allowed-once')
  const forwarded = seen[0]
  assert.notEqual(forwarded, request, 'the borrowed request object must not be mutated')
  assert.ok(forwarded.reason.startsWith(request.reason), 'the audited reason keeps its original text as a prefix')
  assert.match(forwarded.reason, /【审查理由 · 中文翻译】\n该操作会删除本会话之外已存在的生产数据行/)
  assert.equal(forwarded.displayReason.en, request.displayReason.en, 'the English text is untouched')
  assert.equal(
    forwarded.displayReason.zh,
    request.displayReason.zh + '\n\n【审查理由 · 中文翻译】\n该操作会删除本会话之外已存在的生产数据行',
  )
  assert.ok(forwarded.displayReason.zh.startsWith(request.displayReason.zh))
  assert.equal(llm.calls.length, 1)
})

test('approval guard translates only the reviewer note, not the Auto-review lead-in', async () => {
  const approval = { request: async () => 'allowed-once' }
  const llm = fakeLlm('该操作会删除已存在的生产数据行')
  const { ctx } = fakeHost({ approval, llm })
  installAutoReview(ctx)
  await approvalOf(ctx).request(autoReviewRequest())
  const prompt = llm.calls[0].messages[0].content[0].text
  assert.equal(prompt, 'deletes pre-existing production rows outside the session')
  assert.equal(llm.calls[0].provider, 'deepseek-official')
  assert.equal(llm.calls[0].model, 'deepseek-flash')
  assert.equal(llm.calls[0].temperature, 0)
})

test('approval guard caches one translation per source string', async () => {
  const approval = { request: async () => 'allowed-once' }
  const llm = fakeLlm('该操作会删除已存在的生产数据行')
  const { ctx } = fakeHost({ approval, llm })
  installAutoReview(ctx)
  await approvalOf(ctx).request(autoReviewRequest())
  await approvalOf(ctx).request(autoReviewRequest())
  assert.equal(llm.calls.length, 1)
})

test('approval guard leaves unrelated approvals alone', async () => {
  const seen: any[] = []
  const approval = { request: async (request: unknown) => { seen.push(request); return 'allowed-once' } }
  const llm = fakeLlm('不应该被调用')
  const { ctx } = fakeHost({ approval, llm })
  installAutoReview(ctx)
  const request = {
    agent: routedAgent(),
    toolName: 'pwsh',
    reason: 'sandbox escalation',
    displayReason: { en: 'This command needs wider sandbox access.', zh: '此命令需要更宽的沙箱权限。' },
  }
  await approvalOf(ctx).request(request)
  assert.deepEqual(seen[0].displayReason, request.displayReason)
  assert.equal(llm.calls.length, 0)
})

test('approval guard leaves an already-Chinese reviewer note alone', async () => {
  const seen: any[] = []
  const approval = { request: async (request: unknown) => { seen.push(request); return 'allowed-once' } }
  const llm = fakeLlm('不该出现')
  const { ctx } = fakeHost({ approval, llm })
  installAutoReview(ctx)
  const request = {
    agent: routedAgent(),
    toolName: 'pwsh',
    reason: 'Auto review 拒绝了此调用：该操作会删除生产数据',
    displayReason: {
      en: 'Auto review denied this call: 该操作会删除生产数据',
      zh: 'Auto review 拒绝了此调用：该操作会删除生产数据',
    },
  }
  assert.equal(await approvalOf(ctx).request(request), 'allowed-once')
  assert.deepEqual(seen[0], request, 'a Chinese note is not translated again')
  assert.equal(llm.calls.length, 0)
})

test('approval guard keeps hosts that predate displayReason working', async () => {
  const seen: any[] = []
  const approval = { request: async (request: unknown) => { seen.push(request); return 'rejected' } }
  const llm = fakeLlm('不该出现')
  const { ctx } = fakeHost({ approval, llm })
  installAutoReview(ctx)
  const request = { agent: routedAgent(), toolName: 'pwsh', reason: 'Auto review denied tool "pwsh": no' }
  assert.equal(await approvalOf(ctx).request(request), 'rejected')
  assert.equal(seen[0], request)
  assert.equal(llm.calls.length, 0)
})

test('approval guard degrades when the translator fails or times out', async () => {
  const seen: any[] = []
  const approval = { request: async (request: unknown) => { seen.push(request); return 'allowed-once' } }
  const llm = { stream: () => { throw new Error('provider down') } }
  const { ctx } = fakeHost({ approval, llm })
  installAutoReview(ctx)
  const request = autoReviewRequest()
  assert.equal(await approvalOf(ctx).request(request), 'allowed-once')
  assert.deepEqual(seen[0], request, 'an untranslated prompt is better than a failed approval')
})

test('approval guard degrades without an llm service or a session route', async () => {
  const seen: any[] = []
  const approval = { request: async (request: unknown) => { seen.push(request); return 'allowed-once' } }
  const noLlm = fakeHost({ approval })
  installAutoReview(noLlm.ctx)
  const request = autoReviewRequest()
  await approvalOf(noLlm.ctx).request(request)
  assert.deepEqual(seen[0], request)

  const noRoute = fakeHost({ approval, llm: fakeLlm('不该出现') })
  installAutoReview(noRoute.ctx)
  const unrouted = { ...autoReviewRequest(), agent: {} }
  await approvalOf(noRoute.ctx).request(unrouted)
  assert.deepEqual(seen[1].displayReason, unrouted.displayReason)
})

test('approval guard is idempotent when the component is installed twice', async () => {
  const approval = { request: async () => 'allowed-once' }
  const llm = fakeLlm('该操作会删除已存在的生产数据行')
  const { ctx } = fakeHost({ approval, llm })
  installAutoReview(ctx)
  installAutoReview(ctx)
  const forwarded = await decorateApprovalRequest(ctx, normalizeConfig(), autoReviewRequest())
  const again = await decorateApprovalRequest(ctx, normalizeConfig(), forwarded)
  assert.equal(again, forwarded, 'an already translated prompt is not translated twice')
})

test('approval guard honours translateApprovalReason: false', async () => {
  const seen: any[] = []
  const approval = { request: async (request: unknown) => { seen.push(request); return 'allowed-once' } }
  const llm = fakeLlm('不该出现')
  const { ctx } = fakeHost({ approval, llm })
  installAutoReview(ctx, { translateApprovalReason: false })
  const request = autoReviewRequest()
  await approvalOf(ctx).request(request)
  assert.deepEqual(seen[0], request)
  assert.equal(llm.calls.length, 0)
})

test('config defaults and clamping', () => {
  const defaults = normalizeConfig()
  assert.equal(defaults.keepPresetGuard, true)
  assert.equal(defaults.enabled, true)
  assert.equal(defaults.timeoutMs, 6000)
  assert.equal(defaults.maxChars, 4000)
  assert.equal(defaults.provider, '')
  assert.equal(defaults.model, '')

  const clamped = normalizeConfig({ translateTimeoutMs: 1, translateMaxChars: 10_000_000, translateProvider: ' p ', translateModel: 'm', keepPresetGuard: 'no' })
  assert.equal(clamped.timeoutMs, 500)
  assert.equal(clamped.maxChars, 20000)
  assert.equal(clamped.provider, 'p')
  assert.equal(clamped.model, 'm')
  assert.equal(clamped.keepPresetGuard, true, 'non-boolean values fall back to the default')

  assert.equal(normalizeConfig(null).enabled, true)
  assert.equal(normalizeConfig([1, 2]).enabled, true)
})

test('manual rejection relays the auto-review reason to the agent', async () => {
  const approval = { request: async () => 'rejected' }
  const { ctx, handlers } = fakeHost({ approval })
  installAutoReview(ctx)
  const request = autoReviewRequest()

  assert.equal(await approvalOf(ctx).request(request), 'rejected')

  const listener = handlers.get('tools/post-execute')?.[0]
  assert.ok(listener)
  const decision = await listener!({ callId: 'call-1', agent: request.agent }, { isError: true }, async () => ({ kind: 'accept' }))
  const notice = decision.additionalContexts?.[0]
  assert.equal(notice.source.kind, 'plugin:auto-review-fix')
  assert.match(notice.content[0].text, /人工审批被拒绝/)
  assert.match(notice.content[0].text, /deletes pre-existing production rows/)
})

test('the rejection relay ignores non-auto-review approvals and allowed outcomes', async () => {
  const approval = { request: async () => 'rejected' }
  const { ctx, handlers } = fakeHost({ approval })
  installAutoReview(ctx)
  const request = { agent: routedAgent(), toolName: 'write', callId: 'call-2', reason: 'sandbox escalation' }
  await approvalOf(ctx).request(request)

  const listener = handlers.get('tools/post-execute')?.[0]
  assert.ok(listener)
  const decision = await listener!({ callId: 'call-2', agent: request.agent }, { isError: true }, async () => ({ kind: 'accept' }))
  assert.equal(decision.additionalContexts, undefined)

  const allowed = { request: async () => 'allowed-once' }
  const other = fakeHost({ approval: allowed })
  installAutoReview(other.ctx)
  await approvalOf(other.ctx).request(autoReviewRequest())
  const allowedListener = other.handlers.get('tools/post-execute')?.[0]
  assert.ok(allowedListener)
  const allowedDecision = await allowedListener!({ callId: 'call-1', agent: autoReviewRequest().agent }, { isError: true }, async () => ({ kind: 'accept' }))
  assert.equal(allowedDecision.additionalContexts, undefined)
})

test('approval guard translates an English note that quotes Chinese', async () => {
  const seen: any[] = []
  const approval = { request: async (request: unknown) => { seen.push(request); return 'allowed-once' } }
  const llm = fakeLlm('此命令会把本地提交与推送捆绑在一起，并可能触发发布流程。')
  const { ctx } = fakeHost({ approval, llm })
  installAutoReview(ctx)

  const note = 'This command bundles a safe local commit with `git push origin main`, which publishes to the remote repo and can trigger automated release workflows. The current instruction ("这个提示框似乎卡住了？") and the recent "你继续吧" authorize diagnosing the bug, not pushing this non-release commit. Do the commit locally, then ask the user to confirm pushing.'
  const request = {
    agent: routedAgent(),
    toolName: 'pwsh',
    reason: 'Auto review denied tool "pwsh": ' + note,
    displayReason: {
      en: 'Auto review denied this call: ' + note,
      zh: 'Auto review 拒绝了此调用：' + note,
    },
  }

  await approvalOf(ctx).request(request)
  const forwarded = seen[0]
  assert.match(forwarded.reason, /【审查理由 · 中文翻译】/)
  assert.match(forwarded.reason, /此命令会把本地提交与推送捆绑在一起/)
  assert.equal(forwarded.displayReason.en, request.displayReason.en)
  assert.match(forwarded.displayReason.zh, /【审查理由 · 中文翻译】/)
  assert.equal(llm.calls.length, 1)
})
