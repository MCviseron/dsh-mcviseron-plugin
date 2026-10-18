import { useEffect, useState } from 'react'
import type { McviseronKey } from './locales.ts'
import { pageStyles, styles } from './styles.ts'

const STATUS = '/api/dsh-mcviseron/restart/status'
const EXECUTE = '/api/dsh-mcviseron/restart/execute'

type RestartState =
  | { kind: 'loading' }
  | { kind: 'ready'; appPath: string }
  | { kind: 'unavailable' }
  | { kind: 'route-missing' }
  | { kind: 'restarting' }
  | { kind: 'failed'; message: string }

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown }
    if (typeof body.error === 'string') return body.error
  } catch {
    // not JSON
  }
  return 'HTTP ' + String(response.status)
}

/** Restart card shared by the settings section and the General fallback row. */
export function RestartCard({ t }: { t: (key: McviseronKey) => string }) {
  const [state, setState] = useState<RestartState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(STATUS, { method: 'GET' })
        if (cancelled) return
        if (response.status === 404 || response.status === 405) {
          setState({ kind: 'route-missing' })
          return
        }
        if (!response.ok) throw new Error(await readError(response))
        const body = await response.json() as { ok?: unknown; available?: unknown; appPath?: unknown }
        if (body.ok !== true) throw new Error('restart-status-rejected')
        if (body.available === true) {
          setState({ kind: 'ready', appPath: typeof body.appPath === 'string' ? body.appPath : '' })
        } else {
          setState({ kind: 'unavailable' })
        }
      } catch (error) {
        if (!cancelled) setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const startRestart = async (): Promise<void> => {
    if (!window.confirm(t('page.restart.confirm'))) return
    setState({ kind: 'restarting' })
    try {
      const response = await fetch(EXECUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      })
      if (!response.ok) throw new Error(await readError(response))
      const body = await response.json() as { ok?: unknown }
      if (body.ok !== true) throw new Error('restart-rejected')
    } catch (error) {
      setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const status = state.kind === 'ready'
    ? t('page.restart.ready')
    : state.kind === 'route-missing'
      ? t('page.restart.routeMissing')
      : state.kind === 'restarting'
        ? t('page.restart.restarting')
        : state.kind === 'failed'
          ? t('page.restart.failed') + (state.message !== '' ? ' (' + state.message + ')' : '')
          : state.kind === 'loading'
            ? t('restart.checking')
            : t('page.restart.unavailable')

  const canRestart = state.kind === 'ready' || state.kind === 'failed'

  return (
    <div style={pageStyles.card}>
      <div style={pageStyles.cardTitle}>{t('page.restart.title')}</div>
      <div style={pageStyles.cardBody}>{t('page.restart.description')}</div>
      <div style={pageStyles.cardStatus}>{status}</div>
      {state.kind === 'ready' && state.appPath !== ''
        ? <div style={pageStyles.cardStatus}>{t('page.restart.appPath')}: {state.appPath}</div>
        : null}
      <div style={pageStyles.cardActions}>
        <button
          type="button"
          disabled={!canRestart}
          onClick={() => { void startRestart() }}
          style={canRestart ? styles.button : styles.buttonDisabled}
        >
          {state.kind === 'restarting' ? t('page.restart.restarting') : t('page.restart.button')}
        </button>
      </div>
    </div>
  )
}
