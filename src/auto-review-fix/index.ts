import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installAutoReview } from '../components/auto-review-fix/index.ts'
import { toPlain } from '../volatile.ts'

/**
 * Auto-review fix component: shutdown preset guard + Chinese approval translation.
 * The whole implementation lives in `components/auto-review`; this entry owns
 * the profile Config so the plugin inventory can list the component on its own.
 */
export const DEFAULT_AUTO_REVIEW_CONFIG = {
  keepPresetGuard: true,
  translateApprovalReason: true,
  translateTimeoutMs: 6000,
  translateMaxChars: 4000,
  translateProvider: '',
  translateModel: '',
} as const

export const Config = z.object({
  keepPresetGuard: z.boolean().default(DEFAULT_AUTO_REVIEW_CONFIG.keepPresetGuard).volatile(),
  translateApprovalReason: z.boolean().default(DEFAULT_AUTO_REVIEW_CONFIG.translateApprovalReason).volatile(),
  translateTimeoutMs: z.number().min(500).max(60000).default(DEFAULT_AUTO_REVIEW_CONFIG.translateTimeoutMs).volatile(),
  translateMaxChars: z.number().min(100).max(20000).default(DEFAULT_AUTO_REVIEW_CONFIG.translateMaxChars).volatile(),
  translateProvider: z.string().default(DEFAULT_AUTO_REVIEW_CONFIG.translateProvider).volatile(),
  translateModel: z.string().default(DEFAULT_AUTO_REVIEW_CONFIG.translateModel).volatile(),
}).default(DEFAULT_AUTO_REVIEW_CONFIG)

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
