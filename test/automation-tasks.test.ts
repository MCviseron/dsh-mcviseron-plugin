import assert from 'node:assert/strict'
import test from 'node:test'
import { makeAutomationTaskTools } from '../src/automation-tasks/index.ts'

const EXEC = { agent: { session: { id: 'session-a' } }, signal: new AbortController().signal }
const RECORD = { id: 'schedule-1', title: 'old', prompt: 'old prompt', kind: 'weekly', scheduledAt: '2026-10-25T01:00:00.000Z' }

function fixture() {
  const calls: Array<{ name: string; value: unknown }> = []
  const schedule = {
    async list(input: unknown) {
      calls.push({ name: 'list', value: input })
      return [RECORD]
    },
    async create(sessionId: string, input: unknown) {
      calls.push({ name: 'create', value: { sessionId, input } })
      return { ...RECORD, ...(input as object) }
    },
    async update(input: unknown) {
      calls.push({ name: 'update', value: input })
      return { record: { ...RECORD, title: 'new' } }
    },
    async delete(input: unknown) {
      calls.push({ name: 'delete', value: input })
      return { id: 'schedule-1', deleted: true }
    },
  }
  const tools = makeAutomationTaskTools(schedule as any)
  const byName = (name: string) => tools.find(tool => tool.name === name)!
  return { calls, tools, byName }
}

test('automation task tools expose valid object input schemas', () => {
  const { tools } = fixture()
  assert.equal(tools.length, 4)
  for (const tool of tools) {
    assert.equal((tool.parameters as any).type, 'object')
    assert.equal((tool.output.schema as any).type, 'object')
    assert.equal(tool.name.startsWith('automation_task_'), true)
  }
})

test('automation_task_list binds the current session', async () => {
  const { byName, calls } = fixture()
  const result = await byName('automation_task_list').execute({}, EXEC) as any
  assert.equal(result.ok, true)
  assert.equal(result.tasks.length, 1)
  assert.deepEqual(calls[0], { name: 'list', value: { sessionId: 'session-a' } })
})

test('automation_task_create validates and persists through the schedule service', async () => {
  const { byName, calls } = fixture()
  const result = await byName('automation_task_create').execute({
    title: ' weekly ',
    prompt: ' do the thing ',
    weekly: { time: '09:00:00', time_zone: 'Asia/Shanghai', weekdays: [6] },
  }, EXEC) as any
  assert.equal(result.ok, true)
  assert.equal(calls[0].name, 'create')
  assert.deepEqual((calls[0].value as any).input.title, 'weekly')
  assert.deepEqual((calls[0].value as any).input.prompt, 'do the thing')
  assert.deepEqual((calls[0].value as any).input.weekly, { time: '09:00:00', time_zone: 'Asia/Shanghai', weekdays: [6] })
})

test('automation_task_create refuses zero or multiple selectors without calling the service', async () => {
  const { byName, calls } = fixture()
  const none = await byName('automation_task_create').execute({ title: 'x', prompt: 'y' }, EXEC) as any
  assert.equal(none.ok, false)
  assert.match(none.error, /exactly one/)
  const many = await byName('automation_task_create').execute({
    title: 'x', prompt: 'y', after_seconds: 10, every_seconds: 60,
  }, EXEC) as any
  assert.equal(many.ok, false)
  assert.equal(calls.length, 0)
})

test('automation_task_update finds the exact task and sends the change', async () => {
  const { byName, calls } = fixture()
  const result = await byName('automation_task_update').execute({
    id: 'schedule-1', prompt: 'new prompt', cron: { expression: '0 9 * * 6', time_zone: 'Asia/Shanghai' },
  }, EXEC) as any
  assert.equal(result.ok, true)
  const update = calls.find(call => call.name === 'update')!.value as any
  assert.equal(update.sessionId, 'session-a')
  assert.equal(update.id, 'schedule-1')
  assert.equal(update.prompt, 'new prompt')
  assert.deepEqual(update.change, { kind: 'cron', cron: { expression: '0 9 * * 6', time_zone: 'Asia/Shanghai' } })
  assert.equal(update.expected.id, 'schedule-1')
})

test('automation_task_update refuses unknown ids and empty changes', async () => {
  const { byName, calls } = fixture()
  const empty = await byName('automation_task_update').execute({ id: 'schedule-1' }, EXEC) as any
  assert.equal(empty.ok, false)
  const missing = await byName('automation_task_update').execute({ id: 'missing', prompt: 'x' }, EXEC) as any
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'schedule_not_found')
  assert.equal(calls.filter(call => call.name === 'update').length, 0)
})

test('automation_task_delete removes the exact task', async () => {
  const { byName, calls } = fixture()
  const result = await byName('automation_task_delete').execute({ id: 'schedule-1' }, EXEC) as any
  assert.equal(result.ok, true)
  assert.deepEqual(calls[0], { name: 'delete', value: { sessionId: 'session-a', id: 'schedule-1' } })
})
