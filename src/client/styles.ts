import type { CSSProperties } from 'react'

const labelPrimary = 'var(--dsw-alias-label-primary, #1f2329)'
const labelSecondary = 'var(--dsw-alias-label-secondary, #5c6570)'
const labelTertiary = 'var(--dsw-alias-label-tertiary, #8a919b)'
const borderL2 = 'var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08))'
const fieldFill = 'var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.03))'
const trackOff = 'var(--dsw-alias-bg-layer-3, rgba(0, 0, 0, 0.16))'
const accent = 'var(--dsw-alias-state-business-primary, #4176e6)'
const thumb = 'var(--dsw-alias-switch-thumb, #ffffff)'

const buttonShape: CSSProperties = {
  padding: '4px 14px',
  border: '1px solid ' + borderL2,
  borderRadius: 6,
  background: fieldFill,
  color: labelPrimary,
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'pointer',
}

const thumbShape: CSSProperties = {
  position: 'absolute',
  top: 2,
  left: 2,
  width: 16,
  height: 16,
  borderRadius: '50%',
  background: thumb,
  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
  transition: 'transform 120ms ease',
}

/**
 * Inline styles rather than a CSS bundle: the row is a single settings control,
 * and reading the live `--dsw-alias-*` variables keeps it in step with the
 * active palette (including third-party themes) without shipping a stylesheet.
 */
export const styles = {
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    padding: '10px 0',
    flexWrap: 'wrap',
  } satisfies CSSProperties,
  text: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 0,
  } satisfies CSSProperties,
  title: {
    fontSize: 14,
    lineHeight: '20px',
    color: labelPrimary,
  } satisfies CSSProperties,
  description: {
    fontSize: 12,
    lineHeight: '18px',
    color: labelSecondary,
  } satisfies CSSProperties,
  status: {
    fontSize: 12,
    lineHeight: '18px',
    color: labelTertiary,
  } satisfies CSSProperties,
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flex: '0 0 auto',
  } satisfies CSSProperties,
  times: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  } satisfies CSSProperties,
  field: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  } satisfies CSSProperties,
  fieldLabel: {
    fontSize: 12,
    lineHeight: '18px',
    color: labelSecondary,
  } satisfies CSSProperties,
  input: {
    width: 84,
    padding: '2px 6px',
    border: '1px solid ' + borderL2,
    borderRadius: 6,
    background: fieldFill,
    color: labelPrimary,
    fontSize: 12,
    fontFamily: 'inherit',
  } satisfies CSSProperties,
  dash: {
    fontSize: 12,
    color: labelTertiary,
  } satisfies CSSProperties,
  button: buttonShape,
  buttonDisabled: { ...buttonShape, opacity: 0.6, cursor: 'default' } satisfies CSSProperties,
  switchOff: {
    position: 'relative',
    width: 36,
    height: 20,
    padding: 0,
    border: 'none',
    borderRadius: 999,
    background: trackOff,
    cursor: 'pointer',
    transition: 'background 120ms ease',
    flex: '0 0 auto',
  } satisfies CSSProperties,
  switchOn: {
    position: 'relative',
    width: 36,
    height: 20,
    padding: 0,
    border: 'none',
    borderRadius: 999,
    background: accent,
    cursor: 'pointer',
    transition: 'background 120ms ease',
    flex: '0 0 auto',
  } satisfies CSSProperties,
  thumbOff: thumbShape,
  thumbOn: { ...thumbShape, transform: 'translateX(16px)' } satisfies CSSProperties,
} as const
