# dsh-mcviseron-plugin

English | [中文](README.md)

MCviseron's **master plugin for DeepSeek Harness (DSH)**: one plugin row hosts every MCviseron DSH component behind a single settings namespace, lifecycle, and release process. The former `dsh-auto-review-restart-fix` and `dsh-task-guard` are merged here and will be deprecated.

## Components

| Component | What it does | Host/Browser |
| --- | --- | --- |
| **Appearance · light/dark by time** | Adds a settings row below DSH's Appearance row and switches the palette from the local wall clock; the window is editable | Host bridge + browser driver |
| **Auto-review hardening** | Stops the whole-Host shutdown from persisting Full access over an Auto session; appends a Chinese translation to the manual-approval prompt **without editing the audited reviewer text** | Host |
| **Todo plan guard** | Sends an advisory notice when multi-stage work stops updating its todo plan (optional hard stop) | Host |

### 1. Appearance · light/dark by time

- Default: **08:00 (inclusive) – 23:00 (exclusive) is light**, the rest is dark.
- Editable `HH:MM` window; `start > end` wraps midnight (`22:00 – 06:00`), `start === end` means light all day.
- Local wall clock, time zones and daylight saving included; re-calibrates within 20 s after a sleeping tab or a clock jump.
- Applied on enabling, on editing the window, and at each boundary; a manual pick in between stays until the next boundary.
- The row shows the current period and the next switch.

### 2. Auto-review hardening

1. **Shutdown preset guard** — Auto review migrates live Auto sessions to `danger-full-access` in its disposal effect. During a whole-Host shutdown that silently rewrites the stored preset; the component drops `permissionPresets.set` writes while the root Cordis fiber is not `ACTIVE`. Removing the plugin at runtime still migrates normally.
2. **Chinese approval translation** — when a review denies a call, the English reviewer note in `displayReason` stays byte-identical; a `【审查理由 · 中文翻译】` block is appended to the localized value only. `reason` and `displayReason.en` are never touched.

Translation uses the session's provider/model (or a pinned pair), caches per source string (in-process, 256 entries), and times out after 6 s (configurable). **Every failure passes the approval through unchanged**: no `llm`, no session route, no `displayReason`, timeout, provider error — an approval is never blocked and the audited text is never rewritten.

### 3. Todo plan guard

- A `todo_write` that leaves `pending` work with no `in_progress` task gets an advisory notice (never a tool error by default).
- After N successful tool calls without a todo update, a stale-plan notice follows (default: first at 5, then every 4).
- Delivered through the official `tools/post-execute` `additionalContexts`; no system-prompt section and no user-prompt injection.
- Optional strict modes: `rejectMissingActive: true` rejects such writes; `blockAfterCalls: N` blocks the next call after a stale plan.
- Source kind follows the session format: v4 uses `plugin:task-guard`, v3 uses `plugin` + `plugin: 'task-guard'`.

## Install

As a profile bundle (recommended), from the profile directory:

```bash
pnpm add link:D:/Program/DSH-Plugin-Class/dsh-mcviseron-plugin
```

Add `dsh-mcviseron-plugin` to `dsh.profile.bundles` and **remove** `dsh-auto-review-restart-fix` and `dsh-task-guard` from bundles/dependencies. Restart DSH; the bundled `cordis.patch.yml` inserts the plugin row with the fixed entry id `mcviseron`.

## Configuration

```yaml
- id: mcviseron
  name: dsh-mcviseron-plugin
  config:
    appearance: { enabled: true, lightStart: "08:00", lightEnd: "23:00" }
    autoReview:
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
```

Defaults: appearance off, `08:00–23:00`; auto-review both guards on, 6 s timeout, 4000 chars; task-guard on, `zh`, stale at 5 / repeat 4, no blocking, excludes `todo_write` and `ask_user_question`.

## How it works

- `apply()` splits the config into `appearance` / `autoReview` / `taskGuard` (recursively unwrapping DSH 0.2 volatile references) and installs each component.
- The Auto-review component feature-detects `permissionPresets` and `approval` through `ctx.inject`; missing services are a no-op.
- The task-guard component registers `tools/pre-execute`, `tools/post-execute`, `agent/pre-step`, and `session/event`.
- The browser half reads only the `appearance` group through two loopback routes (`/api/dsh-mcviseron/settings/describe|mutate`), because DSH 0.2's settings apiproxy does not expose third-party namespaces.

## Compatibility

| DSH version | Status |
| --- | --- |
| `0.2.1-rc.2` | ✅ verified (desktop profile; 60 tests + real Cordis contexts) |
| `0.2.0-rc.x` | ✅ covered by the peer range |
| `0.1.x` | ❌ unsupported (different settings-namespace model) |

## Migration

See [docs/migration-from-standalone.md](docs/migration-from-standalone.md) for the field mapping and profile changes. The old repositories are deprecated by the maintainer; all functionality continues here.

## Development

```bash
pnpm install
pnpm check
```

## License

[Apache-2.0](LICENSE)
