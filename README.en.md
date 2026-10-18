# dsh-mcviseron-plugin

English | [中文](README.md)

MCviseron's **master plugin for DeepSeek Harness (DSH)**: one npm package hosting multiple components. Every component is its own bundle entry (own profile entry, own Config, own settings namespace), so the DSH plugin inventory lists them separately. The former `dsh-auto-review-restart-fix` and `dsh-task-guard` are merged here and will be deprecated.

## Components

| Component | Profile entry id | Module | What it does |
| --- | --- | --- | --- |
| **Appearance · light/dark by time** | `mcviseron-appearance` | `dsh-mcviseron-plugin/appearance` | Adds a settings row below DSH's Appearance row and switches the palette from the local wall clock |
| **Auto-review hardening** | `mcviseron-auto-review-fix` | `dsh-mcviseron-plugin/auto-review-fix` | Stops the whole-Host shutdown from persisting Full access over an Auto session; appends a Chinese translation to the manual-approval prompt without editing the audited text |
| **Todo plan guard** | `mcviseron-task-guard` | `dsh-mcviseron-plugin/task-guard` | Advisory notices (optional hard stop) when multi-stage work stops updating its todo plan |

> 0.2.0 packed all three components into a single `mcviseron` entry, so the plugin manager showed only one component. Since 0.3.0 they are three entries and can be enabled/configured independently.

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

## Install

```bash
# from the profile directory (e.g. ~/.dsh/profiles/desktop)
pnpm add link:D:/Program/DSH-Plugin-Class/dsh-mcviseron-plugin
```

Add `dsh-mcviseron-plugin` to `dsh.profile.bundles` and remove `dsh-auto-review-restart-fix` / `dsh-task-guard`. Restart DSH; the bundled `cordis.patch.yml` inserts the three component entries.

## Configuration

```yaml
- id: mcviseron-appearance
  name: dsh-mcviseron-plugin/appearance
  config: { enabled: true, lightStart: "08:00", lightEnd: "23:00" }

- id: mcviseron-auto-review-fix
  name: dsh-mcviseron-plugin/auto-review-fix
  config:
    keepPresetGuard: true
    translateApprovalReason: true
    translateTimeoutMs: 6000
    translateMaxChars: 4000
    translateProvider: ""
    translateModel: ""

- id: mcviseron-task-guard
  name: dsh-mcviseron-plugin/task-guard
  config:
    enabled: true
    locale: zh
    staleAfterCalls: 5
    repeatEveryCalls: 4
    blockAfterCalls: 0
    rejectMissingActive: false
    sourceKind: auto
    maxListItems: 6
```

Defaults: appearance off / `08:00–23:00`; auto-review both guards on, 6 s, 4000 chars; task-guard on, `zh`, stale at 5 / repeat 4, no blocking, step-intent detection and todo translation on (3 s), excludes `todo_write` and `ask_user_question`.

## How it works

- `cordis.patch.yml` inserts one loader entry per component, each pointing at a subpath export of this package.
- `src/appearance` owns the Config and the two loopback routes (`/api/dsh-mcviseron/settings/describe|mutate`) the browser row uses; the browser half lives in `src/client/`.
- `src/auto-review-fix` and `src/task-guard` are thin entries around the shared implementations in `src/components/`.
- Entry `apply()` functions unwrap DSH 0.2 volatile config references before handing the config to a component.

## Compatibility

| DSH version | Status |
| --- | --- |
| `0.2.1-rc.2` | ✅ verified (desktop profile; 62 tests + real Cordis contexts) |
| `0.2.0-rc.x` | ✅ covered by the peer range |
| `0.1.x` | ❌ unsupported (different settings-namespace model) |

## Migration

See [docs/migration-from-standalone.md](docs/migration-from-standalone.md). The old repositories are deprecated by the maintainer; all functionality continues here.

## Development

```bash
pnpm install
pnpm check
```

## License

[Apache-2.0](LICENSE)
