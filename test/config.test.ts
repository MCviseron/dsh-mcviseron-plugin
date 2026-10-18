/**
 * Master Config tests: the documented nested profile config, its defaults, and
 * the component-group split that the Host apply() performs.
 *
 * `node --experimental-strip-types test/config.test.ts`
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { componentConfigs, Config, toPlain } from '../src/config.ts'

/** Resolve a schema input to plain values (volatile fields are refs). */
function resolve(input: unknown): any {
  return toPlain((Config as any)(input))
}

test('an empty config resolves every group to its shipped defaults', () => {
  const value = resolve({})
  assert.deepEqual(value.appearance, { enabled: false, lightStart: '08:00', lightEnd: '23:00' })
  assert.deepEqual(value.autoReview, {
    keepPresetGuard: true,
    translateApprovalReason: true,
    translateTimeoutMs: 6000,
    translateMaxChars: 4000,
    translateProvider: '',
    translateModel: '',
  })
  assert.deepEqual(value.taskGuard, {
    enabled: true,
    locale: 'zh',
    staleAfterCalls: 5,
    repeatEveryCalls: 4,
    blockAfterCalls: 0,
    rejectMissingActive: false,
    sourceKind: 'auto',
    maxListItems: 6,
    include: [],
    exclude: ['todo_write', 'ask_user_question'],
  })
})

test('a partial group keeps the other fields at their defaults', () => {
  const value = resolve({ appearance: { enabled: true }, taskGuard: { locale: 'en', staleAfterCalls: 3 } })
  assert.deepEqual(value.appearance, { enabled: true, lightStart: '08:00', lightEnd: '23:00' })
  assert.equal(value.taskGuard.locale, 'en')
  assert.equal(value.taskGuard.staleAfterCalls, 3)
  assert.equal(value.taskGuard.exclude.join(','), 'todo_write,ask_user_question')
})

test('the documented profile config (nested groups) validates unchanged', () => {
  const documented = {
    appearance: { enabled: true, lightStart: '08:00', lightEnd: '23:00' },
    autoReview: {
      keepPresetGuard: true,
      translateApprovalReason: true,
      translateTimeoutMs: 6000,
      translateMaxChars: 4000,
      translateProvider: '',
      translateModel: '',
    },
    taskGuard: {
      enabled: true,
      locale: 'zh',
      staleAfterCalls: 5,
      repeatEveryCalls: 4,
      blockAfterCalls: 0,
      rejectMissingActive: false,
      sourceKind: 'auto',
      maxListItems: 6,
    },
  }
  const value = resolve(documented)
  for (const [group, fields] of Object.entries(documented)) {
    for (const [field, expected] of Object.entries(fields)) {
      assert.deepEqual(value[group][field], expected, group + '.' + field)
    }
  }
})

test('the schema rejects malformed times and out-of-range numbers', () => {
  assert.throws(() => resolve({ appearance: { lightStart: '25:00' } }), /lightStart|pattern|match/i)
  assert.throws(() => resolve({ appearance: { lightEnd: '8:00' } }))
  assert.throws(() => resolve({ autoReview: { translateTimeoutMs: 10 } }))
  assert.throws(() => resolve({ taskGuard: { locale: 'fr' } }))
  assert.throws(() => resolve({ taskGuard: { sourceKind: 'v5' } }))
})

test('componentConfigs unwraps volatile-like references and normalizes appearance', () => {
  const volatile = (value: unknown) => ({ get: () => value })
  const holder = volatile({
    appearance: volatile({ enabled: true, lightStart: '22:00', lightEnd: '06:00' }),
    autoReview: volatile({ keepPresetGuard: false }),
    taskGuard: volatile({ locale: 'en' }),
  })
  const groups = componentConfigs(holder)
  assert.deepEqual(groups.appearance, { enabled: true, lightStart: '22:00', lightEnd: '06:00' })
  assert.deepEqual(groups.autoReview, { keepPresetGuard: false })
  assert.deepEqual(groups.taskGuard, { locale: 'en' })
})

test('componentConfigs tolerates a missing or malformed config', () => {
  for (const input of [undefined, null, 42, 'x', []]) {
    const groups = componentConfigs(input)
    assert.deepEqual(groups.appearance, { enabled: false, lightStart: '08:00', lightEnd: '23:00' })
    assert.equal(groups.autoReview, undefined)
    assert.equal(groups.taskGuard, undefined)
  }
})
