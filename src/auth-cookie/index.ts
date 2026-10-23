import { createHash } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { AUTH_COOKIE_API } from '../api.ts'
import { isLoopbackRequest } from '../loopback.ts'

export const AUTH_COOKIE_PREFIX = 'dsh-auth-'
const EXPIRED_AT = 'Thu, 01 Jan 1970 00:00:00 GMT'

function logPrune(authority: string, pruned: number): void {
  try {
    appendFileSync(
      join(tmpdir(), 'dsh-mcviseron-auth-cookie.log'),
      new Date().toISOString() + ' pruned=' + pruned + ' authority=' + authority + '\n',
      'utf8',
    )
  } catch {
    /* diagnostics must never break cookie hygiene */
  }
}

/** Mirror DSH's browser-auth cookie name for one request authority. */
export function authCookieName(authority: string): string {
  return AUTH_COOKIE_PREFIX + createHash('sha256').update(authority).digest('base64url')
}

/**
 * Mirror dsh-client-connection's requestAudience: HTTP cookies are keyed by
 * host:port, TLS cookies by the origin. Chromium itself ignores the port.
 */
export function requestAuthority(host: unknown, secure: boolean): string | undefined {
  if (typeof host !== 'string' || host === '') return undefined
  try {
    const url = new URL((secure ? 'https:' : 'http:') + '//' + host)
    return secure ? url.origin : url.host
  } catch {
    return undefined
  }
}

function validAuthCookieName(name: string): boolean {
  if (!name.startsWith(AUTH_COOKIE_PREFIX)) return false
  return /^[A-Za-z0-9_-]+$/.test(name.slice(AUTH_COOKIE_PREFIX.length))
}

/** Extract only syntactically valid dsh-auth-* names from a Cookie header. */
export function authCookieNames(header: unknown): string[] {
  if (typeof header !== 'string' || header === '') return []
  const names = new Set<string>()
  for (const segment of header.split(';')) {
    const at = segment.indexOf('=')
    const name = (at === -1 ? segment : segment.slice(0, at)).trim()
    if (validAuthCookieName(name)) names.add(name)
  }
  return [...names]
}

/** Names that are not the cookie this launch just minted. */
export function staleAuthCookieNames(header: unknown, currentName: string): string[] {
  return authCookieNames(header).filter(name => name !== currentName)
}

/** A deletion Set-Cookie matching the generated cookie's Path/host-only scope. */
export function expiredAuthCookie(name: string, secure: boolean): string {
  return name + '=; Max-Age=0; Path=/; Expires=' + EXPIRED_AT
    + '; HttpOnly; SameSite=Strict' + (secure ? '; Secure' : '')
}

/** Build the deletion headers for one request, keeping the current cookie. */
export function pruneCookieHeaders(req: IncomingMessage, secure: boolean): string[] {
  const authority = requestAuthority(req.headers.host, secure)
  if (authority === undefined) return []
  const current = authCookieName(authority)
  return staleAuthCookieNames(req.headers.cookie, current).map(name => expiredAuthCookie(name, secure))
}

/** Head script: prune before the application's modules issue their own calls. */
export function pruneScript(): string {
  return '(function(){try{fetch(' + JSON.stringify(AUTH_COOKIE_API.prune)
    + ',{method:"POST",credentials:"same-origin",cache:"no-store"}).catch(function(){})}catch(e){}})()'
}

function json(res: ServerResponse, status: number, body: unknown, extra: Record<string, string | string[]> = {}): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extra,
  })
  res.end(JSON.stringify(body))
}

/** Host route used by the head script and the client fallback. */
export function makeAuthCookieRoutes(options: { secure: () => boolean }): WebRoute[] {
  const route: WebRoute = {
    kind: 'exact',
    path: AUTH_COOKIE_API.prune,
    handler: (req, res): void => {
      if (req.method !== 'POST') {
        json(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      if (!isLoopbackRequest(req)) {
        json(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      const secure = options.secure()
      const authority = requestAuthority(req.headers.host, secure)
      if (authority === undefined) {
        json(res, 400, { ok: false, error: 'host-required' })
        return
      }
      const stale = staleAuthCookieNames(req.headers.cookie, authCookieName(authority))
      logPrune(authority, stale.length)
      const extra: Record<string, string | string[]> = stale.length === 0
        ? {}
        : { 'set-cookie': stale.map(name => expiredAuthCookie(name, secure)) }
      json(res, 200, { ok: true, pruned: stale.length }, extra)
    },
  }
  return [route]
}

function eventBusOf(ctx: Context): { on?: (event: string, handler: (table: unknown) => void) => unknown } {
  const root = (ctx as unknown as { root?: unknown }).root
  return (root ?? ctx) as { on?: (event: string, handler: (table: unknown) => void) => unknown }
}

function installIndexInjection(ctx: Context): void {
  const bus = eventBusOf(ctx)
  if (typeof bus.on !== 'function') return
  try {
    ctx.effect(() => {
      const dispose = bus.on?.('webserver/index-inject', (table) => {
        if (!Array.isArray(table)) return
        table.push({ kind: 'script', placement: 'head', text: pruneScript() })
      })
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    }, 'mcviseron-auth-cookie: index injection')
  } catch {
    /* a host without effects still gets the route */
  }
}

export const inject = ['webServer']

/**
 * DSH's per-launch dsh-auth-<hash(host:port)> cookie is host-scoped in
 * Chromium, so every restart otherwise leaves another 30-day cookie behind.
 * This component expires every old dsh-auth-* cookie while keeping the one for
 * the current authority. It runs entirely inside the plugin and survives DSH
 * upgrades; it does not change the desktop application.
 */
export function apply(ctx: Context): void {
  const secure = (): boolean => {
    try {
      return ctx.webServer.protocol === 'https:'
    } catch {
      return false
    }
  }
  const routes = makeAuthCookieRoutes({ secure })
  ctx.effect(() => {
    const disposers = routes.map(route => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'mcviseron-auth-cookie: prune route')
  installIndexInjection(ctx)
}
