# dsh-mcviseron-plugin

[English](README.en.md) | 中文

MCviseron 的 **DeepSeek Harness（DSH）总插件**：一个 npm 包承载多个组件，每个组件是独立的 bundle 条目（独立 profile 条目、独立 Config、独立设置命名空间），因此 DSH 插件清单会分别列出它们。原 `dsh-auto-review-restart-fix` 与 `dsh-task-guard` 已并入本插件并逐步废弃。

## 组件

| 组件 | profile 条目 id | 模块 | 作用 |
| --- | --- | --- | --- |
| **外观 · 按时间自动切换深浅色** | `mcviseron-appearance` | `dsh-mcviseron-plugin/appearance` | 「设置 → 通用 → 外观」新增选项，按本机时间切换浅/深色 |
| **Auto review 修复** | `mcviseron-auto-review-fix` | `dsh-mcviseron-plugin/auto-review-fix` | 关机不再把 Auto 会话写成完全访问；人审提示追加中文译文（不改审查原文） |
| **Todo 计划守卫** | `mcviseron-task-guard` | `dsh-mcviseron-plugin/task-guard` | 多阶段任务忘记更新 todo 时发出 notice（可选硬拦截） |

> 0.2.0 曾把三个组件放在**一个** `mcviseron` 条目里，插件管理器只显示 1 个「组件」。0.3.0 起拆成三个条目，插件管理器/插件清单会显示 3 个组件，各自可单独启停与配置。

### 1. 外观 · 按时间自动切换深浅色

- 默认 **08:00（含）– 23:00（不含）浅色**，其余时间深色。
- 时段可自定义（`HH:MM`），`start > end` 表示跨午夜窗口（如 `22:00 – 06:00`），`start === end` 表示全天浅色。
- 使用本机时间，自动适配时区与夏令时；标签页休眠、系统时间跳变后 20 秒内重新校准。
- 只在启用、修改时段、以及每个边界时刻应用；中途手动切换配色会保留到下一个边界。
- 设置行实时显示「当前时段」与「下次切换」。

### 2. Auto review 修复

1. **关机预设守卫**：Auto review 在卸载时会调用 `permissionPresets.set` 把仍处于 Auto 的会话改成 `danger-full-access`。整套宿主退出时这是错误落盘；组件在根 Cordis fiber 不是 `ACTIVE` 时丢弃该写入（运行中移除插件仍然照常迁移）。
2. **审批理由中文译文**：自动审查拒绝并转人工审批时，`displayReason` 里的英文审查理由原样保留，只在本地化文本末尾追加 `【审查理由 · 中文翻译】` 段落。`reason`（审计字段）与 `displayReason.en` 一字不改。

翻译使用当前会话的 provider/model 再发一次短请求（可选固定 provider/model），按原文缓存（进程内，上限 256），超时 6 秒可配。**任何失败都原样放行审批**：没有 `llm`、没有会话路由、宿主没有 `displayReason`、超时、模型报错——都不会阻塞审批，也不会改写审查文本。

审查理由本身已经是中文（含任意 CJK 字符）时**不会再翻译**，审批卡片保持原样；英文与中文混合、但审查正文已是中文的情况同样跳过。

### 3. Todo 计划守卫

- `todo_write` 后如果还有 `pending`、却没有 `in_progress`：附一条**建议性 notice**（默认不把写入变成错误）。
- 连续 N 次成功工具调用没更新 todo：再附一条停滞 notice（默认 5 次后首发，之后每 4 次重复）。
- 都通过官方 `tools/post-execute` 的 `additionalContexts` 送达，不注册 system prompt 段落，不注入用户提示词。
- 可选严格模式：`rejectMissingActive: true` 拒绝缺少 active 的写入；`blockAfterCalls: N` 在停滞过久时硬拦截下一次工具调用。
- **步骤意图检测**（`detectStepIntent`）：监听官方 `agent/assistant-stream` 的 `text-delta` / `reasoning-delta`，识别「Now I will …」「接下来我会 …」「下一步 …」等句式，并与 `pending` todo 做 token 匹配。命中时附一条**定向 notice**（每条消息最多一次），里面带可直接发送的 `todo_write` JSON；不匹配、没有流、解析失败都静默跳过，**绝不阻塞任务**。
- **中文 todo 展示**（`translateTodoContent`）：notice 里的英文 todo 标题会经 `llm` 批量翻译成「中文（English）」显示，按标题缓存、超时 3 秒可配；翻译失败就显示原文。notice 里还会提示「todo 内容可以直接用中文书写」。**只影响 notice 展示，不改写模型写入的 todo 列表**。
- notice 的 source kind 按会话格式自动选择：v4 用 `plugin:task-guard`，v3 用 `plugin` + `plugin: 'task-guard'`。

## 安装

