# Changelog

本项目的所有重要变更都记录在此文件中，格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Fixed

- **Todo 守卫更新不顺畅**：新增**阶段完成检测**，从 agent/assistant-stream 的正文/思考中识别「All 46 nets routed」「DRC passes clean」「原理图完成」等完成语句，并用中英文阶段关键词（schematic/原理图、routing/布线、DRC/校验 等）匹配当前 in_progress todo；命中时附一条带可直接发送 todo_write JSON 的定向 notice（每步最多一次）。
- **停滞提醒更可执行**：不再写「请忽略本提醒」；只有一个进行中任务时，notice 直接给出「当前阶段 completed、下一阶段 in_progress」的 payload，模型只需原样发送。
- **转手动审批被拒理由回传**：auto-review-fix 在 `approval.request` 返回 `rejected` 且属于 Auto review 时，把自动审查理由（含译文）作为 `plugin:auto-review-fix` notice 附到该工具结果的 `additionalContexts`；AI 下一次能看到被拒理由。DSH 审批面板没有人类理由输入，因此回传的是自动审查理由。
- 合计 **82 项测试**。

### 计划中

- 将「按时间切换」扩展为多时段表（例如白天的多个浅色窗口）。
- 设置行支持「立即测试」预览按钮。
- Restart 组件支持 macOS/Linux（当前仅 Windows 桌面版）。
- 把定时巡检任务 prompt 更新为当前单条目架构。

## [0.6.1] - 2026-10-19

### Added

- **单一 master 条目 `mcviseron`**：一个 Loader 行挂载 appearance / auto-review-fix / task-guard / restart 四个子组件；包根导出 `lib/index.js` 负责装配。
- **设置子页**：MCviseron 插件分区新增「Auto review 修复」「Todo 守卫」子页；所有开关使用 DSH 官方 `Switch`（`@deepseek-ai/dsh-client-ui-primitives`）。
- **组件配置桥**：设置桥支持 `autoReviewFix.*` / `taskGuard.*` / `restart.*` 嵌套路径，表单修改后自动写入 master 条目 Config。
- **重启**：Windows 任务计划程序创建一次性任务，任务动作直接启动 `DeepSeek Harness.exe`（不经过终端 / `Start-Process`），Host 随后关闭主进程；仅 Windows 桌面版可用。
- **审批翻译**：auto-review-fix 在翻译成功后把 `【审查理由 · 中文翻译】` 追加到 `reason`，使只读取持久 `approval/asked` 事件的邮箱兜底也能收到翻译；`displayReason` 仍保留译文。

### Fixed

- **客户端半区被丢弃**：DSH `client-modules` 只给 Loader 行名称等于包名的条目组合浏览器半区；原四个子路径条目导致整个客户端插件（外观行、设置分区、重启回退）消失。改成单一 `mcviseron` 条目后恢复。
- **外观行位置**：`settings.general.item` 的 order 改为 `10.5`，紧跟在主题「外观」(10) 之后、字体(11) 之前。
- **重启配置引用**：嵌套 Config 的 volatile 引用在传入重启组件前统一 `toPlain()`，并给 `appPath` 加字符串兜底，修复 `override.trim is not a function`。

### Changed

- `cordis.patch.yml` 只插入一个 `mcviseron` 条目（`name: dsh-mcviseron-plugin`），profile 只配置这一条；组件配置位于其 `autoReviewFix` / `taskGuard` / `restart` 子对象。
- 设置命名空间从 `mcviseron-appearance` 改为 `mcviseron`；外观字段仍在 Config 顶层。
- 版本号 `0.6.0` → `0.6.1`（原本地 0.7.0 未发布，不产生 tag）。
- 合计 **75 项测试**。

### Compatibility

- 目标 DSH `0.2.0-rc.2` / `0.2.1-rc.2`；peer 范围 `^0.2.0-rc.2 || ^0.2.1-rc.2`。
- npm 发布工作流：tag 触发、校验 tag/版本、OIDC Trusted Publishing + provenance；`NPM_PUBLISH_ENABLED` 作为总开关。

### Release

- 包名 `dsh-mcviseron-plugin` 在 npmjs 可用；`publishConfig` 指向官方 registry，`prepublishOnly` 执行 `pnpm check`。
- 新增 `.github/workflows/publish.yml` 与 [docs/release.md](docs/release.md)；首次发布手动完成，之后绑定 Trusted Publisher 并设置 `NPM_PUBLISH_ENABLED=true`。

