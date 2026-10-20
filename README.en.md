# dsh-mcviseron-plugin

English | [中文](README.md)

MCviseron's **master plugin for DeepSeek Harness (DSH)**: one npm package and one `mcviseron` profile entry hosting four components. DSH `client-modules` only composes a browser half for a Loader row whose name exactly equals the package name, so the master entry must be `dsh-mcviseron-plugin`; components run as sub-plugins and own settings sub-pages. The former `dsh-auto-review-restart-fix` and `dsh-task-guard` are merged here and will be deprecated.

## Components

| Component | Mounted at | What it does |
| --- | --- | --- |
| **Appearance · light/dark by time** | `mcviseron` top-level fields | Adds a settings row below DSH's Appearance row and switches the palette from the local wall clock |
| **Auto-review hardening** | `mcviseron.autoReviewFix` | Stops the whole-Host shutdown from persisting Full access over an Auto session; appends a Chinese translation to the manual-approval prompt |
| **Todo plan guard** | `mcviseron.taskGuard` | Advisory notices (optional hard stop) when multi-stage work stops updating its todo plan |
| **Restart DeepSeek Harness** | `mcviseron.restart` | Button in Settings → MCviseron plugin that closes and relaunches the desktop application |

> 0.6.1 returns to a **single** `mcviseron` entry: DSH `client-modules` only composes a browser half for an exact package-name Loader row, and subpath rows silently dropped the whole client plugin. Components still run as sub-plugins and expose settings sub-pages.

### 1. Appearance · light/dark by time

- Default: **08:00 (inclusive) – 23:00 (exclusive) is light**, the rest is dark.
- Editable `HH:MM` window; `start > end` wraps midnight, `start === end` means light all day.
- Local wall clock; re-calibrates within 20 s after a sleeping tab or a clock jump.
- Applied on enabling, on editing the window, and at each boundary; a manual pick in between stays until the next boundary.

### 2. Auto-review hardening

- Drops `permissionPresets.set` writes while the root Cordis fiber is not `ACTIVE`, so a whole-Host shutdown no longer migrates Auto sessions to Full access.
- Appends a `【审查理由 · 中文翻译】` block to the localized `displayReason` only; `reason` and `displayReason.en` stay byte-identical.
- Translation uses the session's provider/model (or a pinned pair), caches per source string (256 entries), times out after 6 s, and passes the approval through unchanged on any failure.
- A reviewer note that is already Chinese (or contains any CJK text) is never translated again; the approval prompt stays as-is.

### 3. Todo plan guard

- A `todo_write` that leaves `pending` work with no `in_progress` task gets an advisory notice (never a tool error by default).
- After N successful tool calls without a todo update, a stale-plan notice follows (default 5, then every 4).
- Delivered through the official `tools/post-execute` `additionalContexts`; no system-prompt section, no user-prompt injection.
- Optional strict modes: `rejectMissingActive`, `blockAfterCalls`.
- Source kind follows the session format: v4 uses `plugin:task-guard`, v3 uses `plugin` + `plugin: 'task-guard'`.
- **Step-intent detection** (`detectStepIntent`): watches the official `agent/assistant-stream` text/reasoning deltas for phrases such as "Now I will …" / "接下来我会 …" and matches them against pending todos. A match adds one targeted, advisory notice per step (with a ready-to-send `todo_write` JSON); a miss, a missing stream, or malformed data is silently skipped and never blocks the task.
- **Chinese todo display** (`translateTodoContent`): English todo titles in notices are batch-translated into "中文（English）" through the host `llm` service (cached per title, 3 s default timeout, original text on failure). Display only — the model's stored todo list is never rewritten.

### 4. Restart DeepSeek Harness

- A "Settings → MCviseron plugin → Restart" tab asks for confirmation and restarts the desktop app.
- A detached PowerShell helper closes the Electron main process; the Host performs its normal graceful shutdown when its IPC channel disconnects; the helper waits for both processes, clears `ELECTRON_RUN_AS_NODE`, and starts the application again.
- Running tasks are interrupted (same warning as the tray Quit); plugins, settings, and session records are not modified.
- Desktop-only: under `dsh web` the status route reports unavailable and the row hides.
- **Why not a tray item**: DSH builds its tray menu inside the Electron main process (`DesktopTray` in `lib/main.js`); plugins run in the Host child process and DSH exposes no tray extension point. The Settings row is the supported equivalent.

