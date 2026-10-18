/**
 * Settings namespace of the master plugin. On DSH >= 0.2 a plugin's settings
 * namespace IS its profile-entry id, so this constant must stay in sync with
 * the `id` in `cordis.patch.yml`. Both halves import it so the browser bridge
 * and the Host route can never drift apart.
 */
export const MCVISERON_SETTINGS_NAMESPACE = 'mcviseron'
