declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { CSSProperties, ReactElement, ReactNode } from 'react'

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

  export interface IconProps {
    className?: string
    style?: CSSProperties
  }

  export function IconChevronDownOutlineRegular(props?: IconProps): ReactElement
  export function IconClockOutlineRegular(props?: IconProps): ReactElement
  export function IconCloseOutlineRegular(props?: IconProps): ReactElement
  export function IconCloseCircleFillRegular(props?: IconProps): ReactElement
  export function IconRefreshOutlineRegular(props?: IconProps): ReactElement
  export function IconStopFillRegular(props?: IconProps): ReactElement

  export interface MenuItem {
    id: string
    label: ReactNode
    disabled?: boolean
    icon?: ReactNode
    danger?: boolean
  }

  export interface MenuProps {
    open: boolean
    anchor: ReactNode
    items?: readonly MenuItem[]
    selectedId?: string
    onSelect?: (id: string) => void
    onClose: () => void
    align?: 'start' | 'end'
    side?: 'bottom' | 'top' | 'right'
    portal?: boolean
    selection?: 'check' | 'fill'
  }

  /** The official anchored dropdown menu and its keyboard/portal behavior. */
  export function Menu(props: MenuProps): ReactElement
}
