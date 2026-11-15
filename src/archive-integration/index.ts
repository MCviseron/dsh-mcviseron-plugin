import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { ARCHIVE_API } from '../api.ts'
import { isLoopbackRequest } from '../loopback.ts'

interface Ledger { version?: unknown; entries?: Record<string, { archivedAt?: unknown; source?: unknown }> }
interface ArchiveEntry { options?: { name?: unknown }; disabled?: boolean; fiber?: unknown }

function dshHome(): string {
  const raw = process.env.DSH_HOME
  if (raw !== undefined && raw.trim() !== '') return raw.trim().startsWith('~') ? join(homedir(), raw.trim().slice(1).replace(/^[\\/]/, '')) : raw.trim()
  return join(homedir(), '.dsh')
}

function archiveAvailable(ctx: Context): boolean {
  try {
    const loader = (ctx as unknown as { loader?: { entries?: () => Iterable<ArchiveEntry> } }).loader
    for (const entry of loader?.entries?.() ?? []) {
      const name = String(entry.options?.name ?? '')
      if (name.includes('session-archive') && entry.disabled !== true && entry.fiber !== undefined && entry.fiber !== null) return true
    }
  } catch { /* no loader */ }
  return false
}

function archivedIds(ctx: Context): string[] {
  try {
    const registry = (ctx as unknown as { get?: (name: string) => unknown }).get?.('workspaceRegistry') as { archivedSessionIds?: unknown } | undefined
    const value = registry?.archivedSessionIds
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && id.length > 0) : []
  } catch {
    return []
  }
}

export function makeArchiveStatus(ctx: Context): Record<string, unknown> {
  const available = archiveAvailable(ctx)
  const ledgerPath = join(dshHome(), 'dsh-session-archive', 'archive-ledger.json')
  let ledger: Ledger | undefined
  try { ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) as Ledger } catch { ledger = undefined }
  const entries = ledger?.entries !== null && typeof ledger?.entries === 'object' ? ledger.entries : {}
  const ids = archivedIds(ctx)
  let observed = 0
  let manual = 0
  for (const entry of Object.values(entries)) {
    if (entry.source === 'observed') observed++
    else if (entry.source === 'manual') manual++
  }
  let unknown = 0
  for (const id of ids) if (entries[id] === undefined) unknown++
  return {
    ok: true,
    available,
    ledgerPath,
    ledgerExists: existsSync(ledgerPath),
    entries: Object.keys(entries).length,
    observed,
    manual,
    archivedCount: ids.length,
    unknownCount: unknown,
  }
}

export const inject = ['webServer']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ARCHIVE_API.status,
    handler: async (req, res): Promise<void> => {
      const send = (status: number, value: unknown): void => {
        res.statusCode = status
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify(value))
      }
      if (req.method !== 'GET' && req.method !== 'POST') return send(405, { ok: false, error: 'method-not-allowed' })
      if (!isLoopbackRequest(req)) return send(403, { ok: false, error: 'forbidden' })
      try { send(200, makeArchiveStatus(ctx)) } catch (error) { send(500, { ok: false, error: error instanceof Error ? error.message : String(error) }) }
    },
  }), 'mcviseron: archive integration status')
}
