import { useEffect, useState } from 'react'
import { readPluginConfig, writePluginConfig } from './bridge.ts'
import type { McviseronKey } from './locales.ts'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { pageStyles } from './styles.ts'

type Status = 'loading' | 'ready' | 'saving' | 'saved' | 'failed' | 'unavailable'
type FieldKind = 'switch' | 'number' | 'text' | 'textarea' | 'select' | 'list'

/** One editable config field backed by a nested entry path. */
export interface ConfigField {
  path: readonly string[]
  label: McviseronKey
  hint?: McviseronKey
  kind: FieldKind
  min?: number
  max?: number
  options?: ReadonlyArray<{ value: string; label: McviseronKey }>
}

/** Props shared by the component sub-pages. */
export interface ConfigFormProps {
  t: (key: McviseronKey) => string
  title: McviseronKey
  description: McviseronKey
  fields: readonly ConfigField[]
}

function readPath(config: Record<string, unknown>, path: readonly string[]): unknown {
  let current: unknown = config
  for (const key of path) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function NumberControl({ value, min, max, disabled, onCommit }: {
  value: number | undefined
  min?: number
  max?: number
  disabled: boolean
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value))
  useEffect(() => { setDraft(value === undefined ? '' : String(value)) }, [value])
  const commit = (): void => {
    const parsed = Number(draft)
    const lower = min ?? Number.NEGATIVE_INFINITY
    const upper = max ?? Number.POSITIVE_INFINITY
    if (!Number.isInteger(parsed) || parsed < lower || parsed > upper) {
      setDraft(value === undefined ? '' : String(value))
      return
    }
    if (parsed !== value) onCommit(parsed)
  }
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={draft}
      disabled={disabled}
      onChange={(event) => { setDraft(event.target.value) }}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
      style={pageStyles.formControl}
    />
  )
}

