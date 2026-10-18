import { useEffect, useState, useSyncExternalStore } from 'react'
import { formatTimeOfDay, nextTransition, parseTimeOfDay, periodAt } from '../schedule.ts'
import type { ScheduleDriver } from './driver.ts'
import type { McviseronKey } from './locales.ts'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { styles } from './styles.ts'

/** Props composed by the `settings.general.item` slot. */
export interface AppearanceScheduleRowProps {
  /** Locale-bound translator for this plugin's namespace. */
  t: (key: McviseronKey) => string
  /** Injected driver, owned by the plugin (never by the row). */
  driver: ScheduleDriver
}

/**
 * The Appearance option: one row with the toggle, the customizable light
 * window, and the live "current period / next switch" line. The row owns no
 * timer of its own besides the clock label; the driver keeps switching themes
 * after the settings page is closed.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function AppearanceScheduleRow({ t, driver }: AppearanceScheduleRowProps) {
  const state = useSyncExternalStore(driver.subscribe, driver.getState, driver.getState)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date())
    }, 15_000)
    return () => {
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (state.bridge === 'loading') void driver.refresh()
  }, [driver, state.bridge])

  const config = state.config
  const next = nextTransition(now, config)
  const period = periodAt(now, config)

  const status = ((): string => {
    if (state.bridge === 'unavailable') return t('status.unavailable')
    if (!config.enabled) return t('status.off')
    const periodText = t(period === 'light' ? 'status.light' : 'status.dark')
    if (next === undefined) return periodText
    return periodText + ' · ' + t('row.next') + ' ' + formatTimeOfDay(next.at.getHours() * 60 + next.at.getMinutes())
  })()

  const write = state.write === 'saving'
    ? t('status.saving')
    : state.write === 'failed'
      ? t('status.failed')
      : state.write === 'saved'
        ? t('status.saved')
        : ''

  const toggle = (enabled: boolean): void => {
    void driver.update({ enabled })
  }

  const changeTime = (field: 'lightStart' | 'lightEnd', value: string): void => {
    if (parseTimeOfDay(value) === undefined) return
    void driver.update(field === 'lightStart' ? { lightStart: value } : { lightEnd: value })
  }

  return (
    <div style={styles.row}>
      <div style={styles.text}>
        <div style={styles.title}>{t('row.title')}</div>
        <div style={styles.description}>{t('row.description')}</div>
        <div style={styles.status}>{write === '' ? status : status + ' · ' + write}</div>
      </div>
      <div style={styles.controls}>
        <div style={styles.times} title={t('row.timeHint')}>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>{t('row.lightStart')}</span>
            <input
              type="time"
              step={60}
              value={config.lightStart}
              aria-label={t('row.lightStart')}
              onChange={event => changeTime('lightStart', event.currentTarget.value)}
              style={styles.input}
            />
          </label>
          <span style={styles.dash}>{t('row.dash')}</span>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>{t('row.lightEnd')}</span>
            <input
              type="time"
              step={60}
              value={config.lightEnd}
              aria-label={t('row.lightEnd')}
              onChange={event => changeTime('lightEnd', event.currentTarget.value)}
              style={styles.input}
            />
          </label>
        </div>
        <Switch
          checked={config.enabled}
          label={config.enabled ? t('row.disable') : t('row.enable')}
          title={config.enabled ? t('row.disable') : t('row.enable')}
          onChange={(next) => { toggle(next) }}
        />
      </div>
    </div>
  )
}
