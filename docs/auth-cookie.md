# DSH 认证 cookie 清理

## 问题

DSH Desktop 每次启动监听随机 loopback 端口，并下发：

```text
dsh-auth-<sha256(host:port)>
```

Chromium 的 cookie **不按端口隔离**，只按 host 保存；该 cookie 是 30 天持久 cookie 且带 `HttpOnly`。因此每次重启都会在 `127.0.0.1` 下留下一条旧的 `dsh-auth-*`，旧 cookie 不会被覆盖，前端 JS 也无法删除。

累积到约 71 条时，`Cookie` 请求头约 16 KB，超过 Node HTTP 服务的默认 `maxHeaderSize`（16384 字节），Host 返回 431，桌面壳报：

```text
desktop welcome: Web authentication failed
```

## 修复方式

不限制重启，也不修改 DSH 安装包。插件在 Host 侧提供：

```text
POST /api/dsh-mcviseron/auth-cookies/prune
```

流程：

1. 按当前请求的 `Host` 和协议复算当前 cookie 名；
2. 解析 `Cookie` 头里所有合法的 `dsh-auth-*`；
3. **保留当前 authority 的那一条**；
4. 对其余旧 cookie 下发过期 `Set-Cookie`：
   ```text
   name=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT;
   HttpOnly; SameSite=Strict[; Secure]
   ```

插件还会在所有 index 页面的 `<head>` 注入一次 prune 调用，并在客户端入口做一次兜底调用。每次页面加载后只保留当前 cookie，重启次数不再增加 Cookie 头大小。

## 保证与边界

- 不读取、不记录任何 cookie 值；
- 只处理 `dsh-auth-` 前缀且符合生成格式的名字；
- 当前 cookie 名计算不出来时不下发任何过期头，失败关闭；
- 路由仅接受 loopback 的同源 POST；
- 插件方案不依赖 `app.asar`，DSH 升级不会丢失。

如果已经累积到启动就返回 431，插件的 Host 还没机会加载，需要**一次性**清理旧 cookie：

1. 关闭 DSH；
2. 备份 `%APPDATA%\@deepseek-ai\dsh-desktop\Network\Cookies`；
3. 只删除 `host_key = '127.0.0.1'` 且 `name LIKE 'dsh-auth-%'` 的记录；
4. 重新启动 DSH，之后由插件接管。

这是 bootstrap，不是长期补丁。

## 验证

- `pnpm check` 中的 `test/auth-cookie.test.ts` 覆盖：
  cookie 名算法、HTTP/HTTPS authority、旧 cookie 选择、当前 cookie 保留、删除头属性、loopback/POST 校验、index 注入。
- 实际重启后可在关闭 DSH 时检查 cookie 库，确认 `dsh-auth-*` 数量保持为 1。