function TextControl({ value, disabled, onCommit }: {
  value: string
  disabled: boolean
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  return (
    <input
      type="text"
      value={draft}
      disabled={disabled}
      onChange={(event) => { setDraft(event.target.value) }}
      onBlur={() => { if (draft !== value) onCommit(draft) }}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
      style={pageStyles.formControl}
    />
  )
}

function TextareaControl({ value, disabled, onCommit }: {
  value: string
  disabled: boolean
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  return (
    <textarea
      value={draft}
      disabled={disabled}
      rows={4}
      onChange={(event) => { setDraft(event.target.value) }}
      onBlur={() => { if (draft !== value) onCommit(draft) }}
      style={{ ...pageStyles.formControl, minHeight: 88, resize: 'vertical' }}
    />
  )
}

function ListControl({ value, disabled, onCommit }: {
  value: string[]
  disabled: boolean
  onCommit: (value: string[]) => void
}) {
  const joined = value.join(', ')
  const [draft, setDraft] = useState(joined)
  useEffect(() => { setDraft(value.join(', ')) }, [value])
  const commit = (): void => {
    const next = draft.split(',').map(item => item.trim()).filter(item => item !== '')
    if (next.join('\u0000') !== value.join('\u0000')) onCommit(next)
  }
  return (
    <input
      type="text"
      value={draft}
      disabled={disabled}
      placeholder="todo_write, ask_user_question"
      onChange={(event) => { setDraft(event.target.value) }}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
      style={pageStyles.formControl}
    />
  )
}

function renderControl(
  field: ConfigField,
  value: unknown,
  disabled: boolean,
  commit: (value: unknown) => void,
  t: (key: McviseronKey) => string,
) {
  switch (field.kind) {
    case 'switch':
      return (
        <Switch
          checked={value === true}
          label={t(field.label)}
          disabled={disabled}
          onChange={(next) => { commit(next) }}
        />
      )
    case 'number':
      return (
        <NumberControl
          value={typeof value === 'number' ? value : undefined}
          min={field.min}
          max={field.max}
          disabled={disabled}
          onCommit={commit}
        />
      )
    case 'text':
      return <TextControl value={typeof value === 'string' ? value : ''} disabled={disabled} onCommit={commit} />
    case 'textarea':
      return <TextareaControl value={typeof value === 'string' ? value : ''} disabled={disabled} onCommit={commit} />
    case 'list':
      return (
        <ListControl
          value={Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []}
          disabled={disabled}
          onCommit={(next) => { commit(next) }}
        />
      )
    case 'select':
      return (
        <select
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(event) => { commit(event.target.value) }}
          style={pageStyles.formControl}
        >
          {(field.options ?? []).map(option => (
            <option key={option.value} value={option.value}>{t(option.label)}</option>
          ))}
        </select>
      )
  }
}

/**
 * One component's settings sub-page: reads the master-entry config through the
 * loopback bridge and writes a single nested field per change.
 */
export function ConfigForm({ t, title, description, fields }: ConfigFormProps) {
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [status, setStatus] = useState<Status>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const view = await readPluginConfig()
      if (cancelled) return
      if (view === undefined) {
        setStatus('unavailable')
        return
      }
      setConfig(view.value)
      setStatus('ready')
    })()
    return () => { cancelled = true }
  }, [])

  const save = async (path: readonly string[], value: unknown): Promise<void> => {
    setStatus('saving')
    setMessage('')
    const result = await writePluginConfig(path, value)
    if (result.ok) {
      if (result.value !== undefined) setConfig(result.value)
      setStatus('saved')
      return
    }
    setStatus('failed')
    setMessage(result.message ?? result.code ?? '')
  }

  const disabled = status === 'loading' || status === 'saving' || status === 'unavailable'
  const statusText = status === 'loading'
    ? t('form.loading')
    : status === 'saving'
      ? t('form.saving')
      : status === 'saved'
        ? t('form.saved')
        : status === 'failed'
          ? t('form.failed') + (message === '' ? '' : ' (' + message + ')')
          : status === 'unavailable'
            ? t('form.unavailable')
            : t('form.autoSave')

  return (
    <div style={pageStyles.card}>
      <div style={pageStyles.cardTitle}>{t(title)}</div>
      <div style={pageStyles.cardBody}>{t(description)}</div>
      <div style={pageStyles.form}>
        {fields.map((field) => {
          const value = readPath(config, field.path)
          return (
            <div key={field.path.join('.')} style={pageStyles.formRow}>
              <div style={pageStyles.formLabel}>{t(field.label)}</div>
              {field.hint === undefined ? null : <div style={pageStyles.formHint}>{t(field.hint)}</div>}
              {renderControl(field, value, disabled, (next) => { void save(field.path, next) }, t)}
            </div>
          )
        })}
      </div>
      <div style={pageStyles.formStatus}>{statusText}</div>
    </div>
  )
}

/** Auto-review component fields. */
export const AUTO_REVIEW_FIELDS: readonly ConfigField[] = [
  { path: ['autoReviewFix', 'reviewContextGuard'], label: 'form.autoReview.reviewGuard', hint: 'form.autoReview.reviewGuardHint', kind: 'switch' },
  { path: ['autoReviewFix', 'reviewMaxHistoryChars'], label: 'form.autoReview.reviewMaxHistory', hint: 'form.autoReview.reviewMaxHistoryHint', kind: 'number', min: 20000, max: 600000 },
  { path: ['autoReviewFix', 'reviewKeepRecentEntries'], label: 'form.autoReview.reviewKeepRecent', kind: 'number', min: 4, max: 64 },
  { path: ['autoReviewFix', 'translateApprovalReason'], label: 'form.autoReview.translate', hint: 'form.autoReview.translateHint', kind: 'switch' },
  { path: ['autoReviewFix', 'keepPresetGuard'], label: 'form.autoReview.keepPreset', hint: 'form.autoReview.keepPresetHint', kind: 'switch' },
  { path: ['autoReviewFix', 'translateTimeoutMs'], label: 'form.autoReview.timeout', kind: 'number', min: 500, max: 60000 },
  { path: ['autoReviewFix', 'translateMaxChars'], label: 'form.autoReview.maxChars', kind: 'number', min: 100, max: 20000 },
  { path: ['autoReviewFix', 'translateProvider'], label: 'form.autoReview.provider', hint: 'form.autoReview.routeHint', kind: 'text' },
  { path: ['autoReviewFix', 'translateModel'], label: 'form.autoReview.model', hint: 'form.autoReview.routeHint', kind: 'text' },
]

