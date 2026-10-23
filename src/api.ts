/** Loopback endpoints shared by the Host bridge and the Appearance row. */
export const MCVISERON_API = {
  describe: '/api/dsh-mcviseron/settings/describe',
  mutate: '/api/dsh-mcviseron/settings/mutate',
} as const

/** Session-end action endpoints used by the composer control. */
export const SESSION_END_API = {
  state: '/api/dsh-mcviseron/session-end/state',
  set: '/api/dsh-mcviseron/session-end/set',
  global: '/api/dsh-mcviseron/session-end/global',
} as const

/** Auth-cookie hygiene shared by the index script and the client fallback. */
export const AUTH_COOKIE_API = {
  prune: '/api/dsh-mcviseron/auth-cookies/prune',
} as const
