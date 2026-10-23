import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { SESSION_END_API } from '../api.ts'
import { isLoopbackRequest } from '../loopback.ts'
import { sendSessionEndEmail } from './email.ts'
import {
  closeDesktop,
  launchRestart,
  resolveRestartTarget,
  type RestartTarget,
} from '../restart/index.ts'

export const DEFAULT_SESSION_END_CONFIG = {
  enabled: true,
  graceMs: 3000,
  notifyEmailOnAi: true,
  emailSubject: '[DSH 会话后动作] {{actionText}}',
  emailBody: [
    'AI 已请求在本轮会话结束后{{actionText}}。',
    '',
    '会话：{{sessionName}}',
    '会话 ID：{{sessionId}}',
    '时间：{{time}}',
    '理由：{{reason}}',
  ].join('\n'),
} as const

/** Model-facing policy: when the session-end action is appropriate. */
const SESSION_END_GUIDANCE = [
  '[session-end action] set_session_end_action arms one one-shot action after this turn.',
  'Use it only when this turn changed DSH plugin host/client source, build output (lib/), cordis.patch.yml, profile loader entries, or a setting that is read only at startup, and the change has been built and verified.',
  'Do not arm it for ordinary project files, docs/README, tests-only changes, live-applied settings, EDA/MATLAB/STM32 project work, or todo-only changes. Do not arm it when nothing was built, installed, or loaded.',
  'Arm it during the turn, after verification and before the final answer. It runs after the final reply is fully displayed and waits for all running agent turns and background jobs.',
  'Use close only when the user explicitly asks to close DSH. Shutdown is user-only. If you are unsure whether a restart is required, ask the user instead of arming.',
].join(' ')

export const Config = z.object({
  enabled: z.boolean().default(DEFAULT_SESSION_END_CONFIG.enabled).volatile(),
  graceMs: z.number().min(0).max(15000).default(DEFAULT_SESSION_END_CONFIG.graceMs).volatile(),
  notifyEmailOnAi: z.boolean().default(DEFAULT_SESSION_END_CONFIG.notifyEmailOnAi).volatile(),
  emailSubject: z.string().default(DEFAULT_SESSION_END_CONFIG.emailSubject).volatile(),
  emailBody: z.string().default(DEFAULT_SESSION_END_CONFIG.emailBody).volatile(),
}).default(DEFAULT_SESSION_END_CONFIG)

export interface SessionEndOptions {
  enabled?: boolean
  graceMs?: number
  notifyEmailOnAi?: boolean
  emailSubject?: string
  emailBody?: string
  appPath?: string
}

export type SessionEndMode = 'off' | 'restart' | 'close' | 'shutdown'
export type SessionEndRequestedBy = 'none' | 'user' | 'ai'

export interface SessionEndView {
  enabled: boolean
  mode: SessionEndMode
  requestedBy: SessionEndRequestedBy
  waiting: boolean
  runningAgents: number
  runningJobs: number
  available: { restart: boolean; close: boolean; shutdown: boolean }
}

export interface RunningTasks {
  running: boolean
  agents: number
  jobs: number
}

export interface SessionEndDeps {
  enabled?: boolean
  appPath?: string
  platform?: NodeJS.Platform
  graceMs?: number
  pollMs?: number
  resolveTarget?: () => RestartTarget | undefined
  restart?: (target: RestartTarget) => void
  close?: (target?: RestartTarget) => void
  shutdown?: () => void
  hasRunningTasks?: () => RunningTasks
  log?: (message: string) => void
}

export interface SessionEndGlobalAction extends SessionEndView {
  sessionId: string
  label: string
}

export interface SessionEndController {
  get(sessionId: string): SessionEndView
  list(): SessionEndGlobalAction[]
  set(sessionId: string, mode: SessionEndMode, requestedBy: 'user' | 'ai', label?: string): SessionEndView
  onTurnStart(sessionId: string): void
  onTurnEnd(sessionId: string): void
  dispose(): void
}

interface Entry {
  mode: Exclude<SessionEndMode, 'off'>
  requestedBy: 'user' | 'ai'
  label?: string
  waiting: boolean
  runningAgents: number
  runningJobs: number
}

const GRACE_MS = 3000
const POLL_MS = 2000

