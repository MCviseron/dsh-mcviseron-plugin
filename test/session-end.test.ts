import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSessionEndController,
  inspectRunningTasks,
  makeSessionEndRoutes,
  type SessionEndDeps,
} from '../src/session-end/index.ts'
import { Context } from '@deepseek-ai/cordis'
import * as sessionEnd from '../src/session-end/index.ts'
import {
  emailNotifyConfigFromView,
  renderSessionEndEmail,
  sendSessionEndEmail,
} from '../src/session-end/email.ts'

const TARGET = { mainPid: 1, hostPid: 2, exePath: 'C:/DeepSeek Harness.exe' }

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function fixture(overrides: SessionEndDeps = {}) {
  const calls: string[] = []
  const controller = createSessionEndController({
    platform: 'win32',
    graceMs: 10,
    pollMs: 10,
    resolveTarget: () => TARGET,
    restart: () => { calls.push('restart') },
    close: () => { calls.push('close') },
    shutdown: () => { calls.push('shutdown') },
    hasRunningTasks: () => ({ running: false, agents: 0, jobs: 0 }),
    log: () => {},
    ...overrides,
  })
  return { controller, calls }
}

test('session-end actions start off and are one-shot', async () => {
  const { controller, calls } = fixture()
  assert.equal(controller.get('s').enabled, true)
  assert.equal(controller.get('s').mode, 'off')

  controller.set('s', 'restart', 'user')
  controller.onTurnEnd('s')
  await sleep(40)

  assert.deepEqual(calls, ['restart'])
  assert.equal(controller.get('s').mode, 'off')
})

test('restart waits for running agent turns and jobs', async () => {
  let running = true
  const { controller, calls } = fixture({
    hasRunningTasks: () => ({ running, agents: running ? 1 : 0, jobs: running ? 1 : 0 }),
  })

  controller.set('s', 'restart', 'user')
  controller.onTurnEnd('s')
  await sleep(30)
  assert.deepEqual(calls, [])
  assert.equal(controller.get('s').waiting, true)
  assert.equal(controller.get('s').runningAgents, 1)
  assert.equal(controller.get('s').runningJobs, 1)

  running = false
  await sleep(50)
  assert.deepEqual(calls, ['restart'])
  assert.equal(controller.get('s').mode, 'off')
})

test('a new turn reschedules a pending action to its own end', async () => {
  const { controller, calls } = fixture()
  controller.set('s', 'restart', 'user')
  controller.onTurnEnd('s')
  controller.onTurnStart('s')
  await sleep(35)
  assert.deepEqual(calls, [])
  assert.equal(controller.get('s').mode, 'restart')
  controller.onTurnEnd('s')
  await sleep(40)
  assert.deepEqual(calls, ['restart'])
  assert.equal(controller.get('s').mode, 'off')
})

test('AI cannot select shutdown; user shutdown is Windows-only and one-shot', async () => {
  const { controller, calls } = fixture()
  assert.throws(() => controller.set('s', 'shutdown', 'ai'), /user-only/)
  controller.set('s', 'shutdown', 'user')
  controller.onTurnEnd('s')
  await sleep(35)
  assert.deepEqual(calls, ['shutdown'])
  assert.equal(controller.get('s').mode, 'off')
})

test('close does not wait for unrelated tasks', async () => {
  const { controller, calls } = fixture({
    hasRunningTasks: () => ({ running: true, agents: 2, jobs: 1 }),
  })
  controller.set('s', 'close', 'user')
  controller.onTurnEnd('s')
  await sleep(35)
  assert.deepEqual(calls, ['close'])
})

test('inspectRunningTasks counts live agent turns and running jobs', () => {
  const agents = {
    list: () => [
      { id: 'a', status: 'running' },
      { id: 'b', status: 'idle' },
    ],
  }
  const jobs = {
    list: (owner?: string) => owner === 'a' ? [{ id: 'job-1', status: 'running' }] : [],
  }
  assert.deepEqual(inspectRunningTasks(agents, jobs), { running: true, agents: 1, jobs: 1 })
  assert.deepEqual(inspectRunningTasks({ list: () => [] }, { list: () => [] }), { running: false, agents: 0, jobs: 0 })
})

test('email integration reads the email-notify namespace and renders placeholders', () => {
  const view = {
    ns: 'email-notify',
    value: {
      enabled: true,
      smtpHost: 'smtp.qq.com',
      smtpPort: 465,
      smtpSecure: true,
      smtpUser: 'user@qq.com',
      smtpPassword: 'secret',
      mailFrom: 'user@qq.com',
      mailTo: 'to@qq.com',
    },
  }
  const email = emailNotifyConfigFromView(view)
  assert.equal(email?.smtpHost, 'smtp.qq.com')
  assert.equal(email?.mailTo, 'to@qq.com')
  assert.equal(emailNotifyConfigFromView({ ns: 'email-notify', value: { enabled: false } }), undefined)

  const rendered = renderSessionEndEmail({ emailSubject: '{{actionText}} / {{sessionName}}', emailBody: '{{sessionId}} {{reason}}' }, {
    sessionId: 'session-1',
    sessionName: 'demo',
    action: 'restart',
    reason: 'plugin changed',
    now: new Date('2026-01-02T03:04:05Z'),
  })
  assert.equal(rendered.subject, '重启 DeepSeek Harness / demo')
  assert.match(rendered.text, /session-1 plugin changed/)
})

