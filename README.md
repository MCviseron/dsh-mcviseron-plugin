# dsh-mcviseron-plugin

[English](README.en.md) | 中文

MCviseron 的 **DeepSeek Harness（DSH）总插件**：一个 npm 包、一个 `mcviseron` profile 条目挂载六个组件。DSH 的 `client-modules` 只给 Loader 行名称精确等于包名的条目组合浏览器半区，因此 master 条目名必须是 `dsh-mcviseron-plugin`；组件作为子插件运行，设置页提供各自子页。原 `dsh-auto-review-restart-fix` 与 `dsh-task-guard` 已并入本插件并逐步废弃。

## 组件

| 组件 | 挂载位置 | 作用 |
| --- | --- | --- |
| **外观 · 按时间自动切换深浅色** | `mcviseron` 顶层字段 | 「设置 → 通用 → 外观」新增选项，按本机时间切换浅/深色 |
| **Auto review 修复** | `mcviseron.autoReviewFix` | 关机不再把 Auto 会话写成完全访问；人审提示追加中文译文 |
| **Todo 计划守卫** | `mcviseron.taskGuard` | 多阶段任务忘记更新 todo 时发出 notice（可选硬拦截） |
| **重启 DeepSeek Harness** | `mcviseron.restart` | 「设置 → MCviseron 插件」里的重启按钮：关闭并重新启动桌面应用 |
| **会话后动作** | `mcviseron.sessionEnd` | 输入框左侧「会话后重启」下拉；AI 工具可设置；重启等待任务结束 |
| **认证 cookie 清理** | 内置 | 每次页面加载过期旧 `dsh-auth-*`，只保留当前，避免重启把请求头推到 16KB |

> 0.6.1 起回到**单一** `mcviseron` 条目：DSH `client-modules` 只给精确包名条目组合浏览器半区，子路径条目会让整个客户端插件（外观行、设置分区、重启回退）消失。组件仍在内部作为子插件运行，设置页有 Auto review / Todo 子页。

### 1. 外观 · 按时间自动切换深浅色

- 默认 **08:00（含）– 23:00（不含）浅色**，其余时间深色。
- 时段可自定义（`HH:MM`），`start > end` 表示跨午夜窗口（如 `22:00 – 06:00`），`start === end` 表示全天浅色。
- 使用本机时间，自动适配时区与夏令时；标签页休眠、系统时间跳变后 20 秒内重新校准。
- 只在启用、修改时段、以及每个边界时刻应用；中途手动切换配色会保留到下一个边界。
- 设置行实时显示「当前时段」与「下次切换」。

### 2. Auto review 修复

1. **关机预设守卫**：Auto review 在卸载时会调用 `permissionPresets.set` 把仍处于 Auto 的会话改成 `danger-full-access`。整套宿主退出时这是错误落盘；组件在根 Cordis fiber 不是 `ACTIVE` 时丢弃该写入（运行中移除插件仍然照常迁移）。
2. **审批理由中文译文**：自动审查拒绝并转人工审批时，`displayReason` 里的英文审查理由原样保留，只在本地化文本末尾追加 `【审查理由 · 中文翻译】` 段落；同时把同一段译文追加到 `reason` 末尾（审计原文保持开头不变），让只读取 `approval/asked` 的邮箱兜底也能收到译文。
3. **reviewer 上下文裁剪**：长会话不再把整段历史塞进 Auto review 模型；只包装 reviewer 的 `llm.stream`，保留当前动作、工程约束和全部人类指令，旧工具调用/图片/超长参数压缩，默认历史上限 120k 字符。详见 [docs/auto-review-context.md](docs/auto-review-context.md)。
4. **转手动被拒理由回传**：当 `approval.request` 返回 `rejected` 且该审批来自 Auto review 时，组件把自动审查理由（含译文）作为 `plugin:auto-review-fix` notice 附到该工具结果的 `additionalContexts`；AI 下一次就能看到「为什么被拒」，而不是只看到 `the user rejected tool ...`。注意：DSH 审批面板目前没有人类理由输入框，回传的是自动审查理由。

