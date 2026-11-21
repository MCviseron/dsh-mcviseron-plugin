# Auto review 上下文裁剪

## 问题

DSH 0.2.2 的 `dsh-experimental-auto-review` 会把当前 Session 的完整
`surface.nodes` 转成 review 请求，再送给 reviewer 模型。长会话会超过 reviewer
的上下文窗口，Auto review 在审批之前就失败：

```text
CONTEXT_WINDOW_EXCEEDED: max 1048576, requested 1051891
```

这不是人工审批弹窗的问题，而是 reviewer 的 LLM 请求过大。

## 修复

`auto-review-fix` 包装 `llm.stream`，只改写真正的 Auto review 请求：

- `purpose === 'auto-review'`；
- `system` 同时包含 `REVIEW_POLICY` 和 `final authorization reviewer`；
- `messages[0]` 以 `ENVIRONMENT\n` 开头，后续每条消息是一个历史条目 JSON。

0.2.1/旧版使用的 `FILTERED_HISTORY` / `PENDING_ACTION` 单消息格式仍兼容。

### 保留什么

- `ENVIRONMENT`：原样保留。
- 最后一条消息（pending action）：原样保留，评审对象不能裁剪。
- 所有 `user-instruction` / `direct-parent-instruction` / `constraint` /
  `checkpoint`：保留，长文本最多 8,000 字符。
- 每种工具的最新 schema：保留，保证 reviewer 知道 pending call 的参数含义。
- 最近 `reviewKeepRecentEntries` 条历史（默认 32）。

### 压缩什么

- 旧工具调用参数：最多 4,000 字符；
- 旧用户/事实文本：最多 8,000 字符；
- schema description：最多 4,000 字符；
- 旧图片和附件：移除 base64，只留占位文本；
- 被省略的旧条目：插入一条 JSON summary，不破坏每消息一个 JSON 的格式；
- 历史总预算：默认 200,000 字符。

裁剪只作用于 reviewer 的请求副本，不修改会话历史、审计事件或当前工具调用。

## 配置

设置 → MCviseron 插件 → Auto review 修复：

```yaml
reviewContextGuard: true
reviewMaxHistoryChars: 200000
reviewKeepRecentEntries: 32
```

## 边界

- 不自动 allow，不降低风险等级；
- 历史不足时 reviewer 仍可 fail closed；
- 请求格式不匹配时完全不改；
- 裁剪日志写到 `%TEMP%\dsh-mcviseron-auto-review.log`，不记录内容。

## 测试

`test/review-context.test.ts` 覆盖旧版和新版两种请求格式、pending action 保留、
人类指令保留、schema 保留、图片/工具参数裁剪、畸形 JSON 原样返回，以及 wrapper
只改写 reviewer 调用。