### 方式一：作为 bundle 装入 profile（推荐）

在目标 profile 目录（例如 `~/.dsh/profiles/desktop`）：

```bash
pnpm add link:D:/Program/DSH-Plugin-Class/dsh-mcviseron-plugin
```

把 `dsh-mcviseron-plugin` 加入 `package.json` 的 `dsh.profile.bundles`，并**从 bundles / dependencies 中移除** `dsh-auto-review-restart-fix` 与 `dsh-task-guard`。重启 DSH 后，本包的 `cordis.patch.yml` 会插入三个组件条目（见上表 id/模块）。

### 方式二：发布后从 npm 安装

```bash
pnpm add dsh-mcviseron-plugin
```

> **注意**：DSH 0.2 起，插件的设置命名空间等于 profile 条目 id。外观组件使用 `mcviseron-appearance`，请保留这些条目 id，否则外观设置行会显示「无法读取插件设置」。

## 配置

三个条目各自配置（bundle 自带默认值，profile 的 `cordis.patch.yml` 只需覆盖要改的字段）：

```yaml
- id: mcviseron-appearance
  name: dsh-mcviseron-plugin/appearance
  config:
    enabled: true
    lightStart: "08:00"
    lightEnd: "23:00"

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

### `mcviseron-appearance`

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | 是否按时间自动切换；默认不接管配色 |
| `lightStart` | `HH:MM` | `08:00` | 早间开始（含） |
| `lightEnd` | `HH:MM` | `23:00` | 早间结束（不含） |

### `mcviseron-auto-review-fix`

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `keepPresetGuard` | boolean | `true` | 关机时丢弃 Auto → 完全访问的预设写入 |
| `translateApprovalReason` | boolean | `true` | 人审提示追加中文译文 |
| `translateTimeoutMs` | number | `6000` | 单次翻译超时，500–60000 |
| `translateMaxChars` | number | `4000` | 超过该长度的理由不翻译，100–20000 |
| `translateProvider` | string | `''` | 固定翻译 provider；空 = 跟随会话 |
| `translateModel` | string | `''` | 固定翻译 model；空 = 跟随会话 |

### `mcviseron-task-guard`

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 总开关 |
| `locale` | `zh` / `en` | `zh` | 模型可见文本语言 |
| `staleAfterCalls` | integer ≥1 | `5` | 多少次非 todo 工具调用后发第一条停滞 notice |
| `repeatEveryCalls` | integer ≥0 | `4` | 之后每隔多少次再提醒；`0` 只提醒一次 |
| `blockAfterCalls` | integer ≥0 | `0` | 超过多少次仍未更新就硬拦截；`0` 关闭，开启时必须大于 `staleAfterCalls` |
| `rejectMissingActive` | boolean | `false` | 拒绝「还有 pending 但没有 in_progress」的 `todo_write` |
| `sourceKind` | `auto`/`v3`/`v4` | `auto` | notice source kind；auto 按会话格式选择 |
| `maxListItems` | integer ≥1 | `6` | notice 最多列出多少个剩余任务 |
| `include` | string[] | `[]` | 只统计这些工具名（支持 `*`）；空 = 全部 |
| `exclude` | string[] | `todo_write`, `ask_user_question` | 不统计的工具名 |
| `detectStepIntent` | boolean | `true` | 从思考/正文里识别「Now I will …」等句式并匹配 pending todo，命中时发一条定向 notice（仅建议） |
| `translateTodoContent` | boolean | `true` | notice 中的英文 todo 标题翻译为「中文（English）」显示 |
| `todoTranslationTimeoutMs` | number | `3000` | 单次批量 todo 翻译超时，500–15000 |

## 工作原理

### 三个 bundle 条目

`cordis.patch.yml` 插入三条 loader 条目，分别指向本包的三个子路径导出：

```yaml
- id: mcviseron-appearance
  name: dsh-mcviseron-plugin/appearance
- id: mcviseron-auto-review-fix
  name: dsh-mcviseron-plugin/auto-review-fix
- id: mcviseron-task-guard
  name: dsh-mcviseron-plugin/task-guard
