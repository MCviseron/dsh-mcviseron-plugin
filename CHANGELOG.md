# Changelog

本项目的所有重要变更都记录在此文件中，格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 计划中

- 总插件的后续组件（待定）：组件开关面板、统一的语言/入口注册，以及与更多 DSH 外观 token 的联动。
- 将「按时间切换」扩展为多时段表（例如白天的多个浅色窗口）。
- 设置行支持「立即测试」预览按钮。
- 为 `autoReview` / `taskGuard` 提供可视化设置页（当前通过 profile 配置维护）。

## [0.2.0] - 2026-10-18

### Added

- **组件化架构**：`src/components/` 下每个组件一个目录，总插件的 profile 条目（id `mcviseron`）一次性装配全部组件；配置改为 `appearance` / `autoReview` / `taskGuard` 三个分组，字段互不冲突。
- **并入 `dsh-auto-review-restart-fix` 0.2.0 的全部功能**（组件 `autoReview`）：
  - 关机预设守卫：根 Cordis fiber 不是 `ACTIVE` 时丢弃 `permissionPresets.set`，整套宿主退出不再把 Auto 会话写成完全访问；包装常驻、与挂载/卸载顺序无关。
  - 审批理由中文译文：只在 `displayReason` 的本地化值末尾追加 `【审查理由 · 中文翻译】`，`reason` 与 `displayReason.en` 一字不改。
  - 会话 provider/model 自动路由或 `translateProvider`/`translateModel` 固定路由；按原文缓存（上限 256）、超时 500–60000ms、失败原样放行。
- **并入 `dsh-task-guard` 1.0.0 的全部功能**（组件 `taskGuard`）：
  - `todo_write` 后还有 pending 但没有 in_progress：建议性 notice（默认不报错）。
  - 连续 N 次工具调用未更新 todo：停滞 notice，支持重复间隔与每 step 去重。
  - 可选 `rejectMissingActive` / `blockAfterCalls` 严格模式。
  - session format v3/v4 source kind 自动选择（`plugin:task-guard` / `plugin`+`plugin`），`include`/`exclude` 通配过滤，`maxListItems` 截断。
- 三组件装配集成测试 `test/plugin.test.ts`（真实 Cordis 上下文 + 假 webServer/settings/approval/permissionPresets/llm）。
- 组件测试移植：`test/auto-review.test.ts`（15）、`test/auto-review-cordis.test.ts`（5）、`test/task-guard.test.ts`（13）、`test/task-guard-cordis.test.ts`（4）、`test/config.test.ts`（6），合计 60 项。

### Changed

- **配置结构迁移**：`enabled` / `lightStart` / `lightEnd` 从顶层移到 `appearance` 分组；`autoReview` 与 `taskGuard` 分组沿用两个独立插件的字段名，可直接搬移。
- 设置桥只暴露 `appearance` 分组，写入路径改为嵌套 `['appearance', field]`；`autoReview` / `taskGuard` 不出现在浏览器接口中。
- `appearance.lightStart` / `lightEnd` 增加 `HH:MM` 模式校验，错误配置在插件加载时被拒绝。
- `Config` 的 `taskGuard.exclude` 显式声明默认值 `todo_write`、`ask_user_question`，避免空数组覆盖组件默认行为。
- 版本号 `0.1.0` → `0.2.0`。

### Compatibility

- 目标 DSH `0.2.1-rc.2`（desktop profile，Web GUI）。peer 范围 `^0.2.0-rc.2 || ^0.2.1-rc.2`。
- 不支持 DSH 0.1.x：0.1 的插件自行注册设置命名空间，与本插件的条目 id 命名空间模型不同。
- 组件内部的接缝均做特性探测：`permissionPresets`、`approval`、`displayReason`、session format v3/v4；缺失时降级为 no-op 或原样放行。

### Migration

- 从 `dsh-auto-review-restart-fix` 与 `dsh-task-guard` 迁移的字段映射、profile 修改和验证清单见 [docs/migration-from-standalone.md](docs/migration-from-standalone.md)。
- 两个旧仓库由维护者废弃；本仓库是唯一维护入口。

### Notes

- 主题状态仍由官方 `ui-theme` 插件持有；本插件按计划调用 `setTheme`，不复制或覆盖 `ui-theme` 的持久化逻辑。
- profile 条目 id 必须为 `mcviseron`（设置命名空间 = 条目 id）。

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
- 新增 DSH 自动化任务「维护 dsh-mcviseron-plugin 对最新 DSH 的兼容性」：每周一 10:00（Asia/Shanghai）检查最新 DSH、升级 peer 范围并修复兼容性 bug；任务 id 与提示词见 [docs/automation-task.md](docs/automation-task.md)。

### Compatibility

- 目标 DSH `0.2.1-rc.2`（desktop profile，Web GUI）。peer 范围 `^0.2.0-rc.2 || ^0.2.1-rc.2`。
- 不支持 DSH 0.1.x：0.1 的插件自行注册设置命名空间，与本插件的条目 id 命名空间模型不同。

### Notes

- 主题状态仍由官方 `ui-theme` 插件持有；本插件按计划调用 `setTheme`，不复制或覆盖 `ui-theme` 的持久化逻辑。
- profile 条目 id 必须为 `mcviseron`（设置命名空间 = 条目 id）。