## Settings page

Settings gains a first-level **MCviseron plugin** section (`settings.section`, id `mcviseron`). Components own a tab there when they have a settings surface:

- **Restart**: restart DeepSeek Harness (this component's settings).
- **Components**: list the four components and their configuration surfaces.

The Appearance component is intentionally **not** here — its row stays under General → Appearance. Auto review and Todo guard have editable sub-pages; the Components tab is an overview.

## Install

```bash
# from the profile directory (e.g. ~/.dsh/profiles/desktop)
pnpm add link:D:/Program/DSH-Plugin-Class/dsh-mcviseron-plugin
```

Add `dsh-mcviseron-plugin` to `dsh.profile.bundles` and remove `dsh-auto-review-restart-fix` / `dsh-task-guard`. Restart DSH; the bundled `cordis.patch.yml` inserts one `mcviseron` master entry.

## Configuration

```yaml
- id: mcviseron
  name: dsh-mcviseron-plugin
  config:
    enabled: true
    lightStart: "08:00"
    lightEnd: "23:00"
    autoReviewFix:
      keepPresetGuard: true
      translateApprovalReason: true
      translateTimeoutMs: 6000
      translateMaxChars: 4000
      translateProvider: ""
      translateModel: ""
    taskGuard:
      enabled: true
      locale: zh
      staleAfterCalls: 5
      repeatEveryCalls: 4
      blockAfterCalls: 0
      rejectMissingActive: false
      sourceKind: auto
      maxListItems: 6
    restart:
      enabled: true
      appPath: ""
```

Defaults: appearance off / `08:00–23:00`; auto-review both guards on, 6 s, 4000 chars; task-guard on, `zh`, stale at 5 / repeat 4, no blocking, step-intent detection and todo translation on (3 s), excludes `todo_write` and `ask_user_question`.

## How it works

- `cordis.patch.yml` inserts one `mcviseron` master entry (`name: dsh-mcviseron-plugin`).
- `src/index.ts` mounts the four components with `ctx.plugin`; each keeps its own `inject` and implementation.
- `src/appearance` owns the two loopback routes (`/api/dsh-mcviseron/settings/describe|mutate`) the browser uses; the browser half lives in `src/client/` and registers the settings section and sub-pages.
- The settings bridge accepts appearance top-level fields and nested `autoReviewFix.*` / `taskGuard.*` / `restart.*` paths.
- The master entry and components unwrap DSH 0.2 volatile config references before use.

## Compatibility

| DSH version | Status |
| --- | --- |
| `0.2.1-rc.2` | ✅ verified (desktop profile; 75 tests + real Cordis contexts) |
| `0.2.0-rc.x` | ✅ covered by the peer range |
| `0.1.x` | ❌ unsupported (different settings-namespace model) |

## Migration

See [docs/migration-from-standalone.md](docs/migration-from-standalone.md). The old repositories are deprecated by the maintainer; all functionality continues here.

## Development

```bash
pnpm install
pnpm check
```

## Troubleshooting

### After running `pnpm install` in the profile, every local plugin shows "unavailable"

Cause: cross-drive `link:D:/...` dependencies are written by pnpm on Windows as broken relative symlinks (`<profile>\D:\...`). DSH cannot resolve them, and the plugin manager may also drop those entries from `dsh.profile.bundles`.

Fix:

```bash
node scripts/repair-profile.mjs             # default: ~/.dsh/profiles/desktop
node scripts/repair-profile.mjs <profile>   # another profile
```

The script recreates every `link:` dependency as an absolute junction and restores the missing `dsh.profile.bundles` entries; restart DSH afterwards.

Prevention: prefer the DSH plugin manager for local plugins. If you must run `pnpm install` in the profile, run `pnpm repair-profile` right after it and restart.

## License

[Apache-2.0](LICENSE)
