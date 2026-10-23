/**
 * Per-entry Config tests: defaults, validation, and the shipped profile shape.
 *
 * `node --experimental-strip-types test/config.test.ts`
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Config as AppearanceConfig } from '../src/appearance/index.ts'
import { Config as MasterConfig } from '../src/index.ts'
import { Config as AutoReviewConfig } from '../src/auto-review-fix/index.ts'
import { Config as TaskGuardConfig } from '../src/task-guard/index.ts'
import { Config as RestartConfig } from '../src/restart/index.ts'

type VolatileLike = { get: () => unknown }

function isVolatileLike(value: unknown): value is VolatileLike {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  if (typeof (value as { get?: unknown }).get !== 'function') return false
  return Object.getOwnPropertySymbols(value).length > 0
    || Object.keys(value as object).every(key => key === 'get')
}

/** Resolve a schema input to plain values (volatile fields are refs). */
function toPlain<T>(value: T): T {
  if (isVolatileLike(value)) return toPlain(value.get() as T)
  if (Array.isArray(value)) return value.map(item => toPlain(item)) as T
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) result[key] = toPlain(child)
    return result as T
  }
  return value
}

function resolve(schema: unknown, input: unknown): any {
  return toPlain((schema as (value: unknown) => unknown)(input))
}

test('appearance defaults and time validation', () => {
  const value = resolve(AppearanceConfig, {})
  assert.deepEqual(value, { enabled: false, lightStart: '08:00', lightEnd: '23:00' })
  assert.deepEqual(resolve(AppearanceConfig, { enabled: true }), { enabled: true, lightStart: '08:00', lightEnd: '23:00' })
  assert.throws(() => resolve(AppearanceConfig, { lightStart: '25:00' }))
  assert.throws(() => resolve(AppearanceConfig, { lightEnd: '8:00' }))
})

test('autoReview defaults and numeric bounds', () => {
  const value = resolve(AutoReviewConfig, {})
  assert.deepEqual(value, {
    keepPresetGuard: true,
    translateApprovalReason: true,
    translateTimeoutMs: 6000,
    translateMaxChars: 4000,
    translateProvider: '',
    translateModel: '',
    reviewContextGuard: true,
    reviewMaxHistoryChars: 120000,
    reviewKeepRecentEntries: 16,
  })
  assert.equal(resolve(AutoReviewConfig, { translateApprovalReason: false }).translateApprovalReason, false)
  assert.throws(() => resolve(AutoReviewConfig, { translateTimeoutMs: 10 }))
  assert.throws(() => resolve(AutoReviewConfig, { translateMaxChars: 10_000_000 }))
})

test('taskGuard defaults keep the component tool filter', () => {
  const value = resolve(TaskGuardConfig, {})
  assert.deepEqual(value, {
    enabled: true,
    locale: 'zh',
    staleAfterCalls: 5,
    repeatEveryCalls: 4,
    blockAfterCalls: 0,
    rejectMissingActive: false,
    sourceKind: 'auto',
    maxListItems: 6,
    detectStepIntent: true,
    translateTodoContent: true,
    todoTranslationTimeoutMs: 3000,
    include: [],
    exclude: ['todo_write', 'ask_user_question'],
  })
  assert.deepEqual(resolve(TaskGuardConfig, { locale: 'en', staleAfterCalls: 3 }).locale, 'en')
  assert.throws(() => resolve(TaskGuardConfig, { locale: 'fr' }))
  assert.throws(() => resolve(TaskGuardConfig, { sourceKind: 'v5' }))
  assert.throws(() => resolve(TaskGuardConfig, { staleAfterCalls: 0 }))
})

test('the master entry nests every component config with its defaults', () => {
  const master = resolve(MasterConfig, {})
  assert.equal(master.enabled, false)
  assert.equal(master.lightStart, '08:00')
  assert.equal(master.lightEnd, '23:00')
  assert.equal(master.autoReviewFix.keepPresetGuard, true)
  assert.equal(master.autoReviewFix.translateTimeoutMs, 6000)
  assert.equal(master.taskGuard.exclude.join(','), 'todo_write,ask_user_question')
  assert.deepEqual(master.restart, { enabled: true, appPath: '' })

  const overridden = resolve(MasterConfig, {
    enabled: true,
    lightStart: '07:30',
    autoReviewFix: { translateApprovalReason: false },
    taskGuard: { locale: 'en', staleAfterCalls: 2 },
    restart: { enabled: false },
  })
  assert.equal(overridden.enabled, true)
  assert.equal(overridden.lightStart, '07:30')
  assert.equal(overridden.autoReviewFix.translateApprovalReason, false)
  assert.equal(overridden.autoReviewFix.keepPresetGuard, true)
  assert.equal(overridden.taskGuard.locale, 'en')
  assert.equal(overridden.restart.enabled, false)
})

test('the shipped profile component configs validate unchanged', () => {
  const appearance = resolve(AppearanceConfig, { enabled: true, lightStart: '08:00', lightEnd: '23:00' })
  assert.deepEqual(appearance, { enabled: true, lightStart: '08:00', lightEnd: '23:00' })

  const autoReview = resolve(AutoReviewConfig, {
    keepPresetGuard: true,
    translateApprovalReason: true,
    translateTimeoutMs: 6000,
    translateMaxChars: 4000,
    translateProvider: '',
    translateModel: '',
  })
  assert.equal(autoReview.translateApprovalReason, true)

  const taskGuard = resolve(TaskGuardConfig, {
    enabled: true,
    locale: 'zh',
    staleAfterCalls: 5,
    repeatEveryCalls: 4,
    blockAfterCalls: 0,
    rejectMissingActive: false,
    sourceKind: 'auto',
    maxListItems: 6,
  })
  assert.equal(taskGuard.exclude.join(','), 'todo_write,ask_user_question')
})

test('restart defaults and path validation', () => {
  assert.deepEqual(resolve(RestartConfig, {}), { enabled: true, appPath: '' })
  assert.equal(resolve(RestartConfig, { enabled: false }).enabled, false)
  assert.equal(resolve(RestartConfig, { appPath: 'D:/app.exe' }).appPath, 'D:/app.exe')
})
