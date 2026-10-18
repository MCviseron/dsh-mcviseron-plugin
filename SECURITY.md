# Security Policy

## 支持的版本

仅最新发布版本接收安全修复。

## 报告漏洞

请通过 GitHub Security Advisories（仓库 `Security` 页）私密报告，或邮件联系维护者（见 `package.json` 的 `author.email`）。请勿在公开 issue 中披露可利用细节。

## 安全设计

### 网络与凭据

- 插件自身不发起外部网络请求、不读取凭据、不执行命令。
- **Auto review 译文例外（经由宿主）**：开启 `autoReview.translateApprovalReason` 时，插件会通过 Host 的 `llm` 服务，把审查理由（去掉 `Auto review denied this call:` 前缀后的正文）作为一次短请求发给当前会话的 provider/model，或 `translateProvider`/`translateModel` 指定的模型。请求不携带文件内容或会话记录；可用 `translateApprovalReason: false` 完全关闭。
- 审批译文失败（超时、无 `llm`、无会话路由、无 `displayReason`、模型报错）一律原样放行审批，不会阻塞或改写审计文本。

### 设置桥

- 浏览器与 Host 之间只通过两条 loopback 接口通信：`/api/dsh-mcviseron/settings/describe` 与 `/api/dsh-mcviseron/settings/mutate`。
- 两条接口都执行 loopback 信任栅栏：socket 地址必须是 loopback、`Host` 头必须是 loopback 主机名、存在 `Origin` 时必须与 `Host` 同源、`Sec-Fetch-Site: cross-site` 直接拒绝；`X-Forwarded-For` 从不被信任。
- 写入接口只接受命名空间 `mcviseron`、分组 `appearance` 与 `enabled` / `lightStart` / `lightEnd` 三个字段（嵌套路径），并校验取值类型与 `HH:MM` 格式；请求体上限 8 KiB。
- 设置值始终经过 `normalizeScheduleConfig` 归一化，畸形值回退默认，不会把任意值写入 DSH 设置。
- `autoReview` / `taskGuard` 分组不经过浏览器接口，只由 profile 配置（本地文件）维护。

### 进程内包装

- Auto review 组件包装 `permissionPresets.set` 与 `approval.request`，只读转发、只追加展示文本；不改变审批决策、不改变预设语义（关机守卫只在根 fiber 非 ACTIVE 时丢弃写入）。
- Todo 守卫只读取 `todo_write` 参数与工具调用计数，默认只追加 notice；`rejectMissingActive` / `blockAfterCalls` 需显式开启才会产生拒绝。
