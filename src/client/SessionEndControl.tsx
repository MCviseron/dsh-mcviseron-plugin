import { useEffect, useState, type CSSProperties } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SESSION_END_API } from '../api.ts'
import type { McviseronKey } from './locales.ts'

type Mode = 'off' | 'restart' | 'close' | 'shutdown'
type RequestedBy = 'none' | 'user' | 'ai'

interface State {
  enabled: boolean
  mode: Mode
  requestedBy: RequestedBy
  waiting: boolean
  runningAgents: number
  runningJobs: number
  available: { restart: boolean; close: boolean; shutdown: boolean }
}

const INITIAL: State = {
  enabled: true,
  mode: 'off',
  requestedBy: 'none',
  waiting: false,
  runningAgents: 0,
  runningJobs: 0,
  available: { restart: true, close: true, shutdown: true },
}

export type SessionEndControlProps =
  PropsRuntime<'conversation.input.left'>
  & PropsLocale<'mcviseron'>

const labelStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '0 6px',
  height: 28,
  borderRadius: 8,
  fontSize: 12,
  lineHeight: 1.3,
  color: 'var(--dsw-alias-label-secondary)',
  whiteSpace: 'nowrap',
}

const selectStyle: CSSProperties = {
  height: 28,
  maxWidth: 132,
  borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-l3)',
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 12,
  lineHeight: 1.3,
  padding: '0 4px',
  cursor: 'pointer',
}

const noticeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 8px',
  borderRadius: 999,
  border: '1px solid var(--dsw-alias-state-warn-primary)',
  background: 'var(--dsw-alias-state-warn-tertiary)',
  color: 'var(--dsw-alias-state-warn-primary)',
  fontSize: 12,
  fontWeight: 700,
  lineHeight: '18px',
  whiteSpace: 'nowrap',
}

const shutdownNoticeStyle: CSSProperties = {
  ...noticeStyle,
  borderColor: 'var(--dsw-alias-state-error-primary)',
  background: 'var(--dsw-alias-state-error-tertiary)',
  color: 'var(--dsw-alias-state-error-primary)',
}

/**
 * Composer control for the one-shot session-end action.
 *
 * The dropdown is off by default. The server state is polled because the agent
 * can arm the action through its set_session_end_action tool while a turn is
 * running; the AI-requested state gets a colored, non-modal reminder.
 */
export function SessionEndControl(props: SessionEndControlProps) {
  const { t } = props
  const sessionId = (props as { sessionId?: string }).sessionId
  const [state, setState] = useState<State>(INITIAL)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (sessionId === undefined || sessionId === '') {
      setState(INITIAL)
      return
    }
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(SESSION_END_API.state, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        })
        const body = await response.json() as Partial<State> & { ok?: boolean }
        if (cancelled || body.ok !== true) return
        setState(prev => ({
          ...prev,
          ...body,
          available: body.available ?? prev.available,
        }))
      } catch {
        /* a transient poll failure leaves the last known state in place */
      }
    }
    void load()
    const timer = setInterval(() => { void load() }, 1500)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [sessionId])

  if (sessionId === undefined || sessionId === '') return null

  const change = (value: string): void => {
    const mode = value as Mode
    if (mode === 'shutdown' && typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (!window.confirm(t('sessionEnd.shutdownConfirm'))) return
    }
    setBusy(true)
    setState(prev => ({
      ...prev,
      mode,
      requestedBy: mode === 'off' ? 'none' : 'user',
      waiting: false,
    }))
    void fetch(SESSION_END_API.set, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, mode }),
    })
      .then(async response => await response.json() as Partial<State> & { ok?: boolean })
      .then(body => {
        if (body.ok === true) {
          setState(prev => ({
            ...prev,
            ...body,
            available: body.available ?? prev.available,
          }))
        }
      })
      .catch(() => { /* the next poll reconciles */ })
      .finally(() => { setBusy(false) })
  }

  if (state.enabled === false) return null

  const aiRequested = state.mode !== 'off' && state.requestedBy === 'ai'
  const shutdown = state.mode === 'shutdown'
  const notice = shutdown
    ? t('sessionEnd.userShutdown')
    : aiRequested
      ? state.mode === 'close'
        ? t('sessionEnd.aiClose')
        : state.waiting ? t('sessionEnd.aiWaiting') : t('sessionEnd.aiRestart')
      : ''

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {notice !== '' && (
        <span
          style={shutdown ? shutdownNoticeStyle : noticeStyle}
          title={state.waiting ? t('sessionEnd.aiWaiting') : notice}
        >
          {notice}
        </span>
      )}
      <label style={labelStyle} title={t('sessionEnd.hint')}>
        <span>{t('sessionEnd.label')}</span>
        <select
          aria-label={t('sessionEnd.label')}
          title={t('sessionEnd.hint')}
          style={{
            ...selectStyle,
            borderColor: aiRequested ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-border-l3)',
          }}
          value={state.mode}
          disabled={busy}
          onChange={event => { change(event.target.value) }}
        >
          <option value="off">{t('sessionEnd.off')}</option>
          <option value="restart" disabled={!state.available.restart}>{t('sessionEnd.restart')}</option>
          <option value="close" disabled={!state.available.close}>{t('sessionEnd.close')}</option>
          <option value="shutdown" disabled={!state.available.shutdown}>{t('sessionEnd.shutdown')}</option>
        </select>
      </label>
    </span>
  )
}
