import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

/**
 * DSH's official schedule tools are mounted only in presets that declare
 * @deepseek-ai/dsh-tool-schedule. The current agent often does not have them,
 * which makes an otherwise session-bound automation task impossible to edit
 * from the conversation. These tools call the Host ctx.schedule service
 * directly; every mutation is persisted by that service.
 */

interface ScheduleRecord {
  id: string
  title: string
  prompt: string
  kind: string
  scheduledAt: string
  [key: string]: unknown
}

interface ScheduleService {
  list(filter: { sessionId: string }): Promise<ScheduleRecord[]>
  create(sessionId: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<ScheduleRecord>
  update(input: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>
  delete(input: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>
}

interface ToolExecution {
  agent?: { session?: { id?: string } }
  signal?: AbortSignal
}

interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render: (args: unknown, value: unknown) => Array<{ type: 'text'; text: string }>
  }
  execute: (args: Record<string, any>, exec: ToolExecution) => Promise<unknown>
}

const OUTPUT_SCHEMA = { type: 'object', additionalProperties: true }
const SELECTOR_KEYS = ['after_seconds', 'at', 'every_seconds', 'daily', 'weekly', 'cron'] as const

function output(): ToolDefinition['output'] {
  return {
    schema: OUTPUT_SCHEMA,
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

function log(message: string): void {
  try {
    appendFileSync(join(tmpdir(), 'dsh-mcviseron-automation-tasks.log'), new Date().toISOString() + ' ' + message + '\n', 'utf8')
  } catch {
    /* diagnostics must never break registration */
  }
}

function sessionIdOf(exec: ToolExecution): string {
  const id = exec.agent?.session?.id
  return typeof id === 'string' ? id : ''
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function selectorCount(args: Record<string, unknown>, keys: readonly string[]): number {
  return keys.filter(key => args[key] !== undefined).length
}

function timingChange(args: Record<string, unknown>): Record<string, unknown> | undefined {
  if (args.at !== undefined) return { kind: 'at', at: args.at }
  if (args.every_seconds !== undefined) return { kind: 'every', every_seconds: args.every_seconds }
  if (args.daily !== undefined) return { kind: 'daily', daily: args.daily }
  if (args.weekly !== undefined) return { kind: 'weekly', weekly: args.weekly }
  if (args.cron !== undefined) return { kind: 'cron', cron: args.cron }
  return undefined
}

function invalid(message: string): { ok: false; code: 'invalid'; error: string } {
  return { ok: false, code: 'invalid', error: message }
}

function serviceFailure(error: unknown): { ok: false; code: 'service_error'; error: string } {
  return { ok: false, code: 'service_error', error: error instanceof Error ? error.message : String(error) }
}

function validateCreate(args: Record<string, unknown>): string | undefined {
  if (!text(args.title)) return 'title must be a non-empty string'
  if (!text(args.prompt)) return 'prompt must be a non-empty string'
  const count = selectorCount(args, SELECTOR_KEYS)
  if (count !== 1) return 'supply exactly one of after_seconds, at, every_seconds, daily, weekly, or cron'
  if (args.after_seconds !== undefined && (!Number.isSafeInteger(args.after_seconds) || Number(args.after_seconds) <= 0)) {
    return 'after_seconds must be a positive integer'
  }
  if (args.every_seconds !== undefined && (!Number.isSafeInteger(args.every_seconds) || Number(args.every_seconds) < 60)) {
    return 'every_seconds must be an integer of at least 60'
  }
  if (args.at !== undefined && !text(args.at)) return 'at must be a non-empty ISO date-time string'
  return undefined
}

function validateUpdate(args: Record<string, unknown>): string | undefined {
  if (!text(args.id)) return 'id must be a non-empty string'
  const keys = ['at', 'every_seconds', 'daily', 'weekly', 'cron']
  if (selectorCount(args, keys) > 1) return 'update accepts at most one timing selector'
  if (args.every_seconds !== undefined && (!Number.isSafeInteger(args.every_seconds) || Number(args.every_seconds) < 60)) {
    return 'every_seconds must be an integer of at least 60'
  }
  if (args.title === undefined && args.prompt === undefined && timingChange(args) === undefined) {
    return 'update needs a new title, prompt, or one timing selector'
  }
  if (args.title !== undefined && !text(args.title)) return 'title must be a non-empty string'
  if (args.prompt !== undefined && !text(args.prompt)) return 'prompt must be a non-empty string'
  return undefined
}

const SELECTOR_SCHEMA = {
  after_seconds: { type: 'number', description: 'Delay in whole seconds; create only.' },
  at: { type: 'string', description: 'Absolute RFC 3339 date-time with offset.' },
  every_seconds: { type: 'number', description: 'Fixed interval in whole seconds, at least 60.' },
  daily: {
    type: 'object', additionalProperties: false, required: ['time', 'time_zone'],
    properties: { time: { type: 'string' }, time_zone: { type: 'string' } },
  },
  weekly: {
    type: 'object', additionalProperties: false, required: ['time', 'time_zone', 'weekdays'],
    properties: {
      time: { type: 'string' },
      time_zone: { type: 'string' },
      weekdays: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 7 } },
    },
  },
  cron: {
    type: 'object', additionalProperties: false, required: ['expression', 'time_zone'],
    properties: { expression: { type: 'string' }, time_zone: { type: 'string' } },
  },
}

const { after_seconds: _createOnlyAfterSeconds, ...UPDATE_SELECTOR_SCHEMA } = SELECTOR_SCHEMA

const CREATE_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'prompt'],
  properties: {
    title: { type: 'string', description: 'Short task name; no schedule in the title.' },
    prompt: { type: 'string', description: 'Complete instruction delivered when due.' },
    ...SELECTOR_SCHEMA,
  },
}

