# Changelog

本项目的所有重要变更都记录在此文件中，格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 计划中

- 总插件的后续组件（待定）：组件开关面板、统一的语言/入口注册，以及与更多 DSH 外观 token 的联动。
- 将「按时间切换」扩展为多时段表（例如白天的多个浅色窗口）。
- 设置行支持「立即测试」预览按钮。

## [0.1.0] - 2026-10-18

### Added

- **首个组件：外观 · 按时间自动切换深浅色**
  - 在 `settings.general.item` 注册设置行，位置紧跟官方「外观」（order 10）与「字号」（order 11），order 为 12。
  - 默认早间 `08:00`（含）– `23:00`（不含）浅色，其余时间深色。
  - 早间开始/结束时间可自定义（`HH:MM`），支持跨午夜窗口；`start === end` 表示全天浅色。
  - 驱动每 20 秒读取本机时间，在时段变化时调用 `ctx.theme.setTheme`；`visibilitychange` / `focus` 时补一次校准，覆盖休眠唤醒与时钟跳变。
  - 启用、修改时段后立即应用；中途手动切换配色不被抢回，保留到下一个边界。
  - 设置行实时显示当前时段与下次切换时间，并显示保存中/已保存/保存失败状态。
- Host 半边新增 `mcviseron` 设置命名空间（`enabled`、`lightStart`、`lightEnd`，全部 `.volatile()`），并关闭自动生成的设置页。
- 新增两条 loopback 设置桥：`/api/dsh-mcviseron/settings/describe` 与 `/api/dsh-mcviseron/settings/mutate`，带 loopback 地址、Host 头与同源 POST 校验；只接受本命名空间与三个已知字段。
- 中英文案、`test/schedule.test.ts` 时间规则单测、GitHub Actions CI（typecheck + test + build）。
- 总插件骨架：一个 profile 条目（id `mcviseron`）承载后续组件，`src/` 按 Host / client / 共享逻辑分层。

### Compatibility

- 目标 DSH `0.2.1-rc.2`（desktop profile，Web GUI）。peer 范围 `^0.2.0-rc.2 || ^0.2.1-rc.2`。
- 不支持 DSH 0.1.x：0.1 的插件自行注册设置命名空间，与本插件的条目 id 命名空间模型不同。

### Notes

- 主题状态仍由官方 `ui-theme` 插件持有；本插件按计划调用 `setTheme`，不复制或覆盖 `ui-theme` 的持久化逻辑。
- profile 条目 id 必须为 `mcviseron`（设置命名空间 = 条目 id）。
