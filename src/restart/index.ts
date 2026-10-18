import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { isLoopbackRequest } from '../loopback.ts'
import { toPlain } from '../volatile.ts'

/**
 * Restart component.
 *
 * DSH's own tray menu is built inside the Electron main process, so a plugin
 * running in the Host child process cannot add a tray item. This component
 * provides the closest supported equivalent: a Settings row that restarts the
 * desktop application, implemented with a detached helper that closes the
 * Electron main process (the Host then shuts down gracefully over its IPC
 * disconnect) and starts the application again.
 */

export const DEFAULT_RESTART_CONFIG = { enabled: true, appPath: '' } as const

export const Config = z.object({
  enabled: z.boolean().default(DEFAULT_RESTART_CONFIG.enabled).volatile(),
  /** Optional explicit application executable; empty derives it from the Host process. */
  appPath: z.string().default(DEFAULT_RESTART_CONFIG.appPath).volatile(),
}).default(DEFAULT_RESTART_CONFIG)

export interface RestartConfig {
  enabled?: boolean
  appPath?: string
}

/** The desktop executable and the two PIDs the helper must wait for. */
export interface RestartTarget {
  mainPid: number
  hostPid: number
  exePath: string
}

/** Loopback endpoints owned by the restart component. */
export const RESTART_API = {
  status: '/api/dsh-mcviseron/restart/status',
  execute: '/api/dsh-mcviseron/restart/execute',
} as const

/**
 * Resolve the desktop application from the Host process.
 *
 * The desktop Host is a child of the Electron main process and is launched
 * through the application executable in Node mode, so `process.execPath` is the
 * app itself. A plain `dsh web` Host runs under node.exe and is not restartable.
 *
 * @param execPath - the Host's `process.execPath`.
 * @param parentPid - the Host's `process.ppid`.
 * @param exists - file-existence probe (injectable for tests).
 * @param override - configured application path.
 * @param argv - the Host's process.argv.
 * @param platform - host platform (injectable for tests).
 * @returns the restart target, or undefined outside the Windows desktop app.
 */
export function resolveRestartTarget(
  execPath: string,
  parentPid: number,
  exists: (path: string) => boolean,
  override = '',
  argv: readonly string[] = [],
  platform: NodeJS.Platform = process.platform,
): RestartTarget | undefined {
  if (platform !== 'win32') return undefined
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0) return undefined
  const configured = typeof override === 'string' ? override.trim() : ''
  const candidate = configured !== '' ? configured : deriveDesktopAppPath(execPath, argv, exists)
  if (candidate === '' || !exists(candidate)) return undefined
  const name = basename(candidate).toLowerCase()
  if (name === 'node' || name === 'node.exe') return undefined
  return { mainPid: parentPid, hostPid: process.pid, exePath: candidate }
}

/**
 * Derive the desktop application executable when the Host itself runs under a
 * plain node.exe: first `argv[0]`, then the application root recovered from the
 * runtime directory (`<app>\resources\app.asar\dsh`).
 *
 * @param execPath - the Host's `process.execPath`.
 * @param argv - the Host's `process.argv`.
 * @param exists - file-existence probe.
 * @returns the application executable, or the original execPath.
 */
export function deriveDesktopAppPath(
  execPath: string,
  argv: readonly string[],
  exists: (path: string) => boolean,
): string {
  const isNode = (value: string): boolean => /^node(\.exe)?$/i.test(basename(value))
  if (!isNode(execPath)) return execPath
  const argv0 = argv[0] ?? ''
  if (argv0 !== '' && argv0 !== execPath && !isNode(argv0) && exists(argv0)) return argv0
  const runtimeDir = argv[2] ?? ''
  if (runtimeDir === '') return execPath
  const candidate = join(resolve(runtimeDir, '../../..'), 'DeepSeek Harness.exe')
  return exists(candidate) ? candidate : execPath
}

/** One-time task that starts the desktop application directly. */
const RESTART_TASK_NAME = 'DSH-MCviseron-Restart'
const RESTART_DELAY_SECONDS = 6

/** Shared diagnostic log written by the Host around the scheduled restart. */
function restartLogPath(): string {
  return join(tmpdir(), 'dsh-mcviseron-restart.log')
}

/**
 * Build the Task Scheduler registration script. The task ACTION is the desktop
 * executable itself, so the relaunch is not a console/terminal child: the
 * hidden PowerShell only registers the task and exits. Task Scheduler then
 * starts the application directly in the interactive user session.
 * @param target - PIDs and executable captured before shutdown.
 * @param taskName - one-time task name, overwritten on every restart.
 * @param delaySeconds - how long the task waits before starting the application.
 * @returns PowerShell registration script text.
 */
