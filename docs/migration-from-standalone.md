# 从两个独立插件迁移到总插件

`dsh-mcviseron-plugin` 0.2.0 把 `dsh-auto-review-restart-fix`（0.2.0）与 `dsh-task-guard`（1.0.0）的全部功能并入 `autoReview` 与 `taskGuard` 组件。两个旧仓库由维护者废弃，本仓库成为唯一维护入口。

## 1. 字段映射

### Auto review（`dsh-auto-review-restart-fix` → `autoReview`）

字段名完全一致，直接把原 `auto-review-restart-fix` 条目的 `config` 移到 `mcviseron.autoReview` 下即可。

| 旧字段 | 新路径 | 默认值 |
| --- | --- | --- |
| `keepPresetGuard` | `autoReview.keepPresetGuard` | `true` |
| `translateApprovalReason` | `autoReview.translateApprovalReason` | `true` |
| `translateTimeoutMs` | `autoReview.translateTimeoutMs` | `6000` |
| `translateMaxChars` | `autoReview.translateMaxChars` | `4000` |
| `translateProvider` | `autoReview.translateProvider` | `''` |
| `translateModel` | `autoReview.translateModel` | `''` |

### Todo 守卫（`dsh-task-guard` → `taskGuard`）

字段名完全一致（`enabled`、`locale`、`staleAfterCalls`、`repeatEveryCalls`、`blockAfterCalls`、`rejectMissingActive`、`sourceKind`、`include`、`exclude`、`maxListItems`）。

注意 `exclude` 的 schema 默认值显式写成 `['todo_write', 'ask_user_question']`，与旧插件默认行为一致；`include` 默认 `[]`。

## 2. profile 修改

在 `~/.dsh/profiles/<profile>/`：

1. `package.json` 的 `dependencies` 删除：
   - `dsh-auto-review-restart-fix`
   - `dsh-task-guard`
2. `dsh.profile.bundles` 删除同名的两项；保留 `@deepseek-ai/dsh-experimental-auto-review`（官方 Auto review 本体）。
3. `cordis.patch.yml` 删除（如果存在）`- id: auto-review-restart-fix` 与 `- id: task-guard` 条目，把配置合并进 `mcviseron`：

```yaml
- id: mcviseron
  name: dsh-mcviseron-plugin
  config:
    appearance:
      enabled: true
      lightStart: "08:00"
      lightEnd: "23:00"
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

> 0.1.0 时代 `mcviseron` 顶层的 `enabled` / `lightStart` / `lightEnd` 已改到 `appearance` 分组；本仓库本机 profile 的迁移已完成，旧字段不再读取。

4. 可选清理：删除 `node_modules/dsh-auto-review-restart-fix` 与 `node_modules/dsh-task-guard` 的 junction。它们不会被加载，但留着会混淆。

## 3. 行为对照

| 行为 | 旧插件 | 总插件 |
| --- | --- | --- |
| 关机预设守卫 | 包装 `permissionPresets.set`，fiber 非 ACTIVE 丢弃 | 相同（组件 `autoReview`） |
| 审批译文 | 追加 `【审查理由 · 中文翻译】`，审计文本不变 | 相同（同一份代码与缓存策略） |
| 译文缓存 | 进程内 256 条，按原文 | 相同 |
| todo notice source | `plugin:task-guard`（v4）/ `plugin`+`plugin`（v3） | 相同（source id 仍为 `task-guard`） |
| todo 触发阈值 | 5 次首发、每 4 次重复、每 step 去重 | 相同 |
| 严格模式 | `rejectMissingActive` / `blockAfterCalls` | 相同 |
| 配置位置 | 各自的 profile 条目 | `mcviseron` 的分组 |

## 4. 验证清单

重启 DSH 后：

1. 启动日志无 "unknown config field" / "Config" 校验错误。
2. 设置 → 通用 → 外观下仍有「按时间自动切换深浅色」，开关与时段可保存。
3. 触发一次会被 Auto review 拒绝的调用：审批卡片的中文文本末尾出现 `【审查理由 · 中文翻译】`，英文原文不变。
4. 跑一个多阶段任务：缺少 `in_progress` 的 `todo_write` 后出现【todo 同步】notice；停滞阈值后出现第二条。
5. 重启一次 DSH，确认 Auto 会话没有被写成完全访问（关机守卫）。

## 5. 回滚

迁移脚本会先备份 profile 的 `package.json` 与 `cordis.patch.yml`（`.bak-mcviseron-<时间戳>`）。回滚时恢复这两个文件、把两个旧包加回 bundles/dependencies，并重新创建 junction。