翻译使用当前会话的 provider/model 再发一次短请求（可选固定 provider/model），按原文缓存（进程内，上限 256），超时 6 秒可配。**任何失败都原样放行审批**：没有 `llm`、没有会话路由、宿主没有 `displayReason`、超时、模型报错——都不会阻塞审批，也不会改写审查文本。

只有审查理由**本身以中文为主**时才跳过翻译；英文理由里夹带的中文引用（例如用户原话「这个提示框似乎卡住了？」）或 Windows 中文路径（`D:\文档\...`）不会再被误判成中文而漏翻。

### 3. Todo 计划守卫

- `todo_write` 后如果还有 `pending`、却没有 `in_progress`：附一条**建议性 notice**（默认不把写入变成错误）。
- 连续 N 次成功工具调用没更新 todo：再附一条停滞 notice（默认 5 次后首发，之后每 4 次重复）；如果只有一个进行中任务，notice 里直接给出「当前完成、下一阶段 in_progress」的 `todo_write` payload，不再写「请忽略本提醒」。
- 都通过官方 `tools/post-execute` 的 `additionalContexts` 送达，不注册 system prompt 段落，不注入用户提示词。
- 可选严格模式：`rejectMissingActive: true` 拒绝缺少 active 的写入；`blockAfterCalls: N` 在停滞过久时硬拦截下一次工具调用。
- **步骤意图 + 阶段完成检测**（`detectStepIntent`）：监听官方 `agent/assistant-stream`，识别「Now I will …」「接下来…」「Now building the PCB」等步骤意图，以及「All 46 nets routed」「DRC passes clean」「原理图完成」等阶段完成语句。意图按中英文阶段关键词（schematic/原理图、routing/布线、DRC/校验 等）匹配 `pending` todo；完成语句匹配当前 `in_progress` todo。命中时附一条**定向 notice**（每条消息最多一次），带可直接发送的 `todo_write` JSON；不匹配、没有流、解析失败都静默跳过，**绝不阻塞任务**。
- **中文 todo 展示**（`translateTodoContent`）：notice 里的英文 todo 标题会经 `llm` 批量翻译成「中文（English）」显示，按标题缓存、超时 3 秒可配；翻译失败就显示原文。notice 里还会提示「todo 内容可以直接用中文书写」。**只影响 notice 展示，不改写模型写入的 todo 列表**。
- notice 的 source kind 按会话格式自动选择：v4 用 `plugin:task-guard`，v3 用 `plugin` + `plugin: 'task-guard'`。

### 4. 重启 DeepSeek Harness

- 在「设置 → MCviseron 插件 → 重启」子页提供「重启 DeepSeek Harness」按钮，点击后确认并重启桌面应用。
- 重启方式：Host 写一个临时 PowerShell 助手（detached），先关闭 Electron 主进程；Host 在 IPC 断开后按官方流程优雅关闭所有插件与会话；助手等待主进程与 Host 退出后，清除 `ELECTRON_RUN_AS_NODE` 并重新启动应用。
- 会中断正在运行的任务（与托盘「退出」的提示一致），不会修改插件、配置或会话记录。
- 只在桌面版可用；`dsh web` 下状态接口返回不可用，设置行自动隐藏。
- **为什么不做成托盘菜单项**：DSH 的托盘菜单由 Electron 主进程的 `lib/main.js` 直接构建（`DesktopTray`），插件运行在独立的 Host 子进程里，官方没有提供托盘扩展点；因此本组件只能在设置页提供等价入口。

### 5. 会话后动作

