import { useEffect, useRef, useState, type CSSProperties } from 'react'
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

const triggerStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 6,
  height: 28,
  minWidth: 92,
  maxWidth: 150,
  borderRadius: 10,
  border: '1px solid var(--dsw-alias-border-l3)',
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 12,
  lineHeight: 1.3,
  padding: '0 8px',
  cursor: 'pointer',
}

const menuStyle: CSSProperties = {
  position: 'fixed',
  zIndex: 10000,
  padding: 6,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  borderRadius: 14,
  border: '1px solid var(--dsw-alias-border-l3)',
  background: 'var(--dsw-alias-bg-layer-2)',
  boxShadow: '0 18px 44px rgba(0, 0, 0, 0.32)',
}

const menuOptionStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  width: '100%',
  border: 0,
  borderRadius: 10,
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 13,
  lineHeight: '20px',
  padding: '7px 10px',
  textAlign: 'left',
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
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState({ left: 0, bottom: 0, minWidth: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    if (!open) return
    const close = (): void => { setOpen(false) }
    const onPointer = (event: MouseEvent): void => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])

  if (sessionId === undefined || sessionId === '') return null


  const toggleMenu = (): void => {
    if (open) {
      setOpen(false)
      return
    }
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    const minWidth = Math.max(rect.width, 176)
    const left = Math.min(
      Math.max(8, rect.left),
      Math.max(8, window.innerWidth - minWidth - 8),
    )
    setMenu({ left, bottom: window.innerHeight - rect.top + 6, minWidth })
    setOpen(true)
  }

  const change = (mode: Mode): void => {
    setOpen(false)
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
      <style>{`
        .mcviseron-session-end-trigger { transition: background 120ms ease, border-color 120ms ease; }
        .mcviseron-session-end-trigger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-3)); }
        .mcviseron-session-end-option { transition: background 120ms ease; }
        .mcviseron-session-end-option:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-3)); }
      `}</style>
      <span style={labelStyle} title={t('sessionEnd.hint')}>
        <span>{t('sessionEnd.label')}</span>
        <button
          ref={triggerRef}
          type="button"
          className="mcviseron-session-end-trigger"
          aria-label={t('sessionEnd.label')}
          aria-haspopup="listbox"
          aria-expanded={open}
          title={t('sessionEnd.hint')}
          style={{
            ...triggerStyle,
            borderColor: aiRequested ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-border-l3)',
          }}
          disabled={busy}
          onClick={toggleMenu}
        >
          <span>{t(
            state.mode === 'off'
              ? 'sessionEnd.off'
              : state.mode === 'restart'
                ? 'sessionEnd.restart'
                : state.mode === 'close'
                  ? 'sessionEnd.close'
                  : 'sessionEnd.shutdown',
          )}</span>
          <span aria-hidden style={{ fontSize: 10, opacity: 0.75 }}>{open ? '▴' : '▾'}</span>
        </button>
        {open && (
          <div
            ref={menuRef}
            role="listbox"
            aria-label={t('sessionEnd.label')}
            style={{ ...menuStyle, left: menu.left, bottom: menu.bottom, minWidth: menu.minWidth }}
          >
            {([
              ['off', 'sessionEnd.off', false],
              ['restart', 'sessionEnd.restart', !state.available.restart],
              ['close', 'sessionEnd.close', !state.available.close],
              ['shutdown', 'sessionEnd.shutdown', !state.available.shutdown],
            ] as const).map(([value, label, disabled]) => (
              <button
                key={value}
                type="button"
                role="option"
                aria-selected={state.mode === value}
                disabled={disabled}
                className="mcviseron-session-end-option"
                style={{
                  ...menuOptionStyle,
                  color: state.mode === value ? 'var(--dsw-alias-brand-primary)' : menuOptionStyle.color,
                  fontWeight: state.mode === value ? 600 : 400,
                  opacity: disabled ? 0.45 : 1,
                  cursor: disabled ? 'default' : 'pointer',
                }}
                onClick={() => { if (!disabled) change(value) }}
              >
                <span>{t(label)}</span>
                {state.mode === value ? <span aria-hidden>✓</span> : null}
              </button>
            ))}
          </div>
        )}
      </span>
    </span>
  )
}
