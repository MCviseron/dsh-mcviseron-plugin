let live = false
let failure = ''
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

/**
 * Tracks whether the MCviseron settings section registered successfully. The
 * General fallback row is hidden while the section is live, so a profile whose
 * settings shell does not declare `settings.section` still gets a restart entry.
 */
export const sectionPresence = {
  isLive: (): boolean => live,
  failure: (): string => failure,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  markLive: (): void => {
    live = true
    failure = ''
    emit()
  },
  markFailed: (error: unknown): void => {
    live = false
    failure = error instanceof Error ? error.message : String(error)
    emit()
  },
}