```

每个条目导出自己的 `Config` 与 `apply()`；组件实现仍共享 `src/components/` 与纯逻辑。DSH 插件清单按 loader 条目逐条渲染，因此三个组件分别可见、可启停、可配置。

### 组件装配

- `src/appearance/index.ts`：只有 Host 设置桥（`ctx.settings.configure({ auto: false })` + 两条 loopback 路由）；浏览器半边在 `src/client/`，读取 `mcviseron-appearance` 命名空间并驱动 `ctx.theme.setTheme`。
- `src/auto-review-fix/index.ts`：`installAutoReview`，通过 `ctx.inject(['permissionPresets' | 'approval'])` 特性探测并包装服务。
- `src/task-guard/index.ts`：`installTaskGuard`，注册 `tools/pre-execute`、`tools/post-execute`、`agent/pre-step`、`session/event`。
- 三个 entry 都会先 `toPlain()` 展开 DSH 0.2 的 volatile 配置引用，再交给组件。

### 设置桥

DSH 0.2 的官方设置 apiproxy 不向浏览器暴露第三方命名空间，因此外观组件注册两条 loopback 接口：

- `POST /api/dsh-mcviseron/settings/describe`
- `POST /api/dsh-mcviseron/settings/mutate`

只接受命名空间 `mcviseron-appearance` 与 `enabled` / `lightStart` / `lightEnd` 三个字段，并执行 loopback 地址 + Host 头 + 同源校验。另外两个组件的 Config 只通过 profile 配置维护（其设置页由 DSH 自动生成的 Config 表单提供）。

### 时间语义（appearance）

早间窗口是 `[lightStart, lightEnd)`：`start < end` 普通当日窗口；`start > end` 跨午夜；`start === end` 全天浅色。

## 兼容性

| DSH 版本 | 状态 |
| --- | --- |
| `0.2.1-rc.2` | ✅ 本版本验证（desktop profile；62 项测试 + 真实 Cordis 上下文） |
| `0.2.0-rc.x` | ✅ peer 范围覆盖（同一套设置、审批与 hook 接缝） |
| `0.1.x` | ❌ 不支持：0.1 的插件自行注册设置命名空间，与本插件的条目 id 命名空间模型不同 |

组件本身对接缝做特性探测：Auto review 的 `displayReason` / `permissionPresets`、task-guard 的 v3/v4 source 都已覆盖；但总插件的设置命名空间与设置桥以 0.2 为准。

## 从两个独立插件迁移

见 [docs/migration-from-standalone.md](docs/migration-from-standalone.md)：字段映射、profile 修改（三条目）、验证清单。旧仓库 `dsh-auto-review-restart-fix` 与 `dsh-task-guard` 由维护者废弃，功能全部在本插件内继续维护。

## 自动化任务

仓库通过 DSH「自动化任务」定期检查最新 DSH 版本并修复兼容性问题：

- 每周一 10:00（`Asia/Shanghai`）检查 npm 上最新 `@deepseek-ai/dsh`，升级 peer 范围、修复接口变更导致的 bug，并更新 CHANGELOG / README 的兼容性表。
- 任务 id `schedule-f3ea5b03-26e2-4192-95d7-d3d4b61ef751`，首次运行 2026-10-19 10:00。
- 提示词、重建步骤与存储说明见 [docs/automation-task.md](docs/automation-task.md)。

> 任务记录写入 `~/.dsh/storages/schedule.json`，重启 DSH 后由 Host 加载并计时；若在重启前于自动化任务页面改动其他任务，运行中的 Host 可能重写该文档，重新写入即可。

## 目录结构

```
src/
  api.ts                        浏览器/Host 共用的 loopback 路径
  namespace.ts                  外观条目的设置命名空间
  schedule.ts                   纯时间规则（可单测）
  volatile.ts                   展开 DSH volatile 配置引用
  loopback.ts                   loopback 信任栅栏
  routes.ts                     settings describe/mutate 桥
  appearance/index.ts           外观条目：Config + 设置桥
  auto-review/index.ts          Auto review 条目：Config + 装配
  task-guard/index.ts           Todo 守卫条目：Config + 装配
  components/
    auto-review/index.ts        关机预设守卫 + 审批译文
    auto-review/translate.ts    展示翻译（取词、缓存、超时、清洗）
    task-guard/index.ts         todo 计划守卫
  client/
    index.ts                    浏览器入口（locale + 设置行 + 驱动）
    AppearanceScheduleRow.tsx   外观设置行
    driver.ts                   按时切换主题的驱动
    bridge.ts                   设置读写桥客户端
    locales.ts                  中英文案
    styles.ts                   行内样式（读取 --dsw-* token）
test/
  schedule.test.ts              时间规则
  routes.test.ts                设置桥与信任栅栏
  config.test.ts                三个条目的 Config
  auto-review.test.ts           Auto review 组件行为
  auto-review-cordis.test.ts    真实 Cordis 上下文
  task-guard.test.ts            Todo 守卫行为
  task-guard-cordis.test.ts     真实 Cordis 上下文
  plugin.test.ts                三条目装配集成测试
```

## 开发

```bash
pnpm install
pnpm check     # typecheck + 62 项测试 + 构建
```

构建产物：`lib/appearance.js`、`lib/auto-review.js`、`lib/task-guard.js`（Host ESM）与 `lib/client.js`（浏览器模块）。`lib/` 不入库。

## 许可

[Apache-2.0](LICENSE)
