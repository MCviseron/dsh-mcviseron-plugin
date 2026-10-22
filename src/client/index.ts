import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { AppearanceScheduleRow } from './AppearanceScheduleRow.tsx'
import { FallbackRestartRow } from './FallbackRestartRow.tsx'
import { SessionEndControl } from './SessionEndControl.tsx'
import { SettingsSection } from './SettingsSection.tsx'
import { ScheduleDriver, type ThemeFace } from './driver.ts'
import { en, zh, type McviseronKey } from './locales.ts'
import { sectionPresence } from './section-presence.ts'

const NS = 'mcviseron'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    mcviseron: McviseronKey
  }

  interface SlotMap {
    'conversation.input.left': {
      kind: 'list'
      scope: 'session'
      owner: { children?: never }
    }
  }
}

export const inject = ['slots', 'locale']

interface SlotFace {
  inject: (name: string, callback: () => () => void) => void
  register: (options: Record<string, unknown>, component: unknown) => () => void
}

/**
 * Register a list-slot entry without letting a rejected slot (a profile whose
 * settings shell does not declare it) fail the whole client plugin and dispose
 * the other registrations.
 */
function registerSafely(
  ctx: ClientContext,
  name: string,
  options: Record<string, unknown>,
  component: unknown,
  onRegistered?: () => void,
  onFailed?: (error: unknown) => void,
): void {
  const slots = ctx.slots as unknown as SlotFace
  try {
    slots.inject(name, () => {
      try {
        const dispose = slots.register({ name, ...options }, component)
        onRegistered?.()
        return dispose
      } catch (error) {
        console.error('[mcviseron] cannot register ' + name, error)
        onFailed?.(error)
        return () => {}
      }
    })
  } catch (error) {
    console.error('[mcviseron] cannot inject ' + name, error)
    onFailed?.(error)
  }
}

/**
 * Browser half of the master plugin: registers the locale dictionaries, the
 * Appearance row, the MCviseron settings section, and the General restart
 * fallback used when the settings shell does not declare `settings.section`.
 *
 * `theme` is resolved lazily instead of being declared in `inject`, because the
 * row (and its persisted settings) must remain usable even when the theme
 * plugin is absent or reloading; the driver simply retries on its next tick.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  try {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'mcviseron: dictionaries')
  } catch (error) {
    console.error('[mcviseron] cannot register dictionaries', error)
  }

  const themeOf = (): ThemeFace | undefined => {
    try {
      const get = (ctx as unknown as { get?: (name: string) => unknown }).get
      return (typeof get === 'function' ? get.call(ctx, 'theme') : undefined) as ThemeFace | undefined
    } catch {
      return undefined
    }
  }

  const driver = new ScheduleDriver(themeOf)
  try {
    ctx.effect(() => driver.start(), 'mcviseron: appearance schedule driver')
  } catch (error) {
    console.error('[mcviseron] cannot start the appearance driver', error)
  }

  // The theme registers Appearance at order 10 and Font settings at 11; 10.5
  // keeps the schedule row directly under Appearance instead of below Font.
  registerSafely(ctx, 'settings.general.item', {
    id: 'mcviseron-appearance-schedule',
    order: 10.5,
    locale: NS,
    inject: () => ({ driver }),
  }, AppearanceScheduleRow)

  registerSafely(ctx, 'settings.general.item', {
    id: 'mcviseron-restart-fallback',
    order: 13,
    locale: NS,
  }, FallbackRestartRow)

  registerSafely(ctx, 'conversation.input.left', {
    id: 'mcviseron-session-end',
    order: 20,
    locale: NS,
  }, SessionEndControl)

  registerSafely(ctx, 'settings.section', {
    id: 'mcviseron',
    order: 115,
    label: 'MCviseron',
    locale: NS,
  }, SettingsSection, () => { sectionPresence.markLive() }, (error) => { sectionPresence.markFailed(error) })
}
