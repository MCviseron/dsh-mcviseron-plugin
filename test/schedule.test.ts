/**
 * Wall-clock rule tests for the appearance schedule.
 *
 * `node --experimental-strip-types test/schedule.test.ts`
 *
 * Every assertion uses local Date constructors (`new Date(y, m, d, h, min)`),
 * so the suite is time-zone independent: it pins wall-clock behavior, which is
 * exactly what the feature promises.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_SCHEDULE_CONFIG,
  formatTimeOfDay,
  nextTransition,
  normalizeScheduleConfig,
  parseTimeOfDay,
  periodAt,
} from '../src/schedule.ts'

/** Local wall-clock instant in October 2026 (no DST transition nearby in most zones). */
function at(hours: number, minutes: number): Date {
  return new Date(2026, 9, 18, hours, minutes, 0, 0)
}

test('parseTimeOfDay accepts every valid wall-clock value', () => {
  assert.equal(parseTimeOfDay('00:00'), 0)
  assert.equal(parseTimeOfDay('08:00'), 480)
  assert.equal(parseTimeOfDay('23:59'), 1439)
})

test('parseTimeOfDay rejects malformed and out-of-range values', () => {
  for (const value of ['', '8:00', '24:00', '12:60', '12:0', 'ab:cd', ' 08:00', '08:00 ']) {
    assert.equal(parseTimeOfDay(value), undefined, value)
  }
})

test('formatTimeOfDay is the inverse of parseTimeOfDay', () => {
  for (let minutes = 0; minutes < 24 * 60; minutes += 7) {
    assert.equal(parseTimeOfDay(formatTimeOfDay(minutes)), minutes)
  }
})

test('normalizeScheduleConfig falls back field by field', () => {
  assert.deepEqual(normalizeScheduleConfig(undefined), DEFAULT_SCHEDULE_CONFIG)
  assert.deepEqual(normalizeScheduleConfig({}), DEFAULT_SCHEDULE_CONFIG)
  assert.deepEqual(
    normalizeScheduleConfig({ enabled: true, lightStart: '09:30', lightEnd: 'oops' }),
    { enabled: true, lightStart: '09:30', lightEnd: '23:00' },
  )
  assert.deepEqual(
    normalizeScheduleConfig({ enabled: 'yes', lightStart: 12, lightEnd: null }),
    DEFAULT_SCHEDULE_CONFIG,
  )
})

test('default window: 08:00 inclusive, 23:00 exclusive', () => {
  const config = DEFAULT_SCHEDULE_CONFIG
  assert.equal(periodAt(at(7, 59), config), 'dark')
  assert.equal(periodAt(at(8, 0), config), 'light')
  assert.equal(periodAt(at(12, 0), config), 'light')
  assert.equal(periodAt(at(22, 59), config), 'light')
  assert.equal(periodAt(at(23, 0), config), 'dark')
  assert.equal(periodAt(at(0, 0), config), 'dark')
})

test('window wrapping midnight: 22:00 inclusive, 06:00 exclusive', () => {
  const config = { lightStart: '22:00', lightEnd: '06:00' }
  assert.equal(periodAt(at(21, 59), config), 'dark')
  assert.equal(periodAt(at(22, 0), config), 'light')
  assert.equal(periodAt(at(23, 30), config), 'light')
  assert.equal(periodAt(at(5, 59), config), 'light')
  assert.equal(periodAt(at(6, 0), config), 'dark')
  assert.equal(periodAt(at(12, 0), config), 'dark')
})

test('equal start and end means an all-day light window', () => {
  const config = { lightStart: '08:00', lightEnd: '08:00' }
  assert.equal(periodAt(at(0, 0), config), 'light')
  assert.equal(periodAt(at(12, 0), config), 'light')
  assert.equal(nextTransition(at(12, 0), config), undefined)
})

test('nextTransition reports the next boundary the period changes at', () => {
  const config = DEFAULT_SCHEDULE_CONFIG

  const beforeLight = nextTransition(at(7, 30), config)
  assert.notEqual(beforeLight, undefined)
  assert.equal(beforeLight!.period, 'light')
  assert.equal(beforeLight!.at.getDate(), 18)
  assert.equal(beforeLight!.at.getHours(), 8)
  assert.equal(beforeLight!.at.getMinutes(), 0)

  const beforeDark = nextTransition(at(8, 30), config)
  assert.equal(beforeDark!.period, 'dark')
  assert.equal(beforeDark!.at.getDate(), 18)
  assert.equal(beforeDark!.at.getHours(), 23)

  const afterDark = nextTransition(at(23, 30), config)
  assert.equal(afterDark!.period, 'light')
  assert.equal(afterDark!.at.getDate(), 19)
  assert.equal(afterDark!.at.getHours(), 8)
})

test('nextTransition handles a window that wraps midnight', () => {
  const config = { lightStart: '22:00', lightEnd: '06:00' }

  const beforeLight = nextTransition(at(21, 30), config)
  assert.equal(beforeLight!.period, 'light')
  assert.equal(beforeLight!.at.getHours(), 22)
  assert.equal(beforeLight!.at.getDate(), 18)

  const beforeDark = nextTransition(at(5, 0), config)
  assert.equal(beforeDark!.period, 'dark')
  assert.equal(beforeDark!.at.getHours(), 6)
  assert.equal(beforeDark!.at.getDate(), 18)

  const nextDay = nextTransition(at(12, 0), config)
  assert.equal(nextDay!.period, 'light')
  assert.equal(nextDay!.at.getHours(), 22)
  assert.equal(nextDay!.at.getDate(), 18)
})
