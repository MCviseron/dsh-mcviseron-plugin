import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { AppearanceScheduleRow } from './AppearanceScheduleRow.tsx'
import { SettingsSection } from './SettingsSection.tsx'
import { ScheduleDriver, type ThemeFace } from './driver.ts'
import { en, zh, type McviseronKey } from './locales.ts'

const NS = 'mcviseron'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    mcviseron: McviseronKey
  }
}

export const inject = ['slots', 'locale']

/**
 * Browser half of the master plugin: registers the locale dictionaries, the
 * Appearance row, and the theme driver that keeps switching palettes while the
 * settings page is closed.
 *
 * `theme` is resolved lazily instead of being declared in `inject`, because the
 * row (and its persisted settings) must remain usable even when the theme
 * plugin is absent or reloading; the driver simply retries on its next tick.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'mcviseron: dictionaries')

  const themeOf = (): ThemeFace | undefined => {
    try {
      const get = (ctx as unknown as { get?: (name: string) => unknown }).get
      return (typeof get === 'function' ? get.call(ctx, 'theme') : undefined) as ThemeFace | undefined
    } catch {
      return undefined
    }
  }

  const driver = new ScheduleDriver(themeOf)
  ctx.effect(() => driver.start(), 'mcviseron: appearance schedule driver')

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'mcviseron-appearance-schedule',
    order: 12,
    locale: NS,
    inject: () => ({ driver }),
  }, AppearanceScheduleRow))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'mcviseron',
    order: 115,
    label: () => ctx.locale.bind(NS)('page.title'),
    locale: NS,
  }, SettingsSection))
}
