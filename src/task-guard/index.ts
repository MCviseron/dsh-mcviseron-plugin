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
export const DEFAULT_TASK_GUARD_CONFIG = {
  enabled: true,
  locale: 'zh' as const,
  staleAfterCalls: 5,
  repeatEveryCalls: 4,
  blockAfterCalls: 0,
  rejectMissingActive: false,
  sourceKind: 'auto' as const,
  maxListItems: 6,
  detectStepIntent: true,
  translateTodoContent: true,
  todoTranslationTimeoutMs: 3000,
  include: [] as string[],
  exclude: ['todo_write', 'ask_user_question'] as string[],
}

export const Config = z.object({
  enabled: z.boolean().default(DEFAULT_TASK_GUARD_CONFIG.enabled).volatile(),
  locale: z.union(['zh', 'en'] as const).default(DEFAULT_TASK_GUARD_CONFIG.locale).volatile(),
  staleAfterCalls: z.number().min(1).default(DEFAULT_TASK_GUARD_CONFIG.staleAfterCalls).volatile(),
  repeatEveryCalls: z.number().min(0).default(DEFAULT_TASK_GUARD_CONFIG.repeatEveryCalls).volatile(),
  blockAfterCalls: z.number().min(0).default(DEFAULT_TASK_GUARD_CONFIG.blockAfterCalls).volatile(),
  rejectMissingActive: z.boolean().default(DEFAULT_TASK_GUARD_CONFIG.rejectMissingActive).volatile(),
  sourceKind: z.union(['auto', 'v3', 'v4'] as const).default(DEFAULT_TASK_GUARD_CONFIG.sourceKind).volatile(),
  maxListItems: z.number().min(1).default(DEFAULT_TASK_GUARD_CONFIG.maxListItems).volatile(),
  detectStepIntent: z.boolean().default(DEFAULT_TASK_GUARD_CONFIG.detectStepIntent).volatile(),
  translateTodoContent: z.boolean().default(DEFAULT_TASK_GUARD_CONFIG.translateTodoContent).volatile(),
  todoTranslationTimeoutMs: z.number().min(500).max(15000).default(DEFAULT_TASK_GUARD_CONFIG.todoTranslationTimeoutMs).volatile(),
  include: z.array(z.string()).default(DEFAULT_TASK_GUARD_CONFIG.include).volatile(),
  exclude: z.array(z.string()).default(DEFAULT_TASK_GUARD_CONFIG.exclude).volatile(),
}).default(DEFAULT_TASK_GUARD_CONFIG)

/**
 * Install the todo plan guard.
 * @param ctx - the component's plugin context.
 * @param config - the entry Config.
 */
export function apply(ctx: Context, config?: TaskGuardConfig): void {
  installTaskGuard(ctx, toPlain(config))
}