const UPDATE_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: {
    id: { type: 'string', description: 'Exact schedule id from automation_task_list.' },
    title: { type: 'string' },
    prompt: { type: 'string' },
    ...UPDATE_SELECTOR_SCHEMA,
  },
}

const DELETE_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', description: 'Exact schedule id.' } },
}

const LIST_PARAMETERS = { type: 'object', additionalProperties: false, properties: {} }

/** Build the model-facing tools over one Host Schedule service. */
export function makeAutomationTaskTools(schedule: ScheduleService): ToolDefinition[] {
  return [
    {
      name: 'automation_task_list',
      description: 'List the official automation tasks bound to the current session. Use this before changing a task so you have its exact id and current prompt.',
      parameters: LIST_PARAMETERS,
      output: output(),
      async execute(_args, exec) {
        const sessionId = sessionIdOf(exec)
        if (sessionId === '') return { ok: false, code: 'no_session', error: 'no current session' }
        try {
          return { ok: true, tasks: await schedule.list({ sessionId }) }
        } catch (error) {
          return serviceFailure(error)
        }
      },
    },
    {
      name: 'automation_task_create',
      description: 'Create an official automation task (DSH schedule) bound to the current session. Supply title, prompt, and exactly one timing selector. The Host schedule service persists it immediately; never edit schedule.json by hand.',
      parameters: CREATE_PARAMETERS,
      output: output(),
      async execute(args, exec) {
        const sessionId = sessionIdOf(exec)
        if (sessionId === '') return { ok: false, code: 'no_session', error: 'no current session' }
        const invalidInput = validateCreate(args)
        if (invalidInput !== undefined) return invalid(invalidInput)
        try {
          const record = await schedule.create(sessionId, {
            ...args,
            title: String(args.title).trim(),
            prompt: String(args.prompt).trim(),
          }, exec.signal)
          return { ok: true, task: record }
        } catch (error) {
          return serviceFailure(error)
        }
      },
    },
    {
      name: 'automation_task_update',
      description: 'Update an existing official automation task in place, keeping its id. Supply id plus a new title, prompt, or at most one timing selector. The Host schedule service persists it immediately; this is the supported way to edit an automation task from the conversation.',
      parameters: UPDATE_PARAMETERS,
      output: output(),
      async execute(args, exec) {
        const sessionId = sessionIdOf(exec)
        if (sessionId === '') return { ok: false, code: 'no_session', error: 'no current session' }
        const invalidInput = validateUpdate(args)
        if (invalidInput !== undefined) return invalid(invalidInput)
        try {
          const id = String(args.id)
          const expected = (await schedule.list({ sessionId })).find(record => record.id === id)
          if (expected === undefined) return { ok: false, code: 'schedule_not_found', error: 'automation task not found in this session: ' + id }
          const change = timingChange(args)
          const result = await schedule.update({
            sessionId,
            id,
            expected,
            ...(change === undefined ? {} : { change }),
            ...(args.title === undefined ? {} : { title: String(args.title).trim() }),
            ...(args.prompt === undefined ? {} : { prompt: String(args.prompt).trim() }),
          }, exec.signal)
          if (result.record !== undefined) return { ok: true, task: result.record }
          return { ok: false, ...result }
        } catch (error) {
          return serviceFailure(error)
        }
      },
    },
    {
      name: 'automation_task_delete',
      description: 'Delete an official automation task in the current session. The Host schedule service removes and persists it immediately.',
      parameters: DELETE_PARAMETERS,
      output: output(),
      async execute(args, exec) {
        const sessionId = sessionIdOf(exec)
        if (sessionId === '') return { ok: false, code: 'no_session', error: 'no current session' }
        if (!text(args.id) || String(args.id).trim() !== String(args.id)) {
          return invalid('id must be a non-empty string without surrounding whitespace')
        }
        try {
          const result = await schedule.delete({ sessionId, id: String(args.id) }, exec.signal)
          return { ok: true, ...result }
        } catch (error) {
          return serviceFailure(error)
        }
      },
    },
  ]
}

