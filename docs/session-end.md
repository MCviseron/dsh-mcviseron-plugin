# 会话后动作（sessionEnd）

输入框左侧的「会话后重启」下拉，以及 AI 工具 `set_session_end_action`。

## 行为

| 动作 | 谁可以设置 | 执行时机 | 是否等待任务 |
| --- | --- | --- | --- |
| 不做操作 | 用户 / AI | — | — |
| 重启 DSH | 用户 / AI | 本轮最终回复显示完 + `graceMs` | **是**：等待所有运行中的 agent turn 和后台 job |
| 关闭 DSH | 用户 / AI | 同上 | 否 |
| 关闭电脑 | **仅用户** | 同上 | 否 |

- 状态只保存在 Host 内存，DSH 每次启动都是关闭；不写 profile、不写 localStorage。
- 动作是**一次性**的：执行前先清除状态，再调用重启/关闭/关机；不会因为加载插件或重复 `turn/end` 反复重启。
- 新 turn 开始时，如果上一个 turn 结束后的等待计时器还在，只取消本次计时并保留动作；该 turn 结束后重新排队，避免用户追问时把重启静默吞掉。
- **全局只执行一次**：多个会话同时设置动作时，第一个真正进入执行阶段（非等待状态）的动作会设置进程级 `dispatching` 锁，取消其它会话的计时器并清空它们的状态；后续动作直接跳过。两个会话都设 restart 只会产生一次重启。
- 「设置 → MCviseron 插件 → 重启」是另一个组件，仍然**立即**执行，不受任务等待约束。

## 任务探寻

重启前读取：

- `ctx.agents.list()` 中 `status === 'running'` 的 agent（包含等待审批/回答的 turn、子 agent）；
- `ctx.jobs.list()` 中 `status === 'running' | 'stopping'` 的后台 job（同时按全局和 live owner 收集，去重）。

任意一项存在就每 2 秒复查一次，直到全部结束；等待期间输入框的提示会显示「等待其它任务结束」。关闭 DSH / 关机不等待。

## AI 工具

工具名：`set_session_end_action`

```json
{ "action": "restart" | "close" | "off", "reason": "optional" }
```

- AI 只能设置 `restart` / `close` / `off`；`shutdown` 被拒绝。
- 工具返回后，输入框通过 1.5 秒轮询拿到 `requestedBy: "ai"`，显示醒目但非弹窗的提示。
- 同时有一个**全局右上角提示**（不属于当前会话）轮询 `/session-end/global`，显示「xx 会话已启用 AI 会话自动重启/关闭」；多会话会列出多张卡片，可逐张关闭，动作执行/清除后自动消失。
- 工具设置后到 `turn/end` 才排入执行队列；如果 AI 在最终回复前设置，本轮结束后触发。

## 邮件联动（可选）

当同时满足以下条件时，AI 设置 `restart`/`close` 会发送一封提醒邮件：

1. 已安装 `dsh-email-notify`，且其设置命名空间 `email-notify` 可读；
2. `enabled` 不为 false，且 `smtpHost` / `smtpUser` / `smtpPassword` / `mailTo` 均可发送（`mailFrom` 为空时回退到 `smtpUser`）；
3. 本插件的 `sessionEnd.notifyEmailOnAi` 为 `true`（默认）。

实现方式：

- 通过 Host 的 `settings.describe({ redactSecrets: false })` 读取邮件插件已经配置的 SMTP 字段（仅 Host 内部使用，不经过浏览器，不打印密码）；
- 用内置的 `nodemailer` 发送自定义主题/正文，**不修改 `dsh-email-notify`**；
- 邮件发送是异步 best-effort：失败只写 `%TEMP%\dsh-mcviseron-session-end.log`，不阻塞工具结果和重启动作；
- 同一 session + action 60 秒内只发一次，避免 AI 重复调用造成轰炸。

模板字段：

| 占位符 | 值 |
| --- | --- |
| `{{action}}` | `restart` / `close` |
| `{{actionText}}` | 重启 DeepSeek Harness / 关闭 DeepSeek Harness |
| `{{sessionName}}` | 会话标题（缺失时用 sessionId） |
| `{{sessionId}}` | 会话 ID |
| `{{time}}` | 本地时间 |
| `{{reason}}` | 工具参数 `reason`，空时显示「（未提供）」 |

## 配置

```yaml
sessionEnd:
  enabled: true          # 输入框下拉 + AI 工具
  graceMs: 3000          # 最终回复渲染等待，0–15000
  notifyEmailOnAi: true  # AI 开启时发邮件
  emailSubject: "[DSH 会话后动作] {{actionText}}"
  emailBody: |-
    AI 已请求在本轮会话结束后{{actionText}}。

    会话：{{sessionName}}
    会话 ID：{{sessionId}}
    时间：{{time}}
    理由：{{reason}}
```

这些字段也在「设置 → MCviseron 插件 → 会话后动作」子页中提供；配置修改后如果运行中的组件还没拿到新值，重启 DSH 生效。

## 接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/dsh-mcviseron/session-end/state` | 查询当前 session 状态（1.5 秒轮询） |
| POST | `/api/dsh-mcviseron/session-end/set` | 用户下拉设置；只允许 loopback |
| GET/POST | `/api/dsh-mcviseron/session-end/global` | 所有 AI 设置的动作（含 label/waiting），供右上角全局提示轮询 |

## 限制

- 关闭 DSH / 关机按设计不等待任务（只有重启等待）。
- 欢迎页/浏览器刷新不会重置 Host 内存状态；新的 DSH 进程一定从关闭开始。
- 邮件联动读取的是抓取时的 SMTP 配置；邮件插件设置改变后，下一次 AI 设置动作会重新读取。
- 邮件发送失败不会阻止重启/关闭，也不会在 UI 中弹窗；需要诊断时查看上面的临时日志。
