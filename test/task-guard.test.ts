/**
 * Task-guard component behavior: todo plan notices and optional hard stops.
 *
 * `node --experimental-strip-types test/task-guard.test.ts`
 *
 * Ported from the standalone `dsh-task-guard` suite.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { detectStepIntent, installTaskGuard, type TaskGuardConfig } from '../src/components/task-guard/index.ts'

const agent = { session: { id: 'session-1' } }

function todo(content: string, status: string) {
  return { content, status }
}

function write(todos: unknown[], owner = agent) {
  return { name: 'todo_write', arguments: { todos }, agent: owner }
}

function call(name: string, owner = agent, parent?: unknown) {
  return parent === undefined ? { name, arguments: {}, agent: owner } : { name, arguments: {}, agent: owner, parent }
}

type Handler = (...args: any[]) => any

function harness(config?: TaskGuardConfig, owner = agent, services: Record<string, any> = {}) {
  const handlers: Record<string, Handler[]> = {
    'tools/pre-execute': [],
    'tools/post-execute': [],
    'agent/pre-step': [],
    'session/event': [],
    'agent/assistant-stream': [],
  }
  const ctx = {
    on(event: string, listener: Handler) {
      handlers[event].push(listener)
      return () => {}
    },
    get(name: string) {
      return services[name]
    },
  }
  installTaskGuard(ctx as unknown as Context, config)

  const waterfall = (event: string, args: unknown[], base: unknown): Promise<any> => {
    const listeners = handlers[event]
    const dispatch = (index: number): Promise<any> =>
      index >= listeners.length ? Promise.resolve(base) : listeners[index](...args, () => dispatch(index + 1))
    return dispatch(0)
  }

  return {
    pre: (exec: unknown) => waterfall('tools/pre-execute', [exec], { kind: 'allow' }),
    post: (exec: unknown, result: unknown = { isError: false }) =>
      waterfall('tools/post-execute', [exec, result], { kind: 'accept', value: {} }),
    step: () => waterfall('agent/pre-step', [{ agent: owner }], { kind: 'enter', messages: [] }),
    session: (event: unknown) => {
      for (const listener of handlers['session/event']) listener(owner.session, event)
    },
    stream: (frame: unknown) => {
      for (const listener of handlers['agent/assistant-stream']) listener({ frame })
    },
  }
}

async function seed(h: ReturnType<typeof harness>, todos: unknown[]) {
  h.session({ type: 'todo/write', data: { todos } })
}

test('rejects a list that leaves pending work with no active task when strictly configured', async () => {
  const h = harness({ locale: 'en', rejectMissingActive: true })
  const decision = await h.pre(write([todo('A', 'completed'), todo('B', 'pending')]))
  assert.equal(decision.kind, 'deny')
  assert.match(decision.reason, /no task is in_progress/)
})

test('default mode keeps the write successful and adds an advisory notice', async () => {
  const h = harness({ locale: 'en' })
  const list = [todo('A', 'completed'), todo('B', 'pending')]
  assert.equal((await h.pre(write(list))).kind, 'allow')

  const decision = await h.post(write(list))
  const [notice] = decision.additionalContexts
  assert.equal(notice.source.kind, 'plugin:task-guard')
  assert.equal('plugin' in notice.source, false)
  assert.equal(notice.source.form, 'notice')
  assert.match(notice.content[0].text, /no task is in_progress/)
})

test('sourceKind auto uses the v3 producer shape on session format 3', async () => {
  const v3Agent = { session: { id: 'v3-session', header: { version: 3 } } }
  const h = harness({ locale: 'en', staleAfterCalls: 1 }, v3Agent)
  await seed(h, [todo('A', 'in_progress')])

  const decision = await h.post(call('read', v3Agent))
  const [notice] = decision.additionalContexts
  assert.equal(notice.source.kind, 'plugin')
  assert.equal(notice.source.plugin, 'task-guard')
  assert.equal(notice.source.form, 'notice')
})

test('sourceKind can be forced independently of the session header', async () => {
  const h = harness({ locale: 'en', sourceKind: 'v4', staleAfterCalls: 1 })
  await seed(h, [todo('A', 'in_progress')])
  const [notice] = (await h.post(call('read'))).additionalContexts
  assert.equal(notice.source.kind, 'plugin:task-guard')
})

test('allows one active task and an all-completed list', async () => {
  const h = harness()
  assert.equal((await h.pre(write([todo('A', 'in_progress'), todo('B', 'pending')]))).kind, 'allow')
  assert.equal((await h.pre(write([todo('A', 'completed'), todo('B', 'completed')]))).kind, 'allow')
  assert.equal((await h.pre(write([]))).kind, 'allow')
})

test('sends a plugin notice after the stale threshold, not before', async () => {
  const h = harness({ locale: 'en', staleAfterCalls: 2, repeatEveryCalls: 0 })
  await seed(h, [todo('A', 'in_progress'), todo('B', 'pending')])

  assert.deepEqual((await h.post(call('read'))).additionalContexts, undefined)
  const decision = await h.post(call('read'))
  const [notice] = decision.additionalContexts
  assert.equal(notice.source.kind, 'plugin:task-guard')
  assert.equal(notice.source.form, 'notice')
  assert.match(notice.content[0].text, /2 tool calls/)
})

test('a todo write resets the stale counter', async () => {
  const h = harness({ locale: 'en', staleAfterCalls: 2, repeatEveryCalls: 0 })
  await seed(h, [todo('A', 'in_progress'), todo('B', 'pending')])
  await h.post(call('read'))
  await h.post(call('read'))
  await h.post(write([todo('A', 'in_progress'), todo('B', 'pending')]))
  await seed(h, [todo('A', 'in_progress'), todo('B', 'pending')])
  assert.deepEqual((await h.post(call('read'))).additionalContexts, undefined)
  assert.notEqual((await h.post(call('read'))).additionalContexts, undefined)
})

test('repeats the notice at each configured interval', async () => {
  const h = harness({ staleAfterCalls: 1, repeatEveryCalls: 2 })
  await seed(h, [todo('A', 'in_progress'), todo('B', 'pending')])

  assert.notEqual((await h.post(call('read'))).additionalContexts, undefined)
  await h.step()
  assert.equal((await h.post(call('read'))).additionalContexts, undefined)
  assert.notEqual((await h.post(call('read'))).additionalContexts, undefined)
})

test('delivers at most one notice per step for parallel calls', async () => {
  const h = harness({ staleAfterCalls: 1, repeatEveryCalls: 4 })
  await seed(h, [todo('A', 'in_progress'), todo('B', 'pending')])

  const first = await h.post(call('read'))
  const second = await h.post(call('read'))
  assert.notEqual(first.additionalContexts, undefined)
  assert.equal(second.additionalContexts, undefined)
})

test('does not count excluded tools', async () => {
  const h = harness({ staleAfterCalls: 1 })
  await seed(h, [todo('A', 'in_progress')])
  assert.deepEqual((await h.post(call('ask_user_question'))).additionalContexts, undefined)
})

test('turn/start clears the tracked plan', async () => {
  const h = harness({ staleAfterCalls: 1 })
  await seed(h, [todo('A', 'in_progress'), todo('B', 'pending')])
  h.session({ type: 'turn/start', data: {} })
  assert.deepEqual((await h.post(call('read'))).additionalContexts, undefined)
})

test('optionally hard-stops a stale plan', async () => {
  const h = harness({ locale: 'en', staleAfterCalls: 1, blockAfterCalls: 2 })
  await seed(h, [todo('A', 'in_progress'), todo('B', 'pending')])
  await h.post(call('read'))
  await h.step()
  assert.equal((await h.pre(call('read'))).kind, 'allow')
  await h.post(call('read'))
  await h.step()
  const decision = await h.pre(call('read'))
  assert.equal(decision.kind, 'deny')
  assert.match(decision.reason, /Call todo_write first/)
})

test('rejects unknown config fields', () => {
  assert.throws(() => harness({ stale: 5 } as unknown as TaskGuardConfig), /unknown config field "stale"/)
  assert.throws(() => harness({ staleAfterCalls: 0 }), /staleAfterCalls/)
  assert.throws(() => harness({ blockAfterCalls: 2, staleAfterCalls: 2 }), /blockAfterCalls/)
  assert.throws(() => harness({ rejectMissingActive: 'yes' } as unknown as TaskGuardConfig), /rejectMissingActive/)
  assert.throws(() => harness({ requireActive: true } as unknown as TaskGuardConfig), /unknown config field "requireActive"/)
  assert.throws(() => harness({ sourceKind: 'v5' } as unknown as TaskGuardConfig), /sourceKind/)
})

test('detectStepIntent matches English and Chinese step phrases', () => {
  const todos = [
    todo('Implement login endpoint', 'pending'),
    todo('Write documentation', 'pending'),
    todo('Release build', 'completed'),
  ] as any
  assert.equal(detectStepIntent('Now I will implement the login endpoint.', todos)?.todo.content, 'Implement login endpoint')
  assert.equal(detectStepIntent('接下来我会编写文档。', [todo('编写文档', 'pending')] as any)?.todo.content, '编写文档')
  assert.equal(detectStepIntent('Now I will release the build.', todos), undefined, 'completed todos are never suggested')
  assert.equal(detectStepIntent('No intent phrase here.', todos), undefined)
})

test('emits one intent notice per step when reasoning names the next pending task', async () => {
  const owner = { session: { id: 'intent-session', requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) } }
  const h = harness({ locale: 'zh', staleAfterCalls: 99, detectStepIntent: true, translateTodoContent: false }, owner)
  await seed(h, [todo('Implement login endpoint', 'in_progress'), todo('Write docs', 'pending')])
  h.step()
  h.stream({ type: 'chunk', attemptId: 'intent-session:1', chunk: { type: 'reasoning-delta', text: 'Now I will write docs.' } })

  const first = await h.post(call('read', owner))
  const [notice] = first.additionalContexts
  assert.match(notice.content[0].text, /写 docs|Write docs/)
  assert.match(notice.content[0].text, /"todos"/)
  assert.equal((await h.post(call('read', owner))).additionalContexts, undefined, 'at most one intent notice per step')
})

test('translates English todo titles into Chinese inside a notice', async () => {
  const owner = { session: { id: 'translate-session', requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) } }
  const llm = {
    stream: () => (async function* () {
      yield { type: 'text-delta', index: 0, text: '["编写部署文档"]' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })(),
  }
  const h = harness({ locale: 'zh', translateTodoContent: true }, owner, { llm })
  const list = [todo('Write release notes', 'completed'), todo('Write deployment docs', 'pending')]
  const decision = await h.post(write(list, owner))
  const [notice] = decision.additionalContexts
  assert.match(notice.content[0].text, /编写部署文档（Write deployment docs）/)
})
