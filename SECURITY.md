# Security Policy

## 支持的版本

仅最新发布版本接收安全修复。

## 报告漏洞

请通过 GitHub Security Advisories（仓库 `Security` 页）私密报告，或邮件联系维护者（见 `package.json` 的 `author.email`）。请勿在公开 issue 中披露可利用细节。

## 安全设计

- 本插件不发起外部网络请求，不读取凭据，不执行命令。
- 浏览器与 Host 之间只通过两条 loopback 接口通信：`/api/dsh-mcviseron/settings/describe` 与 `/api/dsh-mcviseron/settings/mutate`。
- 两条接口都执行 loopback 信任栅栏：socket 地址必须是 loopback、`Host` 头必须是 loopback 主机名、存在 `Origin` 时必须与 `Host` 同源、`Sec-Fetch-Site: cross-site` 直接拒绝；`X-Forwarded-For` 从不被信任。
- 写入接口只接受命名空间 `mcviseron` 与 `enabled` / `lightStart` / `lightEnd` 三个字段，并校验取值类型与 `HH:MM` 格式；请求体上限 8 KiB。
- 设置值始终经过 `normalizeScheduleConfig` 归一化，畸形值回退默认，不会把任意值写入 DSH 设置。
