import { useEffect, useState } from 'react'
import type { McviseronKey } from './locales.ts'
import { pageStyles, styles } from './styles.ts'

const STATUS = '/api/dsh-mcviseron/restart/status'
const EXECUTE = '/api/dsh-mcviseron/restart/execute'

type Tab = 'restart' | 'components'

type RestartState =
  | { kind: 'loading' }
  | { kind: 'ready'; appPath: string }
  | { kind: 'unavailable' }
  | { kind: 'route-missing' }
  | { kind: 'restarting' }
  | { kind: 'failed' }

async function post(path: string, body: unknown): Promise<any> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (response.status === 404) throw new Error('route-missing')
  if (!response.ok) throw new Error('HTTP ' + response.status)
  return await response.json()
}

/** Props composed by the `settings.section` slot. */
export interface SettingsSectionProps {
  t: (key: McviseronKey) => string
}

/**
 * First-level MCviseron settings section. Components with a settings surface
 * get a tab here; the Appearance component intentionally stays in General.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function SettingsSection({ t }: SettingsSectionProps) {
  const [tab, setTab] = useState<Tab>('restart')
  const [restart, setRestart] = useState<RestartState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const body = await post(STATUS, {})
        if (cancelled) return
        if (body?.ok === true && body?.available === true) {
          setRestart({ kind: 'ready', appPath: typeof body.appPath === 'string' ? body.appPath : '' })
        } else {
          setRestart({ kind: 'unavailable' })
        }
      } catch (error) {
        if (cancelled) return
        setRestart({ kind: error instanceof Error && error.message === 'route-missing' ? 'route-missing' : 'unavailable' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const startRestart = async (): Promise<void> => {
    if (!window.confirm(t('page.restart.confirm'))) return
    setRestart({ kind: 'restarting' })
    try {
      const body = await post(EXECUTE, { confirm: true })
      if (body?.ok !== true) throw new Error('rejected')
    } catch {
      setRestart({ kind: 'failed' })
    }
  }

  const status = restart.kind === 'ready'
    ? t('page.restart.ready')
    : restart.kind === 'route-missing'
      ? t('page.restart.routeMissing')
      : restart.kind === 'restarting'
        ? t('page.restart.restarting')
        : restart.kind === 'failed'
          ? t('page.restart.failed')
          : restart.kind === 'loading'
            ? t('restart.checking')
            : t('page.restart.unavailable')

  const canRestart = restart.kind === 'ready' || restart.kind === 'failed'

  return (
    <div style={pageStyles.page}>
      <h2 style={pageStyles.heading}>{t('page.title')}</h2>
      <p style={pageStyles.lede}>{t('page.description')}</p>
      <div style={pageStyles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'restart'}
          onClick={() => { setTab('restart') }}
          style={tab === 'restart' ? { ...pageStyles.tab, ...pageStyles.tabActive } : pageStyles.tab}
        >
          {t('page.tab.restart')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'components'}
          onClick={() => { setTab('components') }}
          style={tab === 'components' ? { ...pageStyles.tab, ...pageStyles.tabActive } : pageStyles.tab}
        >
          {t('page.tab.components')}
        </button>
      </div>

      {tab === 'restart'
        ? (
          <div style={pageStyles.card}>
            <div style={pageStyles.cardTitle}>{t('page.restart.title')}</div>
            <div style={pageStyles.cardBody}>{t('page.restart.description')}</div>
            <div style={pageStyles.cardStatus}>{status}</div>
            {restart.kind === 'ready' && restart.appPath !== ''
              ? <div style={pageStyles.cardStatus}>{t('page.restart.appPath')}: {restart.appPath}</div>
              : null}
            <div style={pageStyles.cardActions}>
              <button
                type="button"
                disabled={!canRestart}
                onClick={() => { void startRestart() }}
                style={canRestart ? styles.button : styles.buttonDisabled}
              >
                {restart.kind === 'restarting' ? t('page.restart.restarting') : t('page.restart.button')}
              </button>
            </div>
          </div>
        )
        : (
          <div style={pageStyles.card}>
            <div style={pageStyles.cardTitle}>{t('page.components.title')}</div>
            <div style={pageStyles.componentRow}>
              <span style={pageStyles.componentName}>{t('page.components.appearance')}</span>
              <span style={pageStyles.componentHint}>{t('page.components.appearanceHint')}</span>
            </div>
            <div style={pageStyles.componentRow}>
              <span style={pageStyles.componentName}>{t('page.components.autoReviewFix')}</span>
              <span style={pageStyles.componentHint}>{t('page.components.autoReviewFixHint')}</span>
            </div>
            <div style={pageStyles.componentRow}>
              <span style={pageStyles.componentName}>{t('page.components.taskGuard')}</span>
              <span style={pageStyles.componentHint}>{t('page.components.taskGuardHint')}</span>
            </div>
            <div style={pageStyles.componentRow}>
              <span style={pageStyles.componentName}>{t('page.components.restart')}</span>
              <span style={pageStyles.componentHint}>{t('page.components.restartHint')}</span>
            </div>
            <div style={pageStyles.cardStatus}>{t('page.components.note')}</div>
          </div>
        )}
    </div>
  )
}