export function makeTaskScript(target: RestartTarget, taskName: string, delaySeconds: number): string {
  const quote = (value: string): string => "'" + value.replace(/'/g, "''") + "'"
  return [
    '$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name',
    `$action = New-ScheduledTaskAction -Execute ${quote(target.exePath)} -WorkingDirectory ${quote(dirname(target.exePath))}`,
    `$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(${delaySeconds})`,
    '$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited',
    `Register-ScheduledTask -TaskName ${quote(taskName)} -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null`,
    '',
  ].join('\n')
}

/** Register the direct-launch task, then close the Electron main process. */
function launchHelper(target: RestartTarget): void {
  const logFile = restartLogPath()
  try {
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle',
      'Hidden',
      '-Command',
      makeTaskScript(target, RESTART_TASK_NAME, RESTART_DELAY_SECONDS),
    ], { windowsHide: true, timeout: 20_000, encoding: 'utf8' })
    appendFileSync(logFile, `${new Date().toISOString()} host: scheduled ${target.exePath} in ${RESTART_DELAY_SECONDS}s\n`, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    appendFileSync(logFile, `${new Date().toISOString()} host: task registration failed: ${message}\n`, 'utf8')
    throw new Error('cannot schedule the restart task: ' + message, { cause: error })
  }
  setTimeout(() => {
    try {
      process.kill(target.mainPid)
      appendFileSync(logFile, `${new Date().toISOString()} host: kill sent to ${target.mainPid}\n`, 'utf8')
    } catch (error) {
      appendFileSync(logFile, `${new Date().toISOString()} host: kill failed: ${error instanceof Error ? error.message : String(error)}\n`, 'utf8')
    }
  }, 700)
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

/** Injectable faces so route tests never spawn a real restart. */
export interface RestartRouteDeps {
  target: () => RestartTarget | undefined
  launch: (target: RestartTarget) => void
  now?: () => number
}

/**
 * Build the status and execute routes.
 * @param deps - target resolution, launcher, and clock.
 * @returns routes for the Host web server.
 */
export function makeRestartRoutes(deps: RestartRouteDeps): WebRoute[] {
  let lastLaunch = Number.NEGATIVE_INFINITY
  const now = deps.now ?? (() => Date.now())

  const status: WebRoute = {
    kind: 'exact',
    path: RESTART_API.status,
    handler: async (req, res): Promise<void> => {
      try {
        if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        if (!isLoopbackRequest(req)) return json(res, 403, { ok: false, error: 'forbidden' })
        const target = deps.target()
        json(res, 200, target === undefined
          ? { ok: true, available: false, reason: 'desktop-app-unavailable' }
          : { ok: true, available: true, appPath: target.exePath, mainPid: target.mainPid })
      } catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }

  const execute: WebRoute = {
    kind: 'exact',
    path: RESTART_API.execute,
    handler: async (req, res): Promise<void> => {
      try {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        if (!isLoopbackRequest(req)) return json(res, 403, { ok: false, error: 'forbidden' })
        const body = await readJsonBody(req)
        if (body === undefined || typeof body !== 'object' || body === null || (body as { confirm?: unknown }).confirm !== true) {
          return json(res, 400, { ok: false, error: 'confirmation-required' })
        }
        const latest = now()
        if (latest - lastLaunch < 5000) return json(res, 429, { ok: false, error: 'restart-already-scheduled' })
        const target = deps.target()
        if (target === undefined) return json(res, 409, { ok: false, error: 'desktop-app-unavailable' })
        deps.launch(target)
        lastLaunch = latest
        json(res, 200, { ok: true, restarting: true, appPath: target.exePath })
      } catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }

  return [status, execute]
}

export const inject = ['webServer']

/**
 * Register the restart routes.
 * @param ctx - the component's plugin context.
 * @param config - the entry Config.
 */
export function apply(ctx: Context, config?: RestartConfig): void {
  const plain = (toPlain(config) ?? {}) as RestartConfig
  if (plain.enabled === false) return
  const appPath = typeof plain.appPath === 'string' ? plain.appPath : ''
  const routes = makeRestartRoutes({
    target: () => resolveRestartTarget(process.execPath, process.ppid, existsSync, appPath, process.argv),
    launch: launchHelper,
  })
  ctx.effect(() => {
    const disposers = routes.map(route => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'mcviseron-restart: restart routes')
}
