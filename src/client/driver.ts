import { DEFAULT_SCHEDULE_CONFIG, normalizeScheduleConfig, periodAt, type Period, type ScheduleConfig } from '../schedule.ts'
import { readScheduleConfig, writeScheduleConfig } from './bridge.ts'

/** The live theme service as this plugin consumes it (structural, version-proof). */
export interface ThemeFace {
  setTheme: (id: string) => void
  getTheme?: () => { preference?: string }
}

/** Where the durable config currently stands. */
export type BridgeState = 'loading' | 'ready' | 'unavailable'

/** Last write outcome, for the row's inline status. */
export type WriteState = 'idle' | 'saving' | 'saved' | 'failed'

/** Immutable snapshot the settings row renders. */
export interface DriverState {
  config: ScheduleConfig
  bridge: BridgeState
  write: WriteState
  /** Period the driver last applied, or undefined when nothing was applied. */
  applied: Period | undefined
}

/** How often the driver re-reads the wall clock (and retries a failed bridge). */
const TICK_MS = 20_000
/** How long an unavailable bridge waits before the next automatic retry. */
const RETRY_MS = 60_000

/**
 * Owns the "switch theme when the wall clock crosses a boundary" loop.
 *
 * It deliberately does not fight manual theme changes: the theme is applied
 * when the computed period differs from the last applied one (first tick after
 * load, enabling the schedule, editing the window, and every boundary). A user
 * who picks another palette in the meantime keeps it until the next boundary.
 */
export class ScheduleDriver {
  private state: DriverState = {
    config: { ...DEFAULT_SCHEDULE_CONFIG },
    bridge: 'loading',
    write: 'idle',
    applied: undefined,
  }

  private readonly listeners = new Set<() => void>()
  private timer: ReturnType<typeof setInterval> | undefined
  private started = false
  private lastRefresh = 0

  /**
   * @param themeOf - resolves the theme service lazily, so the row still works
   * while the theme plugin is absent or reloading.
   * @param now - clock seam for tests and for hosts with a fake clock.
   */
  constructor(
    private readonly themeOf: () => ThemeFace | undefined,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Stable snapshot reader for `useSyncExternalStore`. */
  getState = (): DriverState => this.state

  /** Subscribe to state changes; returns the unsubscriber. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Start the loop. Idempotent; the returned function stops it.
   * @returns cleanup for `ctx.effect`.
   */
  start(): () => void {
    if (this.started) return () => {}
    this.started = true
    void this.refresh()
    this.timer = setInterval(() => {
      this.tick()
    }, TICK_MS)

    const onWake = (): void => {
      this.tick()
    }
    const doc = typeof document === 'undefined' ? undefined : document
    doc?.addEventListener('visibilitychange', onWake)
    if (typeof window !== 'undefined') window.addEventListener('focus', onWake)

    return () => {
      this.started = false
      if (this.timer !== undefined) clearInterval(this.timer)
      this.timer = undefined
      doc?.removeEventListener('visibilitychange', onWake)
      if (typeof window !== 'undefined') window.removeEventListener('focus', onWake)
    }
  }

  /**
   * Load the durable config (initial load, row mount, and retry after a
   * failed bridge). A missing namespace keeps the defaults.
   */
  async refresh(): Promise<void> {
    this.lastRefresh = Date.now()
    const config = await readScheduleConfig()
    if (config === undefined) {
      if (this.state.bridge !== 'unavailable') this.setState({ bridge: 'unavailable' })
      return
    }
    this.setState({ config, bridge: 'ready', write: this.state.write === 'failed' ? 'idle' : this.state.write })
    this.apply()
  }

  /**
   * Persist a patch through the Host bridge and apply it right away. A refused
   * write reverts to the previously persisted config and reports `failed`.
   * @param patch - the fields the user changed.
   */
  async update(patch: Partial<ScheduleConfig>): Promise<void> {
    const next = normalizeScheduleConfig({ ...this.state.config, ...patch })
    if (next.enabled === this.state.config.enabled
      && next.lightStart === this.state.config.lightStart
      && next.lightEnd === this.state.config.lightEnd) return
    this.setState({ write: 'saving' })
    const saved = await writeScheduleConfig(next)
    if (saved === undefined) {
      this.setState({ write: 'failed' })
      return
    }
    this.setState({ config: saved, bridge: 'ready', write: 'saved', applied: undefined })
    this.apply()
  }

  /** Re-read the clock, retry a dead bridge, and apply a changed period. */
  tick(): void {
    if (this.state.bridge === 'unavailable' && Date.now() - this.lastRefresh > RETRY_MS) {
      void this.refresh()
      return
    }
    this.apply()
  }

  private apply(): void {
    if (!this.state.config.enabled) {
      if (this.state.applied !== undefined) this.setState({ applied: undefined })
      return
    }
    const period = periodAt(this.now(), this.state.config)
    if (this.state.applied === period) return
    const theme = this.themeOf()
    if (theme === undefined) return
    try {
      theme.setTheme(period)
    } catch (error) {
      console.error('[dsh-mcviseron-plugin] failed to apply the scheduled theme:', error)
      return
    }
    this.setState({ applied: period })
  }

  private setState(patch: Partial<DriverState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
}
