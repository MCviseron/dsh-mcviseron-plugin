/**
 * DSH >= 0.2 hands `.volatile()` Config fields to `apply()` as frozen
 * references whose live value is read through `get()` (nested group objects may
 * be references too). Entry modules unwrap them once before handing the config
 * to a component, so component code only ever sees plain values.
 */
type VolatileLike = { get: () => unknown }

function isVolatileLike(value: unknown): value is VolatileLike {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  if (typeof (value as { get?: unknown }).get !== 'function') return false
  // createVolatile() freezes { get, [symbol]: setter }: the symbol is the
  // cross-copy marker, while the string keys are only ever ['get'].
  return Object.getOwnPropertySymbols(value).length > 0
    || Object.keys(value as object).every(key => key === 'get')
}

/**
 * Recursively replace volatile references with their live values.
 * @param value - any config value.
 * @returns the same shape with every reference resolved.
 */
export function toPlain<T>(value: T): T {
  if (isVolatileLike(value)) return toPlain(value.get() as T)
  if (Array.isArray(value)) return value.map(item => toPlain(item)) as T
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) result[key] = toPlain(child)
    return result as T
  }
  return value
}