/** Todo plan guard fields. */
export const TASK_GUARD_FIELDS: readonly ConfigField[] = [
  { path: ['taskGuard', 'enabled'], label: 'form.taskGuard.enabled', hint: 'form.taskGuard.enabledHint', kind: 'switch' },
  {
    path: ['taskGuard', 'locale'],
    label: 'form.taskGuard.locale',
    kind: 'select',
    options: [
      { value: 'zh', label: 'form.taskGuard.localeZh' },
      { value: 'en', label: 'form.taskGuard.localeEn' },
    ],
  },
  { path: ['taskGuard', 'staleAfterCalls'], label: 'form.taskGuard.stale', kind: 'number', min: 1, max: 1000 },
  { path: ['taskGuard', 'repeatEveryCalls'], label: 'form.taskGuard.repeat', kind: 'number', min: 0, max: 1000 },
  { path: ['taskGuard', 'blockAfterCalls'], label: 'form.taskGuard.block', hint: 'form.taskGuard.blockHint', kind: 'number', min: 0, max: 10000 },
  { path: ['taskGuard', 'rejectMissingActive'], label: 'form.taskGuard.rejectMissingActive', kind: 'switch' },
  {
    path: ['taskGuard', 'sourceKind'],
    label: 'form.taskGuard.sourceKind',
    kind: 'select',
    options: [
      { value: 'auto', label: 'form.taskGuard.sourceAuto' },
      { value: 'v3', label: 'form.taskGuard.sourceV3' },
      { value: 'v4', label: 'form.taskGuard.sourceV4' },
    ],
  },
  { path: ['taskGuard', 'maxListItems'], label: 'form.taskGuard.maxListItems', kind: 'number', min: 1, max: 100 },
  { path: ['taskGuard', 'detectStepIntent'], label: 'form.taskGuard.detectStepIntent', hint: 'form.taskGuard.detectStepIntentHint', kind: 'switch' },
  { path: ['taskGuard', 'translateTodoContent'], label: 'form.taskGuard.translateTodo', hint: 'form.taskGuard.translateTodoHint', kind: 'switch' },
  { path: ['taskGuard', 'todoTranslationTimeoutMs'], label: 'form.taskGuard.todoTimeout', kind: 'number', min: 500, max: 15000 },
  { path: ['taskGuard', 'include'], label: 'form.taskGuard.include', hint: 'form.taskGuard.listHint', kind: 'list' },
  { path: ['taskGuard', 'exclude'], label: 'form.taskGuard.exclude', hint: 'form.taskGuard.listHint', kind: 'list' },
]

/** Session-end action fields. */
export const SESSION_END_FIELDS: readonly ConfigField[] = [
  { path: ['sessionEnd', 'enabled'], label: 'form.sessionEnd.enabled', hint: 'form.sessionEnd.enabledHint', kind: 'switch' },
  { path: ['sessionEnd', 'graceMs'], label: 'form.sessionEnd.grace', hint: 'form.sessionEnd.graceHint', kind: 'number', min: 0, max: 15000 },
  { path: ['sessionEnd', 'notifyEmailOnAi'], label: 'form.sessionEnd.notifyEmail', hint: 'form.sessionEnd.notifyEmailHint', kind: 'switch' },
  { path: ['sessionEnd', 'emailSubject'], label: 'form.sessionEnd.emailSubject', kind: 'text' },
  { path: ['sessionEnd', 'emailBody'], label: 'form.sessionEnd.emailBody', hint: 'form.sessionEnd.emailBodyHint', kind: 'textarea' },
]