test('AI email reminder is sent only when email-notify is sendable', async () => {
  const view = {
    ns: 'email-notify',
    value: {
      enabled: true,
      smtpHost: 'smtp.qq.com',
      smtpPort: 465,
      smtpSecure: true,
      smtpUser: 'user@qq.com',
      smtpPassword: 'secret',
      mailFrom: 'user@qq.com',
      mailTo: 'to@qq.com',
    },
  }
  const settings = { describe: () => [view] }
  const sent: Array<{ subject: string; text: string }> = []
  const result = await sendSessionEndEmail({
    settings,
    template: { notifyEmailOnAi: true, emailSubject: '{{actionText}}', emailBody: '{{sessionId}}' },
    sessionId: 's1',
    sessionName: 'demo',
    action: 'restart',
    reason: 'code changed',
    sendMail: async (_email, message) => { sent.push(message) },
  })
  assert.equal(result.sent, true)
  assert.deepEqual(sent, [{ subject: '重启 DeepSeek Harness', text: 's1' }])

  const skipped = await sendSessionEndEmail({
    settings,
    template: { notifyEmailOnAi: false },
    sessionId: 's1',
    sessionName: 'demo',
    action: 'restart',
    reason: 'code changed',
    sendMail: async () => { throw new Error('must not send') },
  })
  assert.equal(skipped.sent, false)
  assert.equal(skipped.reason, 'disabled')
})

test('the agent tool is registered and can arm restart/close but not shutdown', async () => {
  const root = new Context()
  const registered: any[] = []
  root.provide('webServer', { register: () => () => {} })
  root.provide('tools', { register: (definition: unknown) => { registered.push(definition); return () => {} } })
  root.provide('settings', { describe: () => [] })
  root.provide('agents', { list: () => [] })
  root.provide('jobs', { list: () => [] })
  const fiber = await (root.plugin as any)(sessionEnd, { enabled: true, graceMs: 1000, notifyEmailOnAi: false })
  try {
    await sleep(30)
    const tool = registered.find(item => item?.name === 'set_session_end_action')
    assert.ok(tool)
    assert.deepEqual(tool.output.schema.required, ['ok', 'action', 'requestedBy', 'message'])
    for (const property of Object.values(tool.output.schema.properties)) {
      assert.equal(Object.prototype.hasOwnProperty.call(property, 'required'), false)
    }
    const exec = { agent: { session: { id: 'tool-session' } } }
    const result = await tool.execute({ action: 'off', reason: 'not needed' }, exec)
    assert.equal(result.ok, true)
    assert.equal(result.requestedBy, 'ai')
    assert.equal(result.action, 'off')
    await assert.rejects(async () => tool.execute({ action: 'shutdown' }, exec), /action must be restart, close, or off/)
  } finally {
    await (fiber as any).dispose()
  }
})

test('only one process action is dispatched across sessions', async () => {
  const { controller, calls } = fixture()
  controller.set('a', 'restart', 'ai', 'Alpha')
  controller.set('b', 'restart', 'ai', 'Beta')
  controller.onTurnEnd('a')
  controller.onTurnEnd('b')
  await sleep(60)
  assert.deepEqual(calls, ['restart'])
  assert.deepEqual(controller.list(), [])
})

test('global state lists AI-armed actions with their labels', async () => {
  const { controller } = fixture()
  controller.set('a', 'restart', 'ai', 'Alpha')
  controller.set('b', 'close', 'user', 'Beta')
  const list = controller.list()
  assert.equal(list.length, 2)
  assert.deepEqual(list.find(item => item.sessionId === 'a') && {
    label: list.find(item => item.sessionId === 'a')!.label,
    mode: list.find(item => item.sessionId === 'a')!.mode,
    requestedBy: list.find(item => item.sessionId === 'a')!.requestedBy,
  }, { label: 'Alpha', mode: 'restart', requestedBy: 'ai' })

  const route = makeSessionEndRoutes(controller).find(item => item.path.endsWith('/global'))
  assert.ok(route)
  let status = 0
  let body = ''
  const req = {
    method: 'POST',
    headers: { host: '127.0.0.1:65001' },
    socket: { remoteAddress: '127.0.0.1' },
  } as any
  const res = {
    writeHead(value: number) { status = value; return res },
    end(value: string) { body = value; return res },
  } as any
  await route.handler(req, res)
  assert.equal(status, 200)
  const parsed = JSON.parse(body) as { ok: boolean; actions: Array<{ sessionId: string }> }
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.actions.map(item => item.sessionId), ['a'])
})
