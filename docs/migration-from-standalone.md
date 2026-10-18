# 迁移指南：并入总插件

`dsh-mcviseron-plugin` 0.3.0 用一个 npm 包承载三个组件，每个组件是独立的 bundle 条目。原先的 `dsh-auto-review-restart-fix`（0.2.0）与 `dsh-task-guard`（1.0.0）功能已完整并入 `auto-review` 与 `task-guard` 组件；两个旧仓库由维护者废弃，本仓库成为唯一维护入口。

## 0. 组件条目（0.3.0 起）

| 组件 | profile 条目 id | 模块 |
| --- | --- | --- |
| 外观 · 按时间切换 | `mcviseron-appearance` | `dsh-mcviseron-plugin/appearance` |
| Auto review 修复 | `mcviseron-auto-review-fix` | `dsh-mcviseron-plugin/auto-review-fix` |
| Todo 计划守卫 | `mcviseron-task-guard` | `dsh-mcviseron-plugin/task-guard` |

## 1. 从两个独立插件迁移

### 字段映射

Auto review 字段名完全一致：

| 旧字段 | 新位置 | 默认值 |
| --- | --- | --- |
| `keepPresetGuard` | `mcviseron-auto-review-fix` 的 `keepPresetGuard` | `true` |
| `translateApprovalReason` | 同名字段 | `true` |
| `translateTimeoutMs` | 同名字段 | `6000` |
| `translateMaxChars` | 同名字段 | `4000` |
| `translateProvider` | 同名字段 | `''` |
| `translateModel` | 同名字段 | `''` |

Todo 守卫字段名也完全一致（`enabled`、`locale`、`staleAfterCalls`、`repeatEveryCalls`、`blockAfterCalls`、`rejectMissingActive`、`sourceKind`、`include`、`exclude`、`maxListItems`），放到 `mcviseron-task-guard` 条目下。`exclude` 的默认值保持 `['todo_write', 'ask_user_question']`。

### profile 修改

1. `package.json` 的 `dependencies` / `dsh.profile.bundles` 删除 `dsh-auto-review-restart-fix` 与 `dsh-task-guard`，保留 `dsh-mcviseron-plugin` 与官方 `@deepseek-ai/dsh-experimental-auto-review`。
2. `cordis.patch.yml` 把旧条目删掉，写成三个条目（bundle 会自动插入同样的 id，这里只覆盖配置）：

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

3. 可选清理：删除 `node_modules/dsh-auto-review-restart-fix` 与 `node_modules/dsh-task-guard` 的 junction。

## 1.5 从 0.3.0 升级到 0.4.0

- 条目 `mcviseron-auto-review` 更名为 **`mcviseron-auto-review-fix`**，模块改为 `dsh-mcviseron-plugin/auto-review-fix`；profile 里直接改 id 与 name 即可，配置字段不变。
- `mcviseron-task-guard` 新增三个可选字段：`detectStepIntent`（默认 `true`）、`translateTodoContent`（默认 `true`）、`todoTranslationTimeoutMs`（默认 `3000`）。不写即用默认值。
- 注意：`translateTodoContent` 会把 notice 中的 todo 标题经宿主 `llm` 发出用于翻译；不需要时显式设为 `false`。

## 2. 从 0.2.0 的嵌套配置迁移

0.2.0 只有一个 `mcviseron` 条目，配置嵌套在 `appearance` / `autoReview` / `taskGuard` 下。0.3.0 把它拆成三个条目，字段从分组里提出来：

| 0.2.0 | 0.3.0 |
| --- | --- |
| `mcviseron.appearance.enabled` | `mcviseron-appearance.enabled` |
| `mcviseron.appearance.lightStart` | `mcviseron-appearance.lightStart` |
| `mcviseron.appearance.lightEnd` | `mcviseron-appearance.lightEnd` |
| `mcviseron.autoReview.*` | `mcviseron-auto-review-fix.*`（字段名不变） |
| `mcviseron.taskGuard.*` | `mcviseron-task-guard.*`（字段名不变） |

外观的设置命名空间也从 `mcviseron` 变为 `mcviseron-appearance`；旧条目不再读取，浏览器设置行会读写新命名空间。

## 3. 行为对照

| 行为 | 旧插件 / 0.2.0 | 0.3.0 |
| --- | --- | --- |
| 插件管理器组件数 | 1（全部塞在一个条目） | 3（每个组件一个条目） |
| 关机预设守卫 | 包装 `permissionPresets.set`，fiber 非 ACTIVE 丢弃 | 相同（`mcviseron-auto-review-fix`） |
| 审批译文 | 追加 `【审查理由 · 中文翻译】`，审计文本不变 | 相同（同一份代码与缓存策略） |
| 译文缓存 | 进程内 256 条，按原文 | 相同 |
| todo notice source | `plugin:task-guard`（v4）/ `plugin`+`plugin`（v3） | 相同（source id 仍为 `task-guard`） |
| todo 触发阈值 | 5 次首发、每 4 次重复、每 step 去重 | 相同 |
| 严格模式 | `rejectMissingActive` / `blockAfterCalls` | 相同 |
| 配置位置 | 各自条目 / 单个嵌套条目 | 三个扁平条目 |

## 4. 验证清单

重启 DSH 后：

1. 插件管理器显示 **3 个组件**（外观 / auto-review / task-guard），状态均为运行中，可分别启停。
2. 设置 → 通用 → 外观下仍有「按时间自动切换深浅色」，开关与时段可保存。
3. 触发一次会被 Auto review 拒绝的调用：审批卡片中文末尾出现 `【审查理由 · 中文翻译】`，英文原文不变。
4. 跑一个多阶段任务：缺少 `in_progress` 的 `todo_write` 后出现【todo 同步】notice；停滞阈值后出现第二条。
5. 重启一次 DSH，确认 Auto 会话没有被写成完全访问（关机守卫）。

## 5. 回滚

迁移脚本会先备份 profile 的 `package.json` 与 `cordis.patch.yml`（`.bak-mcviseron-*`）。回滚时恢复这两个文件、把两个旧包加回 bundles/dependencies，并重新创建 junction。
