import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { makeArchiveStatus } from '../src/archive-integration/index.ts'

function fixture(withPlugin: boolean) {
  const home = mkdtempSync(join(process.env.TEMP || 'C:/Users/25639/AppData/Local/Temp', 'mcviseron-archive-'))
  const dir = join(home, 'dsh-session-archive')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'archive-ledger.json'), JSON.stringify({ version: 1, entries: { 'session-a': { archivedAt: 1, source: 'observed' } } }))
  process.env.DSH_HOME = home
  const ctx = {
    loader: { entries: () => withPlugin ? [{ options: { name: '@linxin666/dsh-session-archive' }, disabled: false, fiber: {} }] : [] },
    get: (name: string) => name === 'workspaceRegistry' ? { archivedSessionIds: ['session-a', 'session-b'] } : undefined,
  } as any
  return { home, ctx }
}

test('archive status is unavailable when the third-party plugin is absent', () => {
  const f = fixture(false)
  try {
    const status = makeArchiveStatus(f.ctx)
    assert.equal(status.available, false)
    assert.equal(status.archivedCount, 2)
    assert.equal(status.unknownCount, 1)
  } finally { rmSync(f.home, { recursive: true, force: true }) }
})

test('archive status reports observed, manual and unknown counts when detected', () => {
  const f = fixture(true)
  try {
    const status = makeArchiveStatus(f.ctx)
    assert.equal(status.available, true)
    assert.equal(status.observed, 1)
    assert.equal(status.manual, 0)
    assert.equal(status.entries, 1)
    assert.equal(status.archivedCount, 2)
    assert.equal(status.unknownCount, 1)
  } finally { rmSync(f.home, { recursive: true, force: true }) }
})