function serviceOf(scope: Record<string, unknown>, name: string): unknown {
  try {
    if (scope[name] !== undefined) return scope[name]
    const get = scope.get as ((key: string) => unknown) | undefined
    return typeof get === 'function' ? get.call(scope, name) : undefined
  } catch {
    return undefined
  }
}

/** Register tools and the model guidance through the resolved services. */
export function apply(ctx: Context): void {
  const inject = (ctx as unknown as { inject?: (deps: string[], callback: (scope: Context) => void) => unknown }).inject
  if (typeof inject !== 'function') return
  try {
    inject.call(ctx, ['tools', 'schedule'], (scope) => {
      const tools = serviceOf(scope as unknown as Record<string, unknown>, 'tools') as {
        register?: (definition: unknown) => (() => void) | undefined
      } | undefined
      const schedule = serviceOf(scope as unknown as Record<string, unknown>, 'schedule') as ScheduleService | undefined
      if (tools === undefined || typeof tools.register !== 'function' || schedule === undefined) {
        log('schedule tools unavailable')
        return
      }
      const dispose = makeAutomationTaskTools(schedule).map(definition => {
        try {
          return tools.register?.(definition)
        } catch (error) {
          log('tool registration failed: ' + (error instanceof Error ? error.message : String(error)))
          return undefined
        }
      }).filter((item): item is () => void => typeof item === 'function')
      const effect = (scope as unknown as { effect?: (body: () => () => void, label: string) => unknown }).effect
      if (typeof effect === 'function') {
        effect.call(scope, () => () => {
          for (const disposeTool of dispose) {
            try { disposeTool() } catch { /* already disposed */ }
          }
        }, 'mcviseron-automation-tasks: tools')
      }
    })
  } catch (error) {
    log('tool injection failed: ' + (error instanceof Error ? error.message : String(error)))
  }

  try {
    inject.call(ctx, ['systemPrompt'], (scope) => {
      const systemPrompt = serviceOf(scope as unknown as Record<string, unknown>, 'systemPrompt') as {
        section?: (value: unknown) => unknown
      } | undefined
      if (typeof systemPrompt?.section === 'function') {
        systemPrompt.section({
          name: 'plugin:mcviseron-automation-tasks',
          order: 232,
          text: [
            'Official DSH automation tasks are writable from this conversation.',
            'Use automation_task_list / automation_task_create / automation_task_update / automation_task_delete; they call the Host schedule service and persist automatically.',
            'Never edit ~/.dsh/storages/schedule.json by hand, and never tell the user to use a command to change a task when these tools are available.',
          ].join(' '),
        })
      }
    })
  } catch (error) {
    log('system prompt section unavailable: ' + (error instanceof Error ? error.message : String(error)))
  }
}
