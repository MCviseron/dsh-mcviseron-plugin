import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installTaskGuard, type TaskGuardConfig } from '../components/task-guard/index.ts'
import { toPlain } from '../volatile.ts'

/**
 * Todo plan guard component. The guard implementation lives in
 * `components/task-guard`; this entry owns the profile Config.
 *
 * `exclude` ships the component default (`todo_write`, `ask_user_question`)
 * so an absent profile value keeps the original behavior.
 */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  locale: z.union(['zh', 'en'] as const).default('zh').volatile(),
  staleAfterCalls: z.number().min(1).default(5).volatile(),
  repeatEveryCalls: z.number().min(0).default(4).volatile(),
  blockAfterCalls: z.number().min(0).default(0).volatile(),
  rejectMissingActive: z.boolean().default(false).volatile(),
  sourceKind: z.union(['auto', 'v3', 'v4'] as const).default('auto').volatile(),
  maxListItems: z.number().min(1).default(6).volatile(),
  include: z.array(z.string()).default([]).volatile(),
  exclude: z.array(z.string()).default(['todo_write', 'ask_user_question']).volatile(),
}).default({
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

/**
 * Install the todo plan guard.
 * @param ctx - the component's plugin context.
 * @param config - the entry Config.
 */
export function apply(ctx: Context, config?: TaskGuardConfig): void {
  installTaskGuard(ctx, toPlain(config))
}
