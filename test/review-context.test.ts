import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import {
  boundEntries,
  installReviewContextGuard,
  isAutoReviewRequest,
  trimReviewRequest,
  type ReviewContextSettings,
  type ReviewOptions,
} from '../src/components/auto-review-fix/review-context.ts'

const SETTINGS: ReviewContextSettings = {
  enabled: true,
  maxHistoryChars: 30_000,
  keepRecentEntries: 8,
}

function userEntry(role: string, text: string): Record<string, unknown> {
  return {
    kind: 'user-message',
    role,
    source: { kind: 'user', rpcId: 'rpc' },
    content: [{ type: 'text', text }],
  }
}

function toolEntry(index: number): Record<string, unknown> {
  return {
    kind: 'tool-call',
    role: 'fact',
    mode: 'native',
    name: 'pwsh',
    arguments: 'x'.repeat(5_000) + ':' + String(index),
  }
}

function reviewOptions(history: unknown[], project: unknown[] = []): ReviewOptions & { messages: any[] } {
  const text = [
    'ENVIRONMENT',
    JSON.stringify({ cwd: 'D:/project' }),
    'PROJECT_INSTRUCTIONS',
    JSON.stringify(project),
    'FILTERED_HISTORY',
    JSON.stringify(history),
    'PENDING_ACTION',
    JSON.stringify({ name: 'pwsh', arguments: 'action-marker' }),
  ].join('\n\n')
  return {
    provider: 'provider',
    model: 'model',
    system: 'REVIEW_POLICY You are the final authorization reviewer for exactly one pending tool call.',
    messages: [{ role: 'user', content: [{ type: 'text', text }] }],
    temperature: 0,
  }
}

function textOf(options: ReviewOptions): string {
  const messages = options.messages as Array<{ content?: Array<{ text?: string }> }> | undefined
  return messages?.[0]?.content?.[0]?.text ?? ''
}

test('only the Auto-review system and request shape are recognised', () => {
  const review = reviewOptions([userEntry('human-instruction', 'do it')])
  assert.equal(isAutoReviewRequest(review), true)
  assert.equal(isAutoReviewRequest({ system: 'helpful', messages: review.messages }), false)
  assert.equal(isAutoReviewRequest({ ...review, system: 'REVIEW_POLICY only' }), false)
  assert.equal(isAutoReviewRequest({ ...review, messages: [] }), false)
})

test('non-review requests pass through untouched', () => {
  const normal = { system: 'You are helpful', messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] }
  assert.equal(trimReviewRequest(normal, SETTINGS), normal)
})

test('malformed review history is left untouched', () => {
  const review = reviewOptions([])
  const text = textOf(review).replace('[]', 'not-json')
  const broken = { ...review, messages: [{ role: 'user', content: [{ type: 'text', text }] }] }
  assert.equal(trimReviewRequest(broken, SETTINGS), broken)
})

test('the reviewer keeps the pending action, project constraints and human instructions', () => {
  const history: unknown[] = []
  for (let index = 0; index < 400; index += 1) {
    history.push(toolEntry(index))
    if (index === 0 || index === 200 || index === 399) {
      history.push(userEntry('human-instruction', 'instruction-' + String(index)))
    }
  }
  const project = [userEntry('constraint', 'project-constraint')]
  const options = reviewOptions(history, project)
  const trimmed = trimReviewRequest(options, SETTINGS)
  const text = textOf(trimmed)

  assert.ok(text.includes('"arguments":"action-marker"'), 'pending action must survive byte-for-byte')
  assert.ok(text.includes('project-constraint'), 'project instructions must survive')
  assert.ok(text.includes('instruction-0'), 'the oldest human instruction must survive')
  assert.ok(text.includes('instruction-399'), 'the newest human instruction must survive')
  assert.ok(text.includes('earlier history entries omitted'), 'a summary must explain the omission')
  assert.ok(text.length < textOf(options).length, 'the reviewer request must shrink')

  const historyJson = text.slice(text.indexOf('FILTERED_HISTORY\n\n') + 'FILTERED_HISTORY\n\n'.length, text.indexOf('\n\nPENDING_ACTION'))
  const parsed = JSON.parse(historyJson) as unknown[]
  assert.ok(Array.isArray(parsed))
  assert.ok(JSON.stringify(parsed).length <= SETTINGS.maxHistoryChars + 2_000, 'history stays near the budget')
})

test('old tool arguments are truncated and images lose their payload', () => {
  const history = [
    toolEntry(1),
    toolEntry(2),
    toolEntry(3),
    toolEntry(4),
    toolEntry(5),
    toolEntry(6),
    toolEntry(7),
    toolEntry(8),
    {
      kind: 'user-message',
      role: 'fact',
      source: { kind: 'user' },
      content: [{ type: 'image', data: 'A'.repeat(200_000) }],
    },
  ]
  const trimmed = trimReviewRequest(reviewOptions(history), SETTINGS)
  const text = textOf(trimmed)
  assert.ok(text.includes('image omitted from reviewer context'))
  assert.ok(!text.includes('A'.repeat(1_000)), 'base64 image data must not reach the reviewer')
  assert.ok(text.includes('characters omitted'))
})

test('boundEntries keeps protected entries even when it has to drop facts', () => {
  const history = [
    userEntry('human-instruction', 'must-keep'),
    ...Array.from({ length: 20 }, (_, index) => toolEntry(index)),
  ]
  const bounded = boundEntries(history, 3_000, 2) as Array<Record<string, unknown>>
  const serialized = JSON.stringify(bounded)
  assert.ok(serialized.includes('must-keep'))
  assert.ok(serialized.includes('earlier history entries omitted'))
  assert.ok(serialized.length <= 3_000 + 1_000)
})

test('the llm.stream wrapper trims only reviewer calls', () => {
  const calls: unknown[] = []
  const llm = {
    stream(options: unknown) {
      calls.push(options)
      return (async function* () {
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  const ctx = {
    inject(_deps: string[], callback: (scope: unknown) => void) {
      callback(ctx)
      return ctx
    },
    get(name: string) {
      return name === 'llm' ? llm : undefined
    },
    effect(body: () => () => void) {
      return body()
    },
  } as unknown as Context
  installReviewContextGuard(ctx, SETTINGS)

  const review = reviewOptions(Array.from({ length: 100 }, (_, index) => toolEntry(index)))
  const normal = { system: 'You are helpful', messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] }
  void llm.stream(review)
  void llm.stream(normal)

  assert.equal(calls.length, 2)
  assert.notEqual(calls[0], review)
  assert.ok(textOf(calls[0] as ReviewOptions).length < textOf(review).length)
  assert.equal(calls[1], normal)
})