export function isSessionEndMode(value: unknown): value is SessionEndMode {
  return value === 'off' || value === 'restart' || value === 'close' || value === 'shutdown'
}

function sessionLogPath(): string {
  return join(tmpdir(), 'dsh-mcviseron-session-end.log')
}

function defaultLog(message: string): void {
  try {
    appendFileSync(sessionLogPath(), new Date().toISOString() + ' ' + message + '\n', 'utf8')
  } catch {
    /* diagnostics must never break the action */
  }
}

/** Run the Windows shutdown command; user-selected only. */
export function shutdownComputer(): void {
  if (process.platform !== 'win32') throw new Error('shutdown is available only on Windows')
  execFileSync('shutdown.exe', ['/s', '/t', '5', '/c', 'DSH session ended'], {
    windowsHide: true,
    timeout: 5000,
  })
}

function listAgents(service: unknown): Array<{ id?: unknown; status?: unknown; session?: { id?: unknown } }> {
  try {
    const list = (service as { list?: unknown } | undefined)?.list
    if (typeof list !== 'function') return []
    const value = list.call(service)
    return Array.isArray(value) ? value as Array<{ id?: unknown; status?: unknown; session?: { id?: unknown } }> : []
  } catch {
    return []
  }
}

function listJobs(service: unknown, owner?: string): Array<{ id?: unknown; status?: unknown }> {
  try {
    const list = (service as { list?: unknown } | undefined)?.list
    if (typeof list !== 'function') return []
    const value = list.call(service, owner)
    return Array.isArray(value) ? value as Array<{ id?: unknown; status?: unknown }> : []
  } catch {
    return []
  }
}

/**
 * Count live agent turns and running background jobs. Subagent work is
 * represented by a live agent turn; background jobs are collected both
 * globally and per live owner so an idle owner's job still blocks a restart.
 */
export function inspectRunningTasks(agentService: unknown, jobService: unknown): RunningTasks {
  const agents = listAgents(agentService)
  const runningAgents = agents.filter(agent => agent.status === 'running')
  const owners = new Set<string>()
  for (const agent of agents) {
    const id = typeof agent.id === 'string'
      ? agent.id
      : typeof agent.session?.id === 'string' ? agent.session.id : ''
    if (id !== '') owners.add(id)
  }

  const jobs = new Map<string, { id?: unknown; status?: unknown }>()
  const collect = (owner?: string): void => {
    for (const job of listJobs(jobService, owner)) {
      const id = typeof job.id === 'string' ? job.id : ''
      if (id !== '') jobs.set(id, job)
    }
  }
  collect(undefined)
  for (const owner of owners) collect(owner)
  const runningJobs = [...jobs.values()].filter(job => job.status === 'running' || job.status === 'stopping')
  return {
    running: runningAgents.length > 0 || runningJobs.length > 0,
    agents: runningAgents.length,
    jobs: runningJobs.length,
  }
}

/**
 * Create the in-memory session-end state machine.
 *
 * @param deps - optional seams for tests and for the live desktop services.
 * @returns the controller used by routes, the agent tool, and session events.
 */
