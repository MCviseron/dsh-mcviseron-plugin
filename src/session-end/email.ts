import nodemailer from 'nodemailer'
import { toPlain } from '../volatile.ts'
import {
  DEFAULT_SESSION_END_CONFIG,
  type SessionEndOptions,
} from './index.ts'

/**
 * Optional integration with dsh-email-notify.
 *
 * The email plugin does not expose a notification service, so this module
 * reads its public settings namespace (the same SMTP account the user already
 * configured) and sends one custom message through nodemailer. It never
 * modifies the email plugin and sends nothing when the plugin is absent,
 * disabled, or missing any sendable SMTP field.
 */

export interface EmailNotifyConfig {
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpUser: string
  smtpPassword: string
  mailFrom: string
  mailTo: string
}

export interface SessionEndEmailInput {
  settings: unknown
  template: SessionEndOptions
  sessionId: string
  sessionName: string
  action: 'restart' | 'close'
  reason: string
  now?: () => Date
  sendMail?: (email: EmailNotifyConfig, message: { subject: string; text: string }) => Promise<void>
}

export interface SessionEndEmailResult {
  sent: boolean
  reason?: string
}

interface SettingsFace {
  describe?: (options?: { redactSecrets?: boolean }) => unknown
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 65535
    ? Math.trunc(value)
    : fallback
}

/** Extract the live email-notify config from one settings describe view. */
export function emailNotifyConfigFromView(view: unknown): EmailNotifyConfig | undefined {
  if (view === null || typeof view !== 'object' || Array.isArray(view)) return undefined
  const value = toPlain((view as { value?: unknown }).value)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  if (source.enabled === false) return undefined
  const smtpHost = text(source.smtpHost)
  const smtpUser = text(source.smtpUser)
  const smtpPassword = text(source.smtpPassword)
  const mailTo = text(source.mailTo)
  const mailFrom = text(source.mailFrom) || smtpUser
  if (smtpHost === '' || smtpUser === '' || smtpPassword === '' || mailTo === '' || mailFrom === '') return undefined
  return {
    smtpHost,
    smtpPort: readNumber(source.smtpPort, 465),
    smtpSecure: source.smtpSecure !== false,
    smtpUser,
    smtpPassword,
    mailFrom,
    mailTo,
  }
}

/** Read the dsh-email-notify namespace from the live settings service. */
export function resolveEmailNotifyConfig(settings: unknown): EmailNotifyConfig | undefined {
  const describe = (settings as SettingsFace | undefined)?.describe
  if (typeof describe !== 'function') return undefined
  try {
    const views = describe.call(settings, { redactSecrets: false })
    if (!Array.isArray(views)) return undefined
    const view = views.find(item => String((item as { ns?: unknown })?.ns ?? '') === 'email-notify')
    return emailNotifyConfigFromView(view)
  } catch {
    return undefined
  }
}

function actionText(action: 'restart' | 'close'): string {
  return action === 'restart' ? '重启 DeepSeek Harness' : '关闭 DeepSeek Harness'
}

/** Render the custom subject/body with the same simple placeholder model. */
export function renderSessionEndEmail(
  template: SessionEndOptions,
  input: {
    sessionId: string
    sessionName: string
    action: 'restart' | 'close'
    reason: string
    now: Date
  },
): { subject: string; text: string } {
  const vars: Record<string, string> = {
    action: input.action,
    actionText: actionText(input.action),
    sessionId: input.sessionId,
    sessionName: input.sessionName === '' ? input.sessionId : input.sessionName,
    time: input.now.toLocaleString('zh-CN', { hour12: false }),
    reason: input.reason === '' ? '（未提供）' : input.reason,
  }
  const render = (source: string): string => source.replace(/\{\{([a-zA-Z]+)\}\}/g, (_match, key: string) => vars[key] ?? '')
  return {
    subject: render(template.emailSubject ?? DEFAULT_SESSION_END_CONFIG.emailSubject),
    text: render(template.emailBody ?? DEFAULT_SESSION_END_CONFIG.emailBody),
  }
}

async function defaultSendMail(email: EmailNotifyConfig, message: { subject: string; text: string }): Promise<void> {
  const transport = nodemailer.createTransport({
    host: email.smtpHost,
    port: email.smtpPort,
    secure: email.smtpSecure,
    auth: { user: email.smtpUser, pass: email.smtpPassword },
  })
  await transport.sendMail({
    from: email.mailFrom,
    to: email.mailTo,
    subject: message.subject,
    text: message.text,
  })
}

/**
 * Send the AI-armed session-end reminder when email-notify is configured.
 * Never throws: email is an optional side channel and must not block the tool.
 */
export async function sendSessionEndEmail(input: SessionEndEmailInput): Promise<SessionEndEmailResult> {
  if (input.template.notifyEmailOnAi === false) return { sent: false, reason: 'disabled' }
  const email = resolveEmailNotifyConfig(input.settings)
  if (email === undefined) return { sent: false, reason: 'email-notify-unavailable' }
  const now = input.now?.() ?? new Date()
  const rendered = renderSessionEndEmail(input.template, {
    sessionId: input.sessionId,
    sessionName: input.sessionName,
    action: input.action,
    reason: input.reason,
    now,
  })
  try {
    await (input.sendMail ?? defaultSendMail)(email, rendered)
    return { sent: true }
  } catch (error) {
    return { sent: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
