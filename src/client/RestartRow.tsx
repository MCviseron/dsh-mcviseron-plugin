import { useEffect, useState } from 'react'
import type { McviseronKey } from './locales.ts'
import { styles } from './styles.ts'

const STATUS = '/api/dsh-mcviseron/restart/status'
const EXECUTE = '/api/dsh-mcviseron/restart/execute'

type RowState = 'loading' | 'ready' | 'unavailable' | 'restarting' | 'failed'

async function post(path: string, body: unknown): Promise<any> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error('HTTP ' + response.status)
  return await response.json()
}

/** Props composed by the `settings.general.item` slot. */
export interface RestartRowProps {
  t: (key: McviseronKey) => string
}

/**
 * Restart row: hidden outside the desktop application, otherwise a confirmed
 * "restart" action that calls the Host restart route.
 * @param props - composed slot props.
 * @returns the row element tree, or null when restarting is unavailable.
 */
export function RestartRow({ t }: RestartRowProps) {
  const [state, setState] = useState<RowState>('loading')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const body = await post(STATUS, {})
        if (!cancelled) setState(body?.ok === true && body?.available === true ? 'ready' : 'unavailable')
      } catch {
        if (!cancelled) setState('unavailable')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (state === 'unavailable') return null

  const restart = async (): Promise<void> => {
    if (!window.confirm(t('restart.confirm'))) return
    setState('restarting')
    try {
      const body = await post(EXECUTE, { confirm: true })
      if (body?.ok !== true) throw new Error('rejected')
    } catch {
      setState('failed')
    }
  }

  const status = state === 'restarting'
    ? t('restart.restarting')
    : state === 'failed'
      ? t('restart.failed')
      : state === 'loading'
        ? t('restart.checking')
        : t('restart.ready')

  return (
    <div style={styles.row}>
      <div style={styles.text}>
        <div style={styles.title}>{t('restart.title')}</div>
        <div style={styles.description}>{t('restart.description')}</div>
        <div style={styles.status}>{status}</div>
      </div>
      <div style={styles.controls}>
        <button
          type="button"
          onClick={() => { void restart() }}
          disabled={state === 'restarting'}
          style={state === 'restarting' ? styles.buttonDisabled : styles.button}
        >
          {t('restart.button')}
        </button>
      </div>
    </div>
  )
}