export function createSessionEndController(deps: SessionEndDeps = {}): SessionEndController {
  const platform = deps.platform ?? process.platform
  const enabled = deps.enabled ?? true
  const graceMs = deps.graceMs ?? GRACE_MS
  const pollMs = deps.pollMs ?? POLL_MS
  const log = deps.log ?? defaultLog
  const entries = new Map<string, Entry>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let dispatching = false
  const resolveTarget = deps.resolveTarget ?? (() => resolveRestartTarget(
    process.execPath,
    process.ppid,
    existsSync,
    typeof deps.appPath === 'string' ? deps.appPath : '',
    process.argv,
  ))
  const hasRunningTasks = deps.hasRunningTasks ?? (() => ({ running: false, agents: 0, jobs: 0 }))
  const restart = deps.restart ?? launchRestart
  const close = deps.close ?? closeDesktop
  const shutdown = deps.shutdown ?? shutdownComputer

  const cancel = (sessionId: string): void => {
    const timer = timers.get(sessionId)
    if (timer === undefined) return
    clearTimeout(timer)
    timers.delete(sessionId)
  }

  const view = (sessionId: string): SessionEndView => {
    const entry = entries.get(sessionId)
    let available = { restart: false, close: platform === 'win32', shutdown: platform === 'win32' }
    try {
      const target = resolveTarget()
      available = {
        restart: target !== undefined,
        close: target !== undefined || platform === 'win32',
        shutdown: platform === 'win32',
      }
    } catch {
      /* keep the conservative fallback */
    }
    return {
      enabled,
      mode: entry?.mode ?? 'off',
      requestedBy: entry?.requestedBy ?? 'none',
      waiting: entry?.waiting ?? false,
      runningAgents: entry?.runningAgents ?? 0,
      runningJobs: entry?.runningJobs ?? 0,
      available,
    }
  }

  const schedule = (sessionId: string, delay: number): void => {
    cancel(sessionId)
    const timer = setTimeout(() => {
      timers.delete(sessionId)
      pump(sessionId)
    }, delay) as ReturnType<typeof setTimeout> & { unref?: () => void }
    timer.unref?.()
    timers.set(sessionId, timer)
  }

  const fire = (sessionId: string, entry: Entry): void => {
    cancel(sessionId)
    if (dispatching) {
      entries.delete(sessionId)
      return
    }
    // One process action wins. A second session must not schedule another
    // restart/close task while the first is already leaving the process.
    dispatching = true
    for (const [id, timer] of timers) {
      clearTimeout(timer)
      timers.delete(id)
    }
    entries.clear()
    const mode = entry.mode
    try {
      if (mode === 'restart') {
        const target = resolveTarget()
        if (target === undefined) {
          log('restart skipped: desktop app unavailable (session ' + sessionId + ')')
          return
        }
        restart(target)
      } else if (mode === 'close') {
        close(resolveTarget())
      } else {
        shutdown()
      }
    } catch (error) {
      log(mode + ' failed (session ' + sessionId + '): ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  const pump = (sessionId: string): void => {
    const entry = entries.get(sessionId)
    if (entry === undefined) return

    // Only a restart waits for unrelated work. Closing DSH or shutting down the
    // computer is an explicit destructive action and runs after the render grace.
    if (entry.mode === 'restart') {
      let tasks: RunningTasks
      try {
        tasks = hasRunningTasks()
      } catch (error) {
        log('task inspection failed (session ' + sessionId + '): ' + (error instanceof Error ? error.message : String(error)))
        tasks = { running: false, agents: 0, jobs: 0 }
      }
      if (tasks.running) {
        entry.waiting = true
        entry.runningAgents = tasks.agents
        entry.runningJobs = tasks.jobs
        schedule(sessionId, pollMs)
        return
      }
    }

    entry.waiting = false
    fire(sessionId, entry)
  }

  return {
    get(sessionId) {
      return view(sessionId)
    },
    list() {
      return [...entries.entries()].map(([sessionId, entry]) => ({
        sessionId,
        label: entry.label ?? '',
        ...view(sessionId),
      }))
    },
    set(sessionId, mode, requestedBy, label) {
      if (sessionId === '') throw new TypeError('sessionId must be non-empty')
      if (!enabled) throw new Error('session-end actions are disabled')
      if (!isSessionEndMode(mode)) throw new TypeError('unknown session-end mode: ' + String(mode))
      if (requestedBy !== 'user' && requestedBy !== 'ai') throw new TypeError('requestedBy must be user or ai')
      if (requestedBy === 'ai' && mode === 'shutdown') throw new Error('shutdown is user-only')
      if (mode === 'shutdown' && platform !== 'win32') throw new Error('shutdown is available only on Windows')
      if (mode === 'off') {
        cancel(sessionId)
        entries.delete(sessionId)
        return view(sessionId)
      }
      entries.set(sessionId, {
        mode,
        requestedBy,
        ...(label === undefined || label === '' ? {} : { label }),
        waiting: false,
        runningAgents: 0,
        runningJobs: 0,
      })
      return view(sessionId)
    },
    onTurnStart(sessionId) {
      // A new turn cancels only the pending timer; it keeps the armed entry so
      // the action is rescheduled at this turn's end instead of being silently
      // lost when the user follows up during the grace period.
      const entry = entries.get(sessionId)
      if (entry !== undefined) {
        entry.waiting = false
        entry.runningAgents = 0
        entry.runningJobs = 0
      }
      cancel(sessionId)
    },
    onTurnEnd(sessionId) {
      const entry = entries.get(sessionId)
      if (entry === undefined || timers.has(sessionId)) return
      schedule(sessionId, graceMs)
    },
    dispose() {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      entries.clear()
      dispatching = false
    },
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readJsonBody(req: Parameters<WebRoute['handler']>[0]): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > 8 * 1024) return undefined
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

function bodySessionId(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object') return undefined
  const value = (body as { sessionId?: unknown }).sessionId
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Build the state and set routes for the composer control. */
export function makeSessionEndRoutes(controller: SessionEndController): WebRoute[] {
  const seen = new Set<string>()
  const state: WebRoute = {
    kind: 'exact',
    path: SESSION_END_API.state,
    handler: async (req, res): Promise<void> => {
      try {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        if (!isLoopbackRequest(req)) return json(res, 403, { ok: false, error: 'forbidden' })
        const sessionId = bodySessionId(await readJsonBody(req))
        if (sessionId === undefined) return json(res, 400, { ok: false, error: 'sessionId-required' })
        if (!seen.has(sessionId)) {
          seen.add(sessionId)
          defaultLog('state request: session=' + sessionId)
        }
        json(res, 200, { ok: true, ...controller.get(sessionId) })
      } catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }

  const set: WebRoute = {
    kind: 'exact',
    path: SESSION_END_API.set,
    handler: async (req, res): Promise<void> => {
      try {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        if (!isLoopbackRequest(req)) return json(res, 403, { ok: false, error: 'forbidden' })
        const body = await readJsonBody(req)
        const sessionId = bodySessionId(body)
        if (sessionId === undefined) return json(res, 400, { ok: false, error: 'sessionId-required' })
        const mode = (body as { mode?: unknown }).mode
        if (!isSessionEndMode(mode)) return json(res, 400, { ok: false, error: 'mode-invalid' })
        json(res, 200, { ok: true, ...controller.set(sessionId, mode, 'user') })
      } catch (error) {
        json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }

  const global: WebRoute = {
    kind: 'exact',
    path: SESSION_END_API.global,
    handler: (req, res): void => {
      if (req.method !== 'POST' && req.method !== 'GET') {
        json(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      if (!isLoopbackRequest(req)) {
        json(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      json(res, 200, {
        ok: true,
        actions: controller.list().filter(action => action.requestedBy === 'ai' && action.mode !== 'off'),
      })
    },
  }

  return [state, set, global]
}

function serviceOf(ctx: Context, name: string): unknown {
  try {
    const direct = (ctx as unknown as Record<string, unknown>)[name]
    if (direct !== undefined) return direct
  } catch {
    /* fall through */
  }
  try {
    const get = (ctx as unknown as { get?: (key: string) => unknown }).get
    return typeof get === 'function' ? get.call(ctx, name) : undefined
  } catch {
    return undefined
  }
}

function installGuidance(ctx: Context): void {
  const inject = (ctx as unknown as { inject?: (deps: string[], callback: (scope: Context) => void) => unknown }).inject
  if (typeof inject !== 'function') return
  try {
    inject.call(ctx, ['systemPrompt'], (scope) => {
      const systemPrompt = serviceOf(scope, 'systemPrompt') as {
        section?: (section: { name: string; order: number; text: string }) => unknown
      } | undefined
      if (systemPrompt === undefined || typeof systemPrompt.section !== 'function') return
      try {
        systemPrompt.section({
          name: 'plugin:mcviseron-session-end',
          order: 230,
          text: SESSION_END_GUIDANCE,
        })
      } catch (error) {
        defaultLog('guidance registration failed: ' + (error instanceof Error ? error.message : String(error)))
      }
    })
  } catch (error) {
    defaultLog('guidance injection failed: ' + (error instanceof Error ? error.message : String(error)))
  }
}

const emailed = new Map<string, number>()

function installAgentTool(ctx: Context, controller: SessionEndController, options: Required<SessionEndOptions>, log: (message: string) => void): void {
  const inject = (ctx as unknown as { inject?: (deps: string[], callback: (scope: Context) => void) => unknown }).inject
  if (typeof inject !== 'function') return
  try {
    inject.call(ctx, ['tools'], (scope) => {
      const tools = serviceOf(scope, 'tools') as {
        register?: (definition: unknown) => (() => void) | undefined
      } | undefined
      if (tools === undefined || typeof tools.register !== 'function') return
      const definition = {
        name: 'set_session_end_action',
        description: [
          'Set the action DSH performs after the current turn has fully finished.',
          'WHEN TO USE: this turn changed DSH plugin host/client source, build output (lib/), cordis.patch.yml, profile loader entries, or a setting read only at startup, and the change is built and verified.',
          'WHEN NOT TO USE: ordinary project files, docs/README, tests-only changes, live-applied settings, EDA/MATLAB/STM32 work, todo-only changes, or when nothing was built/installed/loaded.',
          'Arm restart during the turn, after verification and before the final answer. It runs after the final reply is fully displayed and waits for all running agent turns and background jobs.',
          'Use close only when the user explicitly asks to close DSH. Shutdown is user-only. If unsure whether a restart is required, ask the user instead of arming.',
        ].join(' '),
        parameters: {
          action: {
            type: 'string',
            required: true,
            enum: ['restart', 'close', 'off'],
            description: 'restart DSH after this turn, close DSH, or clear the pending action',
          },
          reason: {
            type: 'string',
            description: 'Optional short reason shown in the tool result; the user sees the same action in the composer',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['ok', 'action', 'requestedBy', 'message'],
            properties: {
              ok: { type: 'boolean' },
              action: { type: 'string', enum: ['off', 'restart', 'close'] },
              requestedBy: { type: 'string', enum: ['ai'] },
              message: { type: 'string' },
            },
          },
          render: (_args: unknown, value: { message?: unknown }) => [{
            type: 'text',
            text: typeof value?.message === 'string' ? value.message : 'session-end action updated',
          }],
        },
        execute(args: { action?: unknown; reason?: unknown }, exec: { agent?: { session?: { id?: unknown } } }) {
          const sessionId = exec.agent?.session?.id
          if (typeof sessionId !== 'string' || sessionId === '') {
            throw new Error('set_session_end_action requires an owning agent session')
          }
          const action = args.action
          if (action !== 'off' && action !== 'restart' && action !== 'close') {
            throw new Error('action must be restart, close, or off')
          }
          const before = controller.get(sessionId)
          if (action === 'restart' && !before.available.restart) {
            throw new Error('restart is unavailable in this host')
          }
          if (action === 'close' && !before.available.close) {
            throw new Error('close is unavailable in this host')
          }
          const session = exec.agent?.session as { header?: { title?: unknown; name?: unknown }; title?: unknown } | undefined
          const title = session?.header?.title ?? session?.header?.name ?? session?.title
          let label = typeof title === 'string' && title !== '' ? title : ''
          if (label === '') {
            try {
              const titles = serviceOf(ctx, 'sessionTitle') as { get?: (value: unknown) => unknown } | undefined
              const snapshot = titles?.get?.(session)
              const folded = snapshot !== null && typeof snapshot === 'object'
                ? (snapshot as { title?: unknown }).title
                : undefined
              if (typeof folded === 'string' && folded !== '') label = folded
            } catch {
              /* title is best-effort; the global notice falls back to the id */
            }
          }
          controller.set(sessionId, action, 'ai', label)
          if (action !== 'off' && options.notifyEmailOnAi) {
            const key = sessionId + ':' + action
            const now = Date.now()
            const previous = emailed.get(key) ?? 0
            if (now - previous > 60_000) {
              emailed.set(key, now)
              const sessionName = label === '' ? sessionId : label
              void sendSessionEndEmail({
                settings: serviceOf(ctx, 'settings'),
                template: options,
                sessionId,
                sessionName,
                action,
                reason: typeof args.reason === 'string' ? args.reason : '',
              }).then(result => {
                if (!result.sent) log('email reminder skipped: ' + (result.reason ?? 'unknown'))
              }).catch(error => {
                log('email reminder failed: ' + (error instanceof Error ? error.message : String(error)))
              })
            }
          }
          const message = action === 'off'
            ? 'Session-end action cleared.'
            : 'AI requested ' + action + ' after this turn'
              + (action === 'restart' ? '; it waits for running tasks.' : '.')
              + (typeof args.reason === 'string' && args.reason !== '' ? ' Reason: ' + args.reason : '')
          return { ok: true, action, requestedBy: 'ai', message }
        },
      }
      try {
        const dispose = tools.register(definition)
        const effect = (scope as unknown as { effect?: (setup: () => () => void, label: string) => unknown }).effect
        if (typeof effect === 'function' && typeof dispose === 'function') {
          effect.call(scope, () => () => { try { dispose() } catch { /* already disposed */ } }, 'mcviseron-session-end: tool')
        }
      } catch (error) {
        defaultLog('tool registration failed: ' + (error instanceof Error ? error.message : String(error)))
      }
    })
  } catch (error) {
    defaultLog('tool injection failed: ' + (error instanceof Error ? error.message : String(error)))
  }
}

function sessionIdOf(session: unknown): string {
  const id = (session as { id?: unknown } | undefined)?.id
  return typeof id === 'string' ? id : ''
}

export type SessionEndConfig = SessionEndOptions

/** Clamp the externally supplied options before wiring the controller. */
export function normalizeSessionEndOptions(input?: SessionEndConfig): Required<SessionEndOptions> {
  const source = input !== null && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
  const bool = (key: string, fallback: boolean): boolean => typeof source[key] === 'boolean' ? source[key] as boolean : fallback
  const number = (key: string, fallback: number, min: number, max: number): number => {
    const value = source[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
    return Math.min(Math.max(Math.trunc(value), min), max)
  }
  const string = (key: string, fallback: string): string => typeof source[key] === 'string' ? source[key] as string : fallback
  return {
    enabled: bool('enabled', DEFAULT_SESSION_END_CONFIG.enabled),
    graceMs: number('graceMs', DEFAULT_SESSION_END_CONFIG.graceMs, 0, 15000),
    notifyEmailOnAi: bool('notifyEmailOnAi', DEFAULT_SESSION_END_CONFIG.notifyEmailOnAi),
    emailSubject: string('emailSubject', DEFAULT_SESSION_END_CONFIG.emailSubject),
    emailBody: string('emailBody', DEFAULT_SESSION_END_CONFIG.emailBody),
    appPath: string('appPath', ''),
  }
}

export const inject = ['webServer']

/**
 * Mount the session-end routes, agent tool, and turn listener.
 *
 * @param ctx - the component context.
 * @param config - optional desktop app path inherited from the restart group.
 */
export function apply(ctx: Context, config?: SessionEndConfig): void {
  const options = normalizeSessionEndOptions(config)
  const log = defaultLog
  const controller = createSessionEndController({
    enabled: options.enabled,
    graceMs: options.graceMs,
    appPath: options.appPath,
    hasRunningTasks: () => inspectRunningTasks(serviceOf(ctx, 'agents'), serviceOf(ctx, 'jobs')),
  })

  const routes = makeSessionEndRoutes(controller)
  ctx.effect(() => {
    const disposers = routes.map(route => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'mcviseron-session-end: routes')

  if (options.enabled) {
    const root = (ctx as unknown as { root?: unknown }).root
    const eventBus = (root ?? ctx) as {
      on?: (event: string, handler: (session: unknown, event: { type?: unknown }) => void) => unknown
    }
    if (typeof eventBus.on === 'function') {
      ctx.effect(() => {
        const dispose = eventBus.on?.('session/event', (session, event) => {
          const sessionId = sessionIdOf(session)
          if (sessionId === '') return
          if (event?.type === 'turn/start') controller.onTurnStart(sessionId)
          else if (event?.type === 'turn/end') controller.onTurnEnd(sessionId)
        })
        return () => {
          if (typeof dispose === 'function') dispose()
        }
      }, 'mcviseron-session-end: session events')
    }
    installGuidance(ctx)
    installAgentTool(ctx, controller, options, log)
  }

  try {
    ctx.effect(() => () => controller.dispose(), 'mcviseron-session-end: timers')
  } catch {
    /* a host without effects still gets the controller */
  }
}
