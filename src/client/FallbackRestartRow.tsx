import { useSyncExternalStore } from 'react'
import type { McviseronKey } from './locales.ts'
import { RestartCard } from './RestartCard.tsx'
import { sectionPresence } from './section-presence.ts'

/**
 * General-section restart row, rendered only while the MCviseron settings
 * section is absent (slot not declared or registration failed).
 */
export function FallbackRestartRow({ t }: { t: (key: McviseronKey) => string }) {
  const live = useSyncExternalStore(sectionPresence.subscribe, sectionPresence.isLive)
  if (live) return null
  const failure = sectionPresence.failure()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>
        {t('page.fallback.note')}
        {failure !== '' ? ' (' + failure + ')' : ''}
      </div>
      <RestartCard t={t} />
    </div>
  )
}
