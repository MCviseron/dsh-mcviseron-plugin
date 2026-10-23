import assert from 'node:assert/strict'
import test from 'node:test'
import { globalNoticeKey, globalNoticeText, type GlobalSessionEndAction } from '../src/client/SessionEndGlobalNotice.ts'

function action(overrides: Partial<GlobalSessionEndAction> = {}): GlobalSessionEndAction {
  return {
    sessionId: 'session-1234567890',
    label: 'ESP01S无线烧录',
    mode: 'restart',
    requestedBy: 'ai',
    armedAt: 1,
    waiting: false,
    runningAgents: 0,
    runningJobs: 0,
    ...overrides,
  }
}

test('the global notice names the session and the AI action', () => {
  assert.equal(globalNoticeText(action()), '「ESP01S无线烧录」已启用 AI 会话自动重启')
  assert.equal(globalNoticeText(action({ mode: 'close' })), '「ESP01S无线烧录」已启用 AI 会话自动关闭 DSH')
  assert.equal(globalNoticeText(action({ label: '' })), '「会话 …567890」已启用 AI 会话自动重启')
})

test('the global notice identity is session + mode', () => {
  assert.equal(globalNoticeKey(action()), 'session-1234567890:restart:1')
  assert.equal(globalNoticeKey(action({ mode: 'close' })), 'session-1234567890:close:1')
})
