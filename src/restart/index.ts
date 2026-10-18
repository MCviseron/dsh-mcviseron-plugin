import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { isLoopbackRequest } from '../loopback.ts'

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

export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  /** Optional explicit application executable; empty derives it from the Host process. */
  appPath: z.string().default('').volatile(),
}).default({ enabled: true, appPath: '' })

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
 * @returns the restart target, or undefined outside the desktop application.
 */
export function resolveRestartTarget(
  execPath: string,
  parentPid: number,
  exists: (path: string) => boolean,
  override = '',
  argv: readonly string[] = [],
): RestartTarget | undefined {
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0) return undefined
  const candidate = override.trim() !== '' ? override.trim() : deriveDesktopAppPath(execPath, argv, exists)
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

/**
 * The detached restart helper. It waits for the HTTP response, closes the
 * Electron main, waits for the Host to finish its graceful IPC-disconnect
 * shutdown, clears ELECTRON_RUN_AS_NODE (the Host inherited it), and starts the
 * application again.
 * @param target - PIDs and executable captured before shutdown.
 * @returns PowerShell script text.
 */
export function makeRestartScript(target: RestartTarget): string {
  return [
    'param(',
    '  [Parameter(Mandatory=$true)][int]$MainPid,',
    '  [Parameter(Mandatory=$true)][int]$HostPid,',
    '  [Parameter(Mandatory=$true)][string]$Exe',
    ')',
    "$ErrorActionPreference = 'SilentlyContinue'",
    'Start-Sleep -Milliseconds 900',
    'Stop-Process -Id $MainPid -Force',
    '$mainDeadline = (Get-Date).AddSeconds(20)',
    'while ((Get-Process -Id $MainPid) -and ((Get-Date) -lt $mainDeadline)) { Start-Sleep -Milliseconds 250 }',
    '$hostDeadline = (Get-Date).AddSeconds(15)',
    'while ((Get-Process -Id $HostPid) -and ((Get-Date) -lt $hostDeadline)) { Start-Sleep -Milliseconds 250 }',
    'if (Get-Process -Id $HostPid) { Stop-Process -Id $HostPid -Force }',
    'Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue',
    'Start-Process -FilePath $Exe -WorkingDirectory (Split-Path -Parent $Exe)',
    'Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue',
    '',
  ].join('\r\n')
}

/** Launch the helper outside the Host process tree. */
function launchHelper(target: RestartTarget): void {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mcviseron-restart-'))
  const script = join(dir, 'restart.ps1')
  writeFileSync(script, makeRestartScript(target), 'utf8')
  const child = spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-WindowStyle',
    'Hidden',
    '-File',
    script,
    '-MainPid',
    String(target.mainPid),
    '-HostPid',
    String(target.hostPid),
    '-Exe',
    target.exePath,
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
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
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
      if (!isLoopbackRequest(req)) return json(res, 403, { ok: false, error: 'forbidden' })
      const target = deps.target()
      json(res, 200, target === undefined
        ? { ok: true, available: false, reason: 'desktop-app-unavailable' }
        : { ok: true, available: true, appPath: target.exePath, mainPid: target.mainPid })
    },
  }

  const execute: WebRoute = {
    kind: 'exact',
    path: RESTART_API.execute,
    handler: async (req, res): Promise<void> => {
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
      try {
        deps.launch(target)
      } catch (error) {
        return json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
      lastLaunch = latest
      json(res, 200, { ok: true, restarting: true, appPath: target.exePath })
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
  if (config?.enabled === false) return
  const routes = makeRestartRoutes({
    target: () => resolveRestartTarget(process.execPath, process.ppid, existsSync, config?.appPath ?? '', process.argv),
    launch: launchHelper,
  })
  ctx.effect(() => {
    const disposers = routes.map(route => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'mcviseron-restart: restart routes')
}
