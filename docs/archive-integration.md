# Optional archive-time integration

The MCviseron settings section includes an **Archive time** tab only when the
third-party `@linxin666/dsh-session-archive` plugin is mounted and enabled.

## Detection

The Host route `/api/dsh-mcviseron/archive-integration/status` scans the Cordis
Loader entries for an enabled entry whose name contains `session-archive`.
The client requests this route when the settings section mounts and renders the
tab plus the Components row only when `available === true`.

No import, package dependency, or static profile entry references the
third-party plugin, so uninstalling or disabling it removes the tab with no
error and no empty settings page.

## Status

When available, the tab reports:

- archived session count from `workspaceRegistry.archivedSessionIds`;
- ledger entries counts;
- historical `observed` (backfilled) vs normal `manual` records;
- unknown archive times;
- ledger path.

Historical unknown times are backfilled only during the first initialization;
archives after initialization are recorded as normal archive times. Auto-delete
remains controlled by the third-party plugin and is off by default.