- 对话输入框左侧新增 **「会话后重启」** 下拉：不做操作 / 重启 DSH / 关闭 DSH / 关闭电脑；默认不做操作，每次 DSH 启动都从不做操作开始。
- 本轮最终回复完整显示后（默认再等 3 秒）执行一次；如果用户在这段等待内发了新消息，动作保留并在下一条消息结束后重新排队。
- AI 通过工具 `set_session_end_action` 设置 **重启** 或 **关闭 DSH**（不能设置关机）。AI 设置后，输入框出现醒目的非弹窗提示；关机只能由用户在下拉里选择。
- **重启会先做任务探寻**：只要还有运行中的 agent 会话（含等待审批/回答）或后台 job，就持续等待，直到全部结束；关闭 DSH / 关机不等待。**设置页的重启按钮不受此约束**，仍然立即执行。
- 状态只存在 Host 内存里，一次性执行；执行前先清除，重启后的新进程不会继承，不会因为加载插件或重复 turn/end 无限重启。
- **多会话全局排异**：多个会话同时设置动作时，第一个进入执行阶段（非等待）的动作设置进程级 `dispatching` 锁，清空其它会话的计时器和状态；两个会话都设 restart 只执行一次。
- **AI 全局提示**：除当前输入框的强提示外，右上角固定显示「xx 会话已启用 AI 会话自动重启/关闭」；多会话多张卡片，可关闭，动作执行/取消后消失。用户手动设置不显示此全局 AI 提示。
- **邮件联动**：如果已安装并配置了可发送的 `dsh-email-notify`，AI 开启动作时会复用它的 SMTP 配置发送提醒邮件；不修改邮件插件。可在「设置 → MCviseron 插件 → 会话后动作」关闭或改模板。详见 [docs/session-end.md](docs/session-end.md)。

### 6. DSH 认证 cookie 清理

- DSH 每次启动换随机端口，但 Chromium 的 cookie 只按 host 保存；旧的 `dsh-auth-<hash(host:port)>` 不会覆盖，30 天后会累积到 16 KB 请求头上限并触发 431。
- 插件新增 Host 路由 `POST /api/dsh-mcviseron/auth-cookies/prune`：按当前 Host 复算当前 cookie，只过期其他 `dsh-auth-*`，保留当前登录态。
- 每次 index 页面加载由 head 脚本自动调用，客户端入口再兜底一次；不需要限制重启，也不修改 `app.asar`，DSH 升级不会丢。
- 不读取/记录 cookie 值；只接受 loopback 同源 POST；Host 非法或当前 cookie 算不出来时不下发过期头。
- 如果已经累积到启动即 431，需要先一次性清理 cookie 数据库；插件在认证前无法运行。详见 [docs/auth-cookie.md](docs/auth-cookie.md)。

## 设置页

设置里新增一个一级分区 **「MCviseron 插件」**（`settings.section`，id `mcviseron`），组件按需在这里拥有子页：

- **重启**：重启 DeepSeek Harness（本组件的设置面）。
- **会话后动作**：启用开关、显示等待、AI 邮件提醒、邮件主题/正文模板。
- **组件**：列出六个组件及其配置位置。

外观组件**不在**这里——它的设置行仍留在「通用 → 外观」，位置不变。没有设置面的组件不占用子页；`autoReview` / `taskGuard` 继续通过 profile 配置，组件子页会注明这一点。

## 安装

### 方式一：作为 bundle 装入 profile（推荐）

在目标 profile 目录（例如 `~/.dsh/profiles/desktop`）：

```bash
pnpm add link:D:/Program/DSH-Plugin-Class/dsh-mcviseron-plugin
```

把 `dsh-mcviseron-plugin` 加入 `package.json` 的 `dsh.profile.bundles`，并**从 bundles / dependencies 中移除** `dsh-auto-review-restart-fix` 与 `dsh-task-guard`。重启 DSH 后，本包的 `cordis.patch.yml` 会插入一个 `mcviseron` master 条目。

### 方式二：发布后从 npm 安装

```bash
pnpm add dsh-mcviseron-plugin
```

> **注意**：DSH 0.2 起，插件的设置命名空间等于 profile 条目 id。本插件使用 `mcviseron`，请保留这个条目 id，否则外观设置行会显示「无法读取插件设置」。

## 配置

单一 master 条目配置（bundle 自带默认值，profile 的 `cordis.patch.yml` 只需覆盖要改的字段）：

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
    sessionEnd:
      enabled: true
      graceMs: 3000
      notifyEmailOnAi: true
      emailSubject: "[DSH 会话后动作] {{actionText}}"
      emailBody: |-
        AI 已请求在本轮会话结束后{{actionText}}。

        会话：{{sessionName}}
        会话 ID：{{sessionId}}
        时间：{{time}}
        理由：{{reason}}
