import { useEffect, useState, type CSSProperties } from 'react'
import {
  IconChevronDownOutlineRegular,
  IconClockOutlineRegular,
  IconCloseCircleFillRegular,
  IconRefreshOutlineRegular,
  IconStopFillRegular,
  Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
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

const TRIGGER_CSS = [
  '.mcviseron-session-end-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
  '.mcviseron-session-end-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline:none}',
  '.mcviseron-session-end-trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
  '.mcviseron-session-end-trigger svg{width:14px;height:14px}',
  '.mcviseron-session-end-chevron{display:inline-flex;transition:transform .12s;color:var(--dsw-alias-label-caption)}',
  '.mcviseron-session-end-chevron.open{transform:rotate(180deg)}',
].join('\n')

export type SessionEndControlProps =
  PropsRuntime<'conversation.input.left'>
  & PropsLocale<'mcviseron'>

const labelStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '0 4px',
  height: 28,
  borderRadius: 'var(--dsw-radius-sm)',
  fontSize: 12,
  lineHeight: 1.3,
  color: 'var(--dsw-alias-label-secondary)',
  whiteSpace: 'nowrap',
}

const triggerStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 28,
  minWidth: 0,
  maxWidth: 220,
  padding: '0 4px 0 8px',
  border: 'none',
  borderRadius: 'var(--dsw-radius-sm)',
  background: 'transparent',
  color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
  outline: 'none',
  fontSize: 13,
  fontWeight: 500,
  lineHeight: '20px',
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

function triggerIcon(mode: Mode) {
  if (mode === 'restart') return <IconRefreshOutlineRegular />
  if (mode === 'close') return <IconCloseCircleFillRegular />
  if (mode === 'shutdown') return <IconStopFillRegular />
  return <IconClockOutlineRegular />
}

/**
 * Composer control for the one-shot session-end action.
 *
 * The trigger and menu are the official DSH primitives: the menu geometry,
 * icons, check marker, portal placement, and keyboard handling therefore match
 * the Auto-review permission selector. The dropdown is off by default; the
 * server state is polled because the agent can arm it through
 * set_session_end_action while a turn is running.
 */
export function SessionEndControl(props: SessionEndControlProps) {
  const { t } = props
  const sessionId = (props as { sessionId?: string }).sessionId
  const [state, setState] = useState<State>(INITIAL)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

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
        setState(prev => ({ ...prev, ...body, available: body.available ?? prev.available }))
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
          setState(prev => ({ ...prev, ...body, available: body.available ?? prev.available }))
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

  const items = [
    { id: 'off', label: t('sessionEnd.off'), icon: <IconClockOutlineRegular /> },
    {
      id: 'restart',
      label: t('sessionEnd.restart'),
      icon: <IconRefreshOutlineRegular />,
      disabled: !state.available.restart,
    },
    {
      id: 'close',
      label: t('sessionEnd.close'),
      icon: <IconCloseCircleFillRegular />,
      disabled: !state.available.close,
    },
    {
      id: 'shutdown',
      label: t('sessionEnd.shutdown'),
      icon: <IconStopFillRegular />,
      disabled: !state.available.shutdown,
      danger: true,
    },
  ]

  const anchor = (
    <button
      type="button"
      className="mcviseron-session-end-trigger"
      aria-label={t('sessionEnd.label')}
      aria-haspopup="menu"
      aria-expanded={open}
      title={t('sessionEnd.hint')}
      style={triggerStyle}
      disabled={busy}
      onClick={() => { setOpen(value => !value) }}
    >
      <span style={{ display: 'inline-flex', flex: 'none' }}>{triggerIcon(state.mode)}</span>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {t(
          state.mode === 'off'
            ? 'sessionEnd.off'
            : state.mode === 'restart'
              ? 'sessionEnd.restart'
              : state.mode === 'close'
                ? 'sessionEnd.close'
                : 'sessionEnd.shutdown',
        )}
      </span>
      <span
        className={open ? 'mcviseron-session-end-chevron open' : 'mcviseron-session-end-chevron'}
        aria-hidden
      >
        <IconChevronDownOutlineRegular />
      </span>
    </button>
  )

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <style>{TRIGGER_CSS}</style>
      {notice !== '' && (
        <span
          style={shutdown ? shutdownNoticeStyle : noticeStyle}
          title={state.waiting ? t('sessionEnd.aiWaiting') : notice}
        >
          {notice}
        </span>
      )}
      <span style={labelStyle} title={t('sessionEnd.hint')}>
        <span>{t('sessionEnd.label')}</span>
        <Menu
          open={open}
          anchor={anchor}
          items={items}
          selectedId={state.mode}
          onSelect={id => { change(id as Mode) }}
          onClose={() => { setOpen(false) }}
          align="end"
          side="top"
          portal
        />
      </span>
    </span>
  )
}
