import { useEffect, useState } from 'react'
import type { McviseronKey } from './locales.ts'
import { ARCHIVE_API } from '../api.ts'
import { AUTO_REVIEW_FIELDS, ConfigForm, SESSION_END_FIELDS, TASK_GUARD_FIELDS } from './ConfigForm.tsx'
import { RestartCard } from './RestartCard.tsx'
import { pageStyles } from './styles.ts'

type Tab = 'restart' | 'autoReview' | 'taskGuard' | 'sessionEnd' | 'archive' | 'components'

interface ArchiveStatus {
  available: boolean
  ledgerPath: string
  ledgerExists: boolean
  entries: number
  observed: number
  manual: number
  archivedCount: number
  unknownCount: number
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
  const [archive, setArchive] = useState<ArchiveStatus | null>(null)

  const loadArchive = async (): Promise<void> => {
    try {
      const response = await fetch(ARCHIVE_API.status, { credentials: 'same-origin', cache: 'no-store' })
      if (!response.ok) { setArchive(null); return }
      const value = await response.json() as ArchiveStatus
      setArchive(value.available ? value : null)
    } catch {
      setArchive(null)
    }
  }

  useEffect(() => { void loadArchive() }, [])

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
          aria-selected={tab === 'autoReview'}
          onClick={() => { setTab('autoReview') }}
          style={tab === 'autoReview' ? { ...pageStyles.tab, ...pageStyles.tabActive } : pageStyles.tab}
        >
          {t('page.tab.autoReview')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'taskGuard'}
          onClick={() => { setTab('taskGuard') }}
          style={tab === 'taskGuard' ? { ...pageStyles.tab, ...pageStyles.tabActive } : pageStyles.tab}
        >
          {t('page.tab.taskGuard')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'sessionEnd'}
          onClick={() => { setTab('sessionEnd') }}
          style={tab === 'sessionEnd' ? { ...pageStyles.tab, ...pageStyles.tabActive } : pageStyles.tab}
        >
          {t('page.tab.sessionEnd')}
        </button>
        {archive?.available
          ? (
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'archive'}
              onClick={() => { setTab('archive') }}
              style={tab === 'archive' ? { ...pageStyles.tab, ...pageStyles.tabActive } : pageStyles.tab}
            >
              {t('page.tab.archive')}
            </button>
          )
          : null}
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
        ? <RestartCard t={t} />
        : tab === 'autoReview'
          ? (
            <ConfigForm
              t={t}
              title="page.autoReview.title"
              description="page.autoReview.description"
              fields={AUTO_REVIEW_FIELDS}
            />
          )
          : tab === 'taskGuard'
            ? (
              <ConfigForm
                t={t}
                title="page.taskGuard.title"
                description="page.taskGuard.description"
                fields={TASK_GUARD_FIELDS}
              />
            )
            : tab === 'sessionEnd'
              ? (
                <ConfigForm
                  t={t}
                  title="page.sessionEnd.title"
                  description="page.sessionEnd.description"
                  fields={SESSION_END_FIELDS}
                />
              )
              : tab === 'archive' && archive?.available
                ? (
                  <div style={pageStyles.card}>
                    <div style={pageStyles.cardTitle}>{t('page.archive.title')}</div>
                    <p style={pageStyles.lede}>{t('page.archive.description')}</p>
                    <div style={pageStyles.componentRow}>
                      <span style={pageStyles.componentName}>{t('page.archive.available')}</span>
                      <span style={pageStyles.componentHint}>{archive.ledgerExists ? t('page.archive.ledger') : archive.ledgerPath}</span>
                    </div>
                    <div style={pageStyles.componentRow}>
                      <span style={pageStyles.componentName}>{t('page.archive.archived')}</span>
                      <span style={pageStyles.componentHint}>{archive.archivedCount}</span>
                    </div>
                    <div style={pageStyles.componentRow}>
                      <span style={pageStyles.componentName}>{t('page.archive.observed')}</span>
                      <span style={pageStyles.componentHint}>{archive.observed}</span>
                    </div>
                    <div style={pageStyles.componentRow}>
                      <span style={pageStyles.componentName}>{t('page.archive.manual')}</span>
                      <span style={pageStyles.componentHint}>{archive.manual}</span>
                    </div>
                    <div style={pageStyles.componentRow}>
                      <span style={pageStyles.componentName}>{t('page.archive.unknown')}</span>
                      <span style={pageStyles.componentHint}>{archive.unknownCount}</span>
                    </div>
                    <div style={pageStyles.componentRow}>
                      <span style={pageStyles.componentName}>{t('page.archive.ledger')}</span>
                      <span style={pageStyles.componentHint}>{archive.ledgerPath}</span>
                    </div>
                    <button type="button" onClick={() => { void loadArchive() }} style={pageStyles.tab}>{t('page.archive.refresh')}</button>
                    <div style={pageStyles.cardStatus}>{t('page.archive.note')}</div>
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
            <div style={pageStyles.componentRow}>
              <span style={pageStyles.componentName}>{t('page.components.authCookie')}</span>
              <span style={pageStyles.componentHint}>{t('page.components.authCookieHint')}</span>
            </div>
            <div style={pageStyles.componentRow}>
              <span style={pageStyles.componentName}>{t('page.components.sessionEnd')}</span>
              <span style={pageStyles.componentHint}>{t('page.components.sessionEndHint')}</span>
            </div>
            {archive?.available
              ? (
                <div style={pageStyles.componentRow}>
                  <span style={pageStyles.componentName}>{t('page.components.archive')}</span>
                  <span style={pageStyles.componentHint}>{t('page.components.archiveHint')}</span>
                </div>
              )
              : null}
            <div style={pageStyles.cardStatus}>{t('page.components.note')}</div>
          </div>
        )}
    </div>
  )
}