```

### 外观（Config 顶层字段）

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | 是否按时间自动切换；默认不接管配色 |
| `lightStart` | `HH:MM` | `08:00` | 早间开始（含） |
| `lightEnd` | `HH:MM` | `23:00` | 早间结束（不含） |

### `autoReviewFix`

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `keepPresetGuard` | boolean | `true` | 关机时丢弃 Auto → 完全访问的预设写入 |
| `translateApprovalReason` | boolean | `true` | 人审提示追加中文译文 |
| `translateTimeoutMs` | number | `6000` | 单次翻译超时，500–60000 |
| `translateMaxChars` | number | `4000` | 超过该长度的理由不翻译，100–20000 |
| `translateProvider` | string | `''` | 固定翻译 provider；空 = 跟随会话 |
| `translateModel` | string | `''` | 固定翻译 model；空 = 跟随会话 |

### `taskGuard`

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

### `restart`

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 是否注册设置页重启按钮与接口 |
| `appPath` | string | `''` | 显式指定应用 exe；空 = 从 Host 进程推导 |

### `sessionEnd`

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 是否显示输入框下拉并允许 AI 设置 |
| `graceMs` | number | `3000` | turn/end 后等待最终文字渲染的时间，0–15000 |
| `notifyEmailOnAi` | boolean | `true` | AI 开启动作时发送邮件；需要已配置的 `dsh-email-notify` |
| `emailSubject` | string | `[DSH 会话后动作] {{actionText}}` | 邮件主题模板 |
| `emailBody` | string | 见上方 YAML | 邮件正文模板，支持 `{{actionText}}` / `{{sessionName}}` / `{{sessionId}}` / `{{time}}` / `{{reason}}` |

## 工作原理

### 单一 master 条目

`cordis.patch.yml` 只插入一条 loader 条目：

```yaml
- insert:
    - id: mcviseron
      name: dsh-mcviseron-plugin
