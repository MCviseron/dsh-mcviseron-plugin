import { SESSION_END_API } from '../api.ts'

export interface GlobalSessionEndAction {
  sessionId: string
  label: string
  mode: 'restart' | 'close' | 'shutdown'
  requestedBy: 'ai'
  waiting: boolean
  runningAgents: number
  runningJobs: number
}

const HOST_ID = 'mcviseron-session-end-global'

/** Human label for one AI-armed process action. */
export function globalNoticeText(action: GlobalSessionEndAction): string {
  const name = action.label.trim() !== '' ? action.label : '会话 …' + action.sessionId.slice(-6)
  const mode = action.mode === 'restart' ? '自动重启' : action.mode === 'close' ? '自动关闭 DSH' : '关闭电脑'
  return '「' + name + '」已启用 AI 会话' + mode
}

export function globalNoticeKey(action: GlobalSessionEndAction): string {
  return action.sessionId + ':' + action.mode
}

function ensureHost(): HTMLDivElement | undefined {
  if (typeof document === 'undefined') return undefined
  const existing = document.getElementById(HOST_ID)
  if (existing !== null) return existing as HTMLDivElement
  const host = document.createElement('div')
  host.id = HOST_ID
  host.setAttribute('role', 'status')
  host.setAttribute('aria-live', 'polite')
  host.style.cssText = [
    'position:fixed',
    'top:12px',
    'right:12px',
    'z-index:10000',
    'display:flex',
    'flex-direction:column',
    'gap:8px',
    'max-width:min(380px,calc(100vw - 24px))',
    'pointer-events:none',
  ].join(';')
  document.body.appendChild(host)
  return host
}

function card(action: GlobalSessionEndAction, dismiss: () => void): HTMLDivElement {
  const element = document.createElement('div')
  element.style.cssText = [
    'pointer-events:auto',
    'display:flex',
    'align-items:flex-start',
    'gap:9px',
    'padding:10px 11px',
    'border-radius:12px',
    'border:1px solid var(--dsw-alias-state-warn-primary, rgba(227,179,65,.65))',
    'background:var(--dsw-alias-bg-layer-2, #1f2023)',
    'color:var(--dsw-alias-label-primary, #f2f3f5)',
    'box-shadow:var(--dsw-elevation-prominent, 0 8px 28px rgba(0,0,0,.35))',
    'font-size:12px',
    'line-height:1.45',
  ].join(';')

  const dot = document.createElement('span')
  dot.setAttribute('aria-hidden', 'true')
  dot.style.cssText = 'flex:none;width:8px;height:8px;margin-top:4px;border-radius:50%;background:var(--dsw-alias-state-warn-primary,#e3b341)'

  const body = document.createElement('div')
  body.style.cssText = 'flex:1;min-width:0'
  const title = document.createElement('div')
  title.textContent = globalNoticeText(action)
  title.style.cssText = 'font-weight:600'
  const hint = document.createElement('div')
  hint.textContent = action.waiting
    ? '正在等待任务结束' + (action.runningAgents + action.runningJobs > 0
      ? ' · ' + String(action.runningAgents) + ' 个会话 / ' + String(action.runningJobs) + ' 个任务'
      : '')
    : '本轮最终回复后执行'
  hint.style.cssText = 'margin-top:2px;color:var(--dsw-alias-label-secondary,#a8adb7);font-size:11px'
  body.append(title, hint)

  const close = document.createElement('button')
  close.type = 'button'
  close.setAttribute('aria-label', '关闭提示')
  close.textContent = '×'
  close.style.cssText = [
    'flex:none',
    'border:0',
    'background:transparent',
    'color:var(--dsw-alias-label-tertiary,#8b919c)',
    'cursor:pointer',
    'font-size:16px',
    'line-height:1',
    'padding:0 2px',
  ].join(';')
  close.addEventListener('click', dismiss)

  element.append(dot, body, close)
  return element
}

export function startSessionEndGlobalNotice(): () => void {
  if (typeof document === 'undefined' || typeof fetch !== 'function') return () => {}
  let stopped = false
  let timer: ReturnType<typeof setInterval> | undefined
  const dismissed = new Set<string>()

  const clear = (): void => {
    document.getElementById(HOST_ID)?.remove()
  }

  const render = (actions: GlobalSessionEndAction[]): void => {
    const active = new Set(actions.map(globalNoticeKey))
    for (const key of dismissed) if (!active.has(key)) dismissed.delete(key)
    const visible = actions.filter(action => !dismissed.has(globalNoticeKey(action)))
    if (visible.length === 0) {
      clear()
      return
    }
    const host = ensureHost()
    if (host === undefined) return
    host.replaceChildren(...visible.map(action => card(action, () => {
      dismissed.add(globalNoticeKey(action))
      render(actions)
    })))
  }

  const poll = async (): Promise<void> => {
    try {
      const response = await fetch(SESSION_END_API.global, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
      })
      if (stopped) return
      const body = await response.json() as { ok?: boolean; actions?: GlobalSessionEndAction[] }
      if (stopped || body.ok !== true || !Array.isArray(body.actions)) return
      render(body.actions.filter(action => action.requestedBy === 'ai'))
    } catch {
      /* a transient poll failure leaves the last notice in place */
    }
  }

  void poll()
  timer = setInterval(() => { void poll() }, 2000)
  return () => {
    stopped = true
    if (timer !== undefined) clearInterval(timer)
    clear()
  }
}
