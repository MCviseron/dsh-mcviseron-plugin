# Auto review 上下文裁剪

## 问题

DSH 的 `dsh-experimental-auto-review` 在每次工具调用前，把当前 Session 的
`session.surface.nodes` 全量转成 `FILTERED_HISTORY`，再连同
`PROJECT_INSTRUCTIONS`、`PENDING_ACTION` 一起送给 reviewer 模型。

长会话会超过 reviewer 的上下文窗口：

```text
CONTEXT_WINDOW_EXCEEDED: max 1048576, requested 1051891
(795891 in messages, 256000 in completion)
```

这不是人工审批弹窗的问题，而是 Auto review 的 LLM 请求在审批之前就失败了。

## 修复

`auto-review-fix` 包装 `llm.stream`，只识别并改写 Auto review 请求：

- system 必须同时包含 `REVIEW_POLICY` 和 `final authorization reviewer`；
- 消息必须同时包含 `FILTERED_HISTORY` 和 `PENDING_ACTION`。

其他对话、翻译和其他插件的 LLM 调用原样放行。

### 保留什么

- `PENDING_ACTION`：原样保留，评审对象不能被裁剪。
- `PROJECT_INSTRUCTIONS`：保留，最多 40,000 字符。
- 所有 `human-instruction` / `direct-parent-instruction`：优先保留。
- 最近 `reviewKeepRecentEntries` 条历史（默认 16）。

### 压缩什么

- 旧工具调用/事实：折叠成一条 summary；
- 单条工具参数：最多 2,000 字符；
- 单条用户文本：最多 4,000 字符；
- 图片和附件：移除 base64，只留 `[image omitted from reviewer context]`；
- `FILTERED_HISTORY` 总预算：默认 120,000 字符。

裁剪只作用于 reviewer 的请求副本，不修改会话历史、审计事件或当前工具调用。

## 配置

设置 → MCviseron 插件 → Auto review 修复：

```yaml
reviewContextGuard: true
reviewMaxHistoryChars: 120000
reviewKeepRecentEntries: 16
```

## 边界

- 不自动 allow，不降低风险等级；
- 历史不足时 reviewer 仍可 fail closed；
- 请求格式不匹配时完全不改；
- 裁剪日志写到 `%TEMP%\dsh-mcviseron-auto-review.log`，不记录内容。

## 测试

`test/review-context.test.ts` 覆盖：非 review 请求不变、PENDING_ACTION 保留、
人类指令保留、旧事实折叠、图片/工具参数裁剪、畸形 JSON 原样返回、wrapper
只改写 reviewer 调用。