## [0.6.0] - 2026-10-18

### Added

- **一级设置分区「MCviseron 插件」**（`settings.section`，id `mcviseron`，order 115）：
  - **重启**子页：重启 DeepSeek Harness（按钮 + 可用状态 + 应用路径 + 确认）。
  - **组件**子页：列出 appearance / auto-review-fix / task-guard / restart 及各自配置位置。
- 重启入口从「设置 → 通用」的一行移到本分区；外观组件的设置行**保持原位**，没有移动。
- 重启目标解析新增回退：当 Host 运行在 `node.exe` 下时，依次尝试 `argv[0]`、由运行时目录推导的应用 exe；同时页面会显示不可用原因（接口未加载 / 仅桌面版）。

### Changed

- 客户端不再向 `settings.general.item` 注册重启行，改为注册 `settings.section`；`RestartRow.tsx` 由 `SettingsSection.tsx` 取代。
- 版本号 `0.5.0` → `0.6.0`；合计 **71 项测试**。

## [0.5.0] - 2026-10-18

### Added

- **重启组件 `mcviseron-restart`（`dsh-mcviseron-plugin/restart`）**：
  - 「设置 → 通用」新增「重启 DeepSeek Harness」行，确认后重启桌面应用。
  - Host 两条 loopback 接口：`POST /api/dsh-mcviseron/restart/status` 与 `/restart/execute`（要求 `{ confirm: true }`、5 秒防重、loopback + 同源栅栏）。
  - 重启由 detached PowerShell 助手完成：先关闭 Electron 主进程，Host 在 IPC 断开后按官方流程优雅关闭；助手等待主进程与 Host 退出，清除 `ELECTRON_RUN_AS_NODE`（Host 继承了该变量），再启动应用。
  - 仅桌面版可用；`dsh web` 下状态接口返回不可用，设置行自动隐藏。`appPath` 可显式覆盖应用路径。
  - 会中断正在运行的任务（与托盘「退出」提示一致），不修改插件、配置或会话记录。
- 新增 `test/restart.test.ts`（7 项）与重启 Config 测试。

### Notes

- DSH 的托盘菜单由 Electron 主进程的 `lib/main.js` 直接构建（`DesktopTray`），插件运行在独立的 Host 子进程，官方没有提供托盘扩展点，因此以设置行提供等价重启入口；未修改应用文件。
- 合计 **70 项测试**全部通过。

## [0.4.1] - 2026-10-18

### Fixed

- **profile 里 `pnpm install` 后所有本地插件变成「异常 / 包不可用」**：pnpm 在 Windows 上把跨盘符的 `link:D:/...` 依赖写成坏符号链接（`<profile>\D:\...`），DSH 无法解析；插件管理器还会把这些条目从 `dsh.profile.bundles` 中移除。新增 `scripts/repair-profile.mjs`：把所有 `link:` 依赖重建为绝对 junction，并把缺失条目补回 `dsh.profile.bundles`；脚本幂等，可反复运行。
- README / README.en 增加「故障排查」、CONTRIBUTING 增加 Profile 健康检查；本机 profile 已用该脚本修复并恢复 `dsh-mcviseron-plugin`、`dsh-eda-mcp`、`dsh-email-notify`、`dsh-edit-file-workspace` 四个条目。

### Changed

- `package.json` 增加 `repair-profile` 脚本，`files` 纳入 `scripts/`；版本 `0.4.0` → `0.4.1`。

## [0.4.0] - 2026-10-18

### Added

- **Todo 步骤意图检测**（`detectStepIntent`，默认开启）：监听官方 `agent/assistant-stream` 的 `text-delta` / `reasoning-delta`，识别「Now I will …」「Next I will …」「Let me …」「接下来我会 …」「下一步 …」等句式，并与 `pending` todo 做 token / 子串匹配。命中时在 `tools/post-execute` 追加一条**定向建议 notice**，内含可直接发送的 `todo_write` JSON（把下一阶段设为 `in_progress`、当前阶段设为 `completed`）；每条消息最多一次，解析失败/无流/不匹配一律静默跳过，**绝不拒绝或阻塞任务**。
- **Notice 内中文 todo 展示**（`translateTodoContent`，默认开启）：notice 中的英文 todo 标题通过宿主 `llm` 批量翻译为「中文（English）」；按标题缓存（上限 256）、单次超时 `todoTranslationTimeoutMs`（默认 3000ms），失败回退原文。只影响 notice 展示，**不改写模型写入的 todo 列表**。
- notice 增加「todo 内容可以直接用中文书写」提示，引导模型后续直接写中文 todo。
- 新增 `test/task-guard.test.ts` 用例：中英文意图匹配、每步最多一条意图 notice、todo 标题翻译。

