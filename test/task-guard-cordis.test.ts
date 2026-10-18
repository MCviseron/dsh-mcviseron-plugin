/**
 * Task-guard component inside a real Cordis context.
 *
 * `node --experimental-strip-types test/task-guard-cordis.test.ts`
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { installTaskGuard, type TaskGuardConfig } from '../src/components/task-guard/index.ts'

const agent = { session: { id: 'cordis-session' } }
const session = { id: 'cordis-session' }

async function load(config?: TaskGuardConfig): Promise<Context> {
  const ctx = new Context()
  await (ctx.plugin as any)({
    name: 'mcviseron-task-guard-test',
    inject: [],
    apply: (scope: Context) => { installTaskGuard(scope, config) },
  })
  return ctx
}

interface Bus {
  waterfall: (event: string, ...args: unknown[]) => Promise<any>
  emit: (event: string, ...args: unknown[]) => void
}

function bus(ctx: Context): Bus {
  return ctx as unknown as Bus
}

function todo(content: string, status: string) {
  return { content, status }
}

function write(todos: unknown[]) {
  return { name: 'todo_write', arguments: { todos }, agent }
}

function read() {
  return { name: 'read', arguments: {}, agent }
}

async function emitTodo(ctx: Context, todos: unknown[]): Promise<void> {
  bus(ctx).emit('session/event', session, { type: 'todo/write', data: { todos } })
}

function pre(ctx: Context, exec: unknown): Promise<any> {
  return bus(ctx).waterfall('tools/pre-execute', exec, () => Promise.resolve({ kind: 'allow' }))
}

function post(ctx: Context, exec: unknown, result: unknown = { isError: false }): Promise<any> {
  return bus(ctx).waterfall('tools/post-execute', exec, result, () => Promise.resolve({ kind: 'accept' }))
}

function step(ctx: Context): Promise<any> {
  return bus(ctx).waterfall('agent/pre-step', { agent }, () => Promise.resolve({ kind: 'enter', messages: [] }))
}

test('loads in a real Cordis context and keeps a missing-active write successful', async () => {
  const ctx = await load({ locale: 'en' })
  try {
    const list = [todo('A', 'completed'), todo('B', 'pending')]
    assert.equal((await pre(ctx, write(list))).kind, 'allow')
    const decision = await post(ctx, write(list))
    assert.equal(decision.kind, 'accept')
    const notice = decision.additionalContexts[0]
    assert.equal(notice.source.kind, 'plugin:task-guard')
    assert.equal('plugin' in notice.source, false)
    assert.equal(notice.source.form, 'notice')
    assert.match(notice.content[0].text, /no task is in_progress/)
  } finally {
    await ctx.fiber.dispose()
  }
})

test('strict mode denies a missing-active write in a real Cordis context', async () => {
  const ctx = await load({ locale: 'en', rejectMissingActive: true })
  try {
    const decision = await pre(ctx, write([todo('A', 'completed'), todo('B', 'pending')]))
    assert.equal(decision.kind, 'deny')
    assert.match(decision.reason, /todo_write rejected/)
  } finally {
    await ctx.fiber.dispose()
  }
})

test('a real Cordis waterfall delivers one stale notice per step', async () => {
  const ctx = await load({ locale: 'en', staleAfterCalls: 2, repeatEveryCalls: 0 })
  try {
    await emitTodo(ctx, [todo('A', 'in_progress'), todo('B', 'pending')])

    await step(ctx)
    assert.equal((await post(ctx, read())).additionalContexts, undefined)
    const decision = await post(ctx, read())
    assert.match(decision.additionalContexts[0].content[0].text, /2 tool calls/)
  } finally {
    await ctx.fiber.dispose()
  }
})

test('a real Cordis context uses the v3 source on a format-3 session', async () => {
  const ctx = await load({ locale: 'en', staleAfterCalls: 1 })
  const v3Agent = { session: { id: 'cordis-v3', header: { version: 3 } } }
  try {
    bus(ctx).emit('session/event', v3Agent.session, {
      type: 'todo/write',
      data: { todos: [todo('A', 'in_progress')] },
    })
    const decision = await bus(ctx).waterfall(
      'tools/post-execute',
      { name: 'read', arguments: {}, agent: v3Agent },
      { isError: false },
      () => Promise.resolve({ kind: 'accept' }),
    )
    const [notice] = decision.additionalContexts
    assert.equal(notice.source.kind, 'plugin')
    assert.equal(notice.source.plugin, 'task-guard')
  } finally {
    await ctx.fiber.dispose()
  }
})
