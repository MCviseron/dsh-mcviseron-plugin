declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ReactElement } from 'react'

  export interface SwitchProps {
    checked: boolean
    onChange: (checked: boolean) => void
    label?: string
    disabled?: boolean
    title?: string
    className?: string
  }

  /** The official settings switch supplied by the DSH client shell. */
  export function Switch(props: SwitchProps): ReactElement | null
}
