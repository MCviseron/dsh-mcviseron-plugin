import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installAutoReview } from '../components/auto-review/index.ts'
import { toPlain } from '../volatile.ts'

/**
 * Auto-review component: shutdown preset guard + Chinese approval translation.
 * The whole implementation lives in `components/auto-review`; this entry owns
 * the profile Config so the plugin inventory can list the component on its own.
 */
export const Config = z.object({
  keepPresetGuard: z.boolean().default(true).volatile(),
  translateApprovalReason: z.boolean().default(true).volatile(),
  translateTimeoutMs: z.number().min(500).max(60000).default(6000).volatile(),
  translateMaxChars: z.number().min(100).max(20000).default(4000).volatile(),
  translateProvider: z.string().default('').volatile(),
  translateModel: z.string().default('').volatile(),
}).default({
  keepPresetGuard: true,
  translateApprovalReason: true,
  translateTimeoutMs: 6000,
  translateMaxChars: 4000,
  translateProvider: '',
  translateModel: '',
})

export interface AutoReviewConfig {
  keepPresetGuard?: boolean
  translateApprovalReason?: boolean
  translateTimeoutMs?: number
  translateMaxChars?: number
  translateProvider?: string
  translateModel?: string
}

/**
 * Install the Auto-review component.
 * @param ctx - the component's plugin context.
 * @param config - the entry Config.
 */
export function apply(ctx: Context, config?: AutoReviewConfig): void {
  installAutoReview(ctx, toPlain(config))
}
