# dsh-mcviseron-plugin

English | [中文](README.md)

MCviseron's **master plugin for DeepSeek Harness (DSH)**: one plugin row hosts every MCviseron DSH component behind a single settings namespace, lifecycle, and release process.

Components shipped today:

- **Appearance · light/dark by time** — adds an option below DSH's built-in Appearance row that switches the palette from the local wall clock.

## Features

- Default: **08:00 (inclusive) – 23:00 (exclusive) is morning and uses light**; **23:00 – 08:00 uses dark**.
- The morning window is customizable (`HH:MM`); `start > end` is treated as a window that wraps midnight (`22:00 – 06:00`).
- Local wall clock, time zones and daylight saving included; re-calibrates within 20 s after a sleeping tab or a clock jump.
- The toggle and the window persist through DSH settings (the profile config layer) and survive browser sessions.
- It does not fight manual choices: the theme is applied when enabled, after the window changes, and at each boundary; a manual pick in between stays until the next boundary.
- The row shows the current period and the next switch.

## Install

### As a profile bundle (recommended)

From the target profile directory (e.g. `~/.dsh/profiles/desktop`):

```bash
pnpm add link:D:/Program/DSH-Plugin-Class/dsh-mcviseron-plugin
```

Add `dsh-mcviseron-plugin` to `dsh.profile.bundles` in `package.json`, then restart DSH. The bundled `cordis.patch.yml` inserts the plugin row with the fixed entry id `mcviseron`.

> Since DSH 0.2 a plugin's settings namespace **is** its profile entry id. This plugin uses `mcviseron`, so keep that id when installing.

## Configuration

```yaml
- id: mcviseron
  name: dsh-mcviseron-plugin
  config:
    enabled: true
    lightStart: '08:00'
    lightEnd: '23:00'
```

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | Whether the schedule drives the theme |
| `lightStart` | `HH:MM` | `08:00` | Morning start (inclusive) |
| `lightEnd` | `HH:MM` | `23:00` | Morning end (exclusive) |

All times are local. `lightStart === lightEnd` means light all day.

## How it works

- **Host half**: exports `Config` (three `.volatile()` fields) so the profile entry is the settings namespace, disables the auto-generated settings page, and registers two loopback routes (`/api/dsh-mcviseron/settings/describe|mutate`) because DSH 0.2's settings apiproxy does not expose third-party namespaces to the browser.
- **Browser half**: registers one row in `settings.general.item` right after the official Appearance and font rows; a `ScheduleDriver` reads the wall clock every 20 s and calls `ctx.theme.setTheme('light' | 'dark')` when the computed period changes, plus once on `visibilitychange` / `focus`.
- Theme state stays owned by the official `ui-theme` plugin; this plugin only schedules calls into it.

## Compatibility

| DSH version | Status |
| --- | --- |
| `0.2.1-rc.2` | ✅ verified in this release (desktop profile) |
| `0.2.0-rc.x` | ✅ covered by the peer range |
| `0.1.x` | ❌ unsupported (different settings-namespace model) |

## Development

```bash
pnpm install
pnpm check
```

## License

[Apache-2.0](LICENSE)