```

包根导出 `.` → `lib/index.js`。`src/index.ts` 的 `apply()` 用 `ctx.plugin` 依次挂载五个子组件，每个子组件保留自己的 `inject`、`Config` 与实现；设置页由 `src/client/` 注册。

### 组件装配

- `src/index.ts`：master 条目，挂载 appearance / auto-review-fix / task-guard / restart / session-end。
- `src/appearance/index.ts`：只有 Host 设置桥（`ctx.settings.configure({ auto: false })` + 两条 loopback 路由）；浏览器半边在 `src/client/`，读取 `mcviseron` 命名空间并驱动 `ctx.theme.setTheme`。
- `src/auto-review-fix/index.ts`：`installAutoReview`，通过 `ctx.inject(['permissionPresets' | 'approval'])` 特性探测并包装服务。
- `src/task-guard/index.ts`：`installTaskGuard`，注册 `tools/pre-execute`、`tools/post-execute`、`agent/pre-step`、`session/event`。
- master 与五个子组件都会先 `toPlain()` 展开 DSH 0.2 的 volatile 配置引用，再交给实现。

### 设置桥

DSH 0.2 的官方设置 apiproxy 不向浏览器暴露第三方命名空间，因此外观组件注册两条 loopback 接口：

- `POST /api/dsh-mcviseron/settings/describe`
- `POST /api/dsh-mcviseron/settings/mutate`

只接受命名空间 `mcviseron`；顶层接受 `enabled` / `lightStart` / `lightEnd`，并允许 `autoReviewFix.*` / `taskGuard.*` / `restart.*` / `sessionEnd.*` 嵌套路径（类型与范围会校验）。所有请求执行 loopback 地址 + Host 头 + 同源校验。

### 时间语义（appearance）

早间窗口是 `[lightStart, lightEnd)`：`start < end` 普通当日窗口；`start > end` 跨午夜；`start === end` 全天浅色。

## 兼容性

| DSH 版本 | 状态 |
| --- | --- |
| `0.2.1-rc.3` | ✅ 预适配（rc.3 类型/依赖 + 112 项测试；桌面 nightly 待升级运行时验证） |
| `0.2.1-rc.2` | ✅ 当前桌面运行版本（112 项测试 + 真实 Cordis 上下文） |
| `0.2.0-rc.x` | ✅ peer 范围覆盖（同一套设置、审批与 hook 接缝） |
| `0.1.x` | ❌ 不支持：0.1 的插件自行注册设置命名空间，与本插件的条目 id 命名空间模型不同 |

组件本身对接缝做特性探测：Auto review 的 `displayReason` / `permissionPresets`、task-guard 的 v3/v4 source 都已覆盖；但总插件的设置命名空间与设置桥以 0.2 为准。

## 从两个独立插件迁移

见 [docs/migration-from-standalone.md](docs/migration-from-standalone.md)：字段映射、profile 修改（单一条目）、验证清单。旧仓库 `dsh-auto-review-restart-fix` 与 `dsh-task-guard` 由维护者废弃，功能全部在本插件内继续维护。

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
  namespace.ts                  master 条目的设置命名空间
  schedule.ts                   纯时间规则（可单测）
  volatile.ts                   展开 DSH volatile 配置引用
  loopback.ts                   loopback 信任栅栏
  routes.ts                     settings describe/mutate 桥（含嵌套组件路径）
  index.ts                      master 条目：Config + 挂载五个子组件
  appearance/index.ts           外观子组件：设置桥
  auto-review-fix/index.ts      Auto review 子组件：Config + 装配
  task-guard/index.ts           Todo 守卫子组件：Config + 装配
  restart/index.ts              重启子组件：Config + 重启接口
  components/
    auto-review/index.ts        关机预设守卫 + 审批译文
    auto-review/translate.ts    展示翻译（取词、缓存、超时、清洗）
    task-guard/index.ts         todo 计划守卫
  client/
    index.ts                    浏览器入口（locale + 设置行 + 驱动）
    AppearanceScheduleRow.tsx   外观设置行
    SettingsSection.tsx         MCviseron 插件设置分区（重启/Auto review/Todo/组件）
    ConfigForm.tsx              组件配置表单（官方 Switch + 嵌套路径）
    RestartCard.tsx             重启卡片
    FallbackRestartRow.tsx      设置分区不可用时的通用回退
    driver.ts                   按时切换主题的驱动
    bridge.ts                   设置读写桥客户端
    locales.ts                  中英文案
    styles.ts                   行内样式（读取 --dsw-* token）
test/
  schedule.test.ts              时间规则
  routes.test.ts                设置桥与信任栅栏
  config.test.ts                master 与子组件的 Config
  auto-review-fix.test.ts       Auto review 修复行为
  auto-review-fix-cordis.test.ts 真实 Cordis 上下文
  task-guard.test.ts            Todo 守卫行为
  task-guard-cordis.test.ts     真实 Cordis 上下文
  restart.test.ts               重启目标/任务/路由
  plugin.test.ts                master 装配集成测试
```

## 开发

```bash
pnpm install
pnpm check     # typecheck + 112 项测试 + 构建
```

构建产物：`lib/index.js`（master ESM）、`lib/appearance.js`、`lib/auto-review-fix.js`、`lib/task-guard.js`、`lib/restart.js` 与 `lib/client.js`（浏览器模块）。`lib/` 不入库。

## 故障排查

### 在 profile 里运行 `pnpm install` 后，所有本地插件显示「异常 / 包不可用」

原因：profile 的 `link:D:/...` 依赖跨盘符，pnpm 在 Windows 上可能把符号链接写成坏路径（`<profile>\D:\...`）。DSH 解析不到这些包，插件管理器还会把它们从 `dsh.profile.bundles` 中移除。

修复：

```bash
node scripts/repair-profile.mjs             # 默认修 ~/.dsh/profiles/desktop
node scripts/repair-profile.mjs <profile>   # 其他 profile
```

脚本会把每个 `link:` 依赖重建为绝对 junction，并把缺失的条目补回 `dsh.profile.bundles`，然后重启 DSH 即可。

预防：本地插件尽量用 DSH 插件管理器安装/更新；如果确实要在 profile 里手动 `pnpm install`，安装后执行一次 `pnpm repair-profile` 再重启。

## 许可

[Apache-2.0](LICENSE)
