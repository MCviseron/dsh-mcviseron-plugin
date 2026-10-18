/**
 * Pure wall-clock logic for the appearance schedule.
 *
 * Shared by the Host half (defaults and validation reference) and the browser
 * half (theme driver and settings row), so both sides decide "which period is
 * it" with the same rules. Nothing here touches the DOM, the theme service, or
 * the settings store, which keeps the whole rule set unit-testable.
 */

/** Palette the schedule asks for. */
export type Period = 'light' | 'dark'

/** Durable schedule settings, one field per DSH settings-form field. */
export interface ScheduleConfig {
  /** Whether the schedule drives the theme at all. */
  enabled: boolean
  /** Local wall-clock start of the light period, inclusive, `HH:MM`. */
  lightStart: string
  /** Local wall-clock end of the light period, exclusive, `HH:MM`. */
  lightEnd: string
}

/** Default window: light 08:00 (inclusive) – 23:00 (exclusive), dark otherwise. */
export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = {
  enabled: false,
  lightStart: '08:00',
  lightEnd: '23:00',
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * Parse a validated `HH:MM` wall-clock value.
 * @param value - candidate text.
 * @returns minutes since local midnight, or undefined when malformed.
 */
export function parseTimeOfDay(value: string): number | undefined {
  const match = TIME_OF_DAY.exec(value)
  if (match === null) return undefined
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * Render minutes since local midnight as `HH:MM`.
 * @param minutes - 0..1439.
 * @returns zero-padded wall-clock text.
 */
export function formatTimeOfDay(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return String(hours).padStart(2, '0') + ':' + String(rest).padStart(2, '0')
}

/**
 * Coerce arbitrary stored values into a usable schedule. Unknown fields and
 * malformed times fall back to the defaults field by field, so a half-written
 * settings document can never disable the appearance row.
 * @param input - stored config or anything else.
 * @returns a fully populated config.
 */
export function normalizeScheduleConfig(input: unknown): ScheduleConfig {
  const record = input !== null && typeof input === 'object' ? input as Record<string, unknown> : {}
  const lightStart = typeof record.lightStart === 'string' && parseTimeOfDay(record.lightStart) !== undefined
    ? record.lightStart
    : DEFAULT_SCHEDULE_CONFIG.lightStart
  const lightEnd = typeof record.lightEnd === 'string' && parseTimeOfDay(record.lightEnd) !== undefined
    ? record.lightEnd
    : DEFAULT_SCHEDULE_CONFIG.lightEnd
  const enabled = typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_SCHEDULE_CONFIG.enabled
  return { enabled, lightStart, lightEnd }
}

/** Minutes since midnight for the window start, defaulting when malformed. */
function startMinutes(config: Pick<ScheduleConfig, 'lightStart'>): number {
  return parseTimeOfDay(config.lightStart) ?? parseTimeOfDay(DEFAULT_SCHEDULE_CONFIG.lightStart)!
}

/** Minutes since midnight for the window end, defaulting when malformed. */
function endMinutes(config: Pick<ScheduleConfig, 'lightEnd'>): number {
  return parseTimeOfDay(config.lightEnd) ?? parseTimeOfDay(DEFAULT_SCHEDULE_CONFIG.lightEnd)!
}

/**
 * Which palette the schedule asks for at `now` (local wall clock).
 *
 * The light window is `[start, end)`. `start < end` is an ordinary day
 * window; `start > end` wraps midnight (e.g. 22:00–06:00); `start === end`
 * means "always light", which is the only non-wrapping degenerate form.
 * @param now - any Date; only its local hours/minutes are read.
 * @param config - the window fields.
 * @returns the requested palette.
 */
export function periodAt(now: Date, config: Pick<ScheduleConfig, 'lightStart' | 'lightEnd'>): Period {
  const start = startMinutes(config)
  const end = endMinutes(config)
  if (start === end) return 'light'
  const minutes = now.getHours() * 60 + now.getMinutes()
  if (start < end) return minutes >= start && minutes < end ? 'light' : 'dark'
  return minutes >= start || minutes < end ? 'light' : 'dark'
}

/** The next occurrence of a wall-clock minute strictly after `now`. */
function boundaryAfter(now: Date, minutes: number): Date {
  const at = new Date(now.getTime())
  at.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1)
  return at
}

/**
 * The next wall-clock boundary and the period it opens. Used by the settings
 * row to show "next switch" and by tests to pin the boundary semantics.
 * @param now - reference instant.
 * @param config - the window fields.
 * @returns the earliest of the two boundaries, or undefined for an all-day window.
 */
export function nextTransition(now: Date, config: Pick<ScheduleConfig, 'lightStart' | 'lightEnd'>): { at: Date; period: Period } | undefined {
  const start = startMinutes(config)
  const end = endMinutes(config)
  if (start === end) return undefined
  const startAt = boundaryAfter(now, start)
  const endAt = boundaryAfter(now, end)
  const at = startAt.getTime() <= endAt.getTime() ? startAt : endAt
  return { at, period: periodAt(at, config) }
}
