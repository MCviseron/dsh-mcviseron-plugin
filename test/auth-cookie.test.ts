import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  AUTH_COOKIE_PREFIX,
  apply,
  authCookieName,
  authCookieNames,
  expiredAuthCookie,
  makeAuthCookieRoutes,
  pruneCookieHeaders,
  pruneScript,
  requestAuthority,
  staleAuthCookieNames,
} from '../src/auth-cookie/index.ts'

interface RequestOptions {
  method?: string
  host?: string
  cookie?: string
  remote?: string
  origin?: string | null
  secFetchSite?: string
}

function fakeRequest(options: RequestOptions = {}): IncomingMessage {
  const host = options.host ?? '127.0.0.1:65001'
  const headers: Record<string, string> = {
    host,
    cookie: options.cookie ?? '',
    'sec-fetch-site': options.secFetchSite ?? 'same-origin',
  }
  if (options.origin !== null) headers.origin = options.origin ?? 'http://' + host
  return {
    method: options.method ?? 'POST',
    url: '/api/dsh-mcviseron/auth-cookies/prune',
    headers,
    socket: { remoteAddress: options.remote ?? '127.0.0.1' },
  } as unknown as IncomingMessage
}

function fakeResponse(): { res: ServerResponse; status: () => number; headers: () => Record<string, unknown>; body: () => string } {
  let status = 0
  let headers: Record<string, unknown> = {}
  let body = ''
  const res = {
    writeHead(value: number, next: Record<string, unknown>) {
      status = value
      headers = next
      return res
    },
    end(chunk?: string) {
      body = chunk ?? ''
      return res
    },
  }
  return { res: res as unknown as ServerResponse, status: () => status, headers: () => headers, body: () => body }
}

test('authCookieName mirrors the DSH browser-auth name', () => {
  const authority = '127.0.0.1:65001'
  const expected = AUTH_COOKIE_PREFIX + createHash('sha256').update(authority).digest('base64url')
  assert.equal(authCookieName(authority), expected)
})

test('requestAuthority keeps HTTP host:port and HTTPS origin', () => {
  assert.equal(requestAuthority('127.0.0.1:65001', false), '127.0.0.1:65001')
  assert.equal(requestAuthority('127.0.0.1:65001', true), 'https://127.0.0.1:65001')
  assert.equal(requestAuthority('localhost:55528', false), 'localhost:55528')
  assert.equal(requestAuthority('bad host', false), undefined)
  assert.equal(requestAuthority(undefined, false), undefined)
})

test('cookie names are restricted to the generated dsh-auth-* shape', () => {
  const current = authCookieName('127.0.0.1:65001')
  const header = 'dsh-auth-old=1; ' + current + '=2; dsh-auth-bad!=3; other=4; dsh-auth-ok=5; dsh-auth-ok=6; dsh-auth-=7'
  assert.deepEqual(authCookieNames(header).sort(), [current, 'dsh-auth-ok', 'dsh-auth-old'].sort())
  assert.deepEqual(staleAuthCookieNames(header, current).sort(), ['dsh-auth-ok', 'dsh-auth-old'].sort())
})

test('deletion headers match the generated cookie attributes', () => {
  const name = authCookieName('127.0.0.1:65001')
  const plain = expiredAuthCookie(name, false)
  assert.match(plain, /^dsh-auth-[A-Za-z0-9_-]+=;/u)
  assert.match(plain, /Max-Age=0/u)
  assert.match(plain, /Path=\//u)
  assert.match(plain, /HttpOnly/u)
  assert.match(plain, /SameSite=Strict/u)
  assert.doesNotMatch(plain, /; Secure$/u)
  assert.match(expiredAuthCookie(name, true), /; Secure$/u)
})

test('prune keeps the current authority cookie and expires the rest', () => {
  const current = authCookieName('127.0.0.1:65001')
  const request = fakeRequest({ cookie: current + '=2; dsh-auth-old=1' })
  assert.deepEqual(pruneCookieHeaders(request, false), [expiredAuthCookie('dsh-auth-old', false)])
})

test('the prune route sets only stale deletion cookies', async () => {
  const current = authCookieName('127.0.0.1:65001')
  const route = makeAuthCookieRoutes({ secure: () => false })[0]
  assert.ok(route)
  assert.equal(route.path, '/api/dsh-mcviseron/auth-cookies/prune')
  const response = fakeResponse()
  await route.handler(fakeRequest({ cookie: current + '=2; dsh-auth-old=1' }), response.res)
  assert.equal(response.status(), 200)
  assert.deepEqual(response.headers()['set-cookie'], [expiredAuthCookie('dsh-auth-old', false)])
  assert.equal((JSON.parse(response.body()) as { pruned: number }).pruned, 1)
})

test('the prune route rejects non-POST and non-loopback callers', async () => {
  const route = makeAuthCookieRoutes({ secure: () => false })[0]
  assert.ok(route)
  const get = fakeResponse()
  await route.handler(fakeRequest({ method: 'GET' }), get.res)
  assert.equal(get.status(), 405)

  const remote = fakeResponse()
  await route.handler(fakeRequest({ remote: '10.0.0.1' }), remote.res)
  assert.equal(remote.status(), 403)

  const crossSite = fakeResponse()
  await route.handler(fakeRequest({ secFetchSite: 'cross-site' }), crossSite.res)
  assert.equal(crossSite.status(), 403)
})

test('the prune route marks deletion cookies Secure under TLS', async () => {
  const secureCurrent = authCookieName('https://127.0.0.1:65001')
  const route = makeAuthCookieRoutes({ secure: () => true })[0]
  assert.ok(route)
  const response = fakeResponse()
  await route.handler(fakeRequest({ cookie: secureCurrent + '=2; dsh-auth-old=1' }), response.res)
  assert.deepEqual(response.headers()['set-cookie'], [expiredAuthCookie('dsh-auth-old', true)])
})

test('index injection calls the prune endpoint before application modules', () => {
  let inject: ((table: unknown) => void) | undefined
  let registered = 0
  const ctx = {
    root: {
      on(event: string, handler: (table: unknown) => void) {
        assert.equal(event, 'webserver/index-inject')
        inject = handler
        return () => {}
      },
    },
    webServer: {
      protocol: 'http:',
      register() {
        registered += 1
        return () => {}
      },
    },
    effect(fn: () => (() => void) | void) {
      return fn()
    },
  } as unknown as Parameters<typeof apply>[0]
  apply(ctx)
  assert.equal(registered, 1)
  assert.ok(inject)
  const table: Array<{ kind?: string; placement?: string; text?: string }> = []
  inject(table)
  assert.equal(table.length, 1)
  assert.equal(table[0]?.kind, 'script')
  assert.equal(table[0]?.placement, 'head')
  assert.match(table[0]?.text ?? '', /auth-cookies\/prune/u)
  assert.match(table[0]?.text ?? '', /method:"POST"/u)
  assert.match(pruneScript(), /credentials:"same-origin"/u)
})