### Fixed

- **Auto review 修复组件对中文审查理由重复翻译**：审查正文已含 CJK 字符时直接跳过翻译，审批卡片保持原样；新增回归测试。
- **Todo 停滞提醒在真实 loop 中的每步重置**：`agent/pre-step` 同时重置 `reminderDeliveredThisStep` 与意图去重标记，并清理当前步骤的意图缓冲，避免一条通知之后整轮不再提醒。

### Changed

- 组件更名，避免与官方自动审查插件重名：
  - 条目 id `mcviseron-auto-review` → **`mcviseron-auto-review-fix`**
  - 模块 `dsh-mcviseron-plugin/auto-review` → **`dsh-mcviseron-plugin/auto-review-fix`**
  - 源码目录 `src/auto-review` → `src/auto-review-fix`，构建产物 `lib/auto-review-fix.js`
- `taskGuard` 新增三个字段：`detectStepIntent`、`translateTodoContent`、`todoTranslationTimeoutMs`（entry Config 与组件校验同步）。
- 本机 profile 已把 `mcviseron-auto-review` 条目改为 `mcviseron-auto-review-fix`，并在 `mcviseron-task-guard` 中显式写出三个新字段。
- 版本号 `0.3.0` → `0.4.0`。

### Compatibility

- 目标 DSH `0.2.1-rc.2`；意图检测依赖的 `agent/assistant-stream` 帧格式在该代际为 `{ type: 'chunk', chunk: { type: 'text-delta' | 'reasoning-delta', text } }`，缺失时特性探测为 no-op。
- 合计 **62 项测试**全部通过。

## [0.3.0] - 2026-10-18

### Fixed

- **插件管理器只显示 1 个组件**：0.2.0 把三个组件放进同一个 `mcviseron` 条目，DSH 插件清单按 loader 条目渲染，因此「包含的组件」只有 1 项。本版把组件拆成三个独立的 bundle 条目，插件管理器与插件清单现在分别列出 appearance / auto-review / task-guard，可单独启停与配置。

### Changed

- `cordis.patch.yml` 改为插入三条目：
  - `mcviseron-appearance` → `dsh-mcviseron-plugin/appearance`
  - `mcviseron-auto-review-fix` → `dsh-mcviseron-plugin/auto-review-fix`
  - `mcviseron-task-guard` → `dsh-mcviseron-plugin/task-guard`
- 包新增三个子路径导出与三个 Host 构建产物：`lib/appearance.js`、`lib/auto-review.js`、`lib/task-guard.js`；删除旧的聚合 `lib/index.js`。
- 配置结构从 0.2.0 的嵌套分组（`appearance` / `autoReview` / `taskGuard`）恢复为**每个条目一份扁平 Config**；外观命名空间从 `mcviseron` 改为 `mcviseron-appearance`，设置桥路径恢复为 `['enabled']` 等扁平字段。
- 每个条目在 `apply()` 前用 `toPlain()` 展开 DSH 0.2 的 volatile 配置引用（否则组件会收到引用对象而不是布尔/数字）。
- 版本号 `0.2.0` → `0.3.0`。

### Migration

- 本机 profile 已把单个 `mcviseron` 条目替换为三条目，配置值原样拆开；旧条目不再读取。
- 0.2.0 嵌套配置到 0.3.0 三条目的对应关系见 [docs/migration-from-standalone.md](docs/migration-from-standalone.md#30-从-020-的嵌套配置迁移)。

### Tests

- `test/config.test.ts` 改为分别校验三个条目的 Config；`test/plugin.test.ts` 改为加载三条目验证组合行为；设置桥测试恢复扁平字段。
- 合计 **62 项测试**全部通过。

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
