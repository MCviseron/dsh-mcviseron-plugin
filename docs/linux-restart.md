# Linux / Web / 云服务器上的重启与关闭

Windows 桌面版继续使用 Electron 主进程 + Task Scheduler 的原地重启；Linux、Web 与云服务器使用 Host 进程级方案。

## 目标解析

`resolveRestartTarget()` 在非 Windows 平台返回 ProcessTarget：

- `execPath`：`process.execPath`（通常是 node）；
- `argv`：`process.execArgv` + `process.argv.slice(1)`，即当前 dsh 命令及参数；
- `cwd`：当前工作目录；
- `mode`：`reexec` 或 `supervisor-exit`。

### supervisor-exit

以下任一条件成立时，重启请求只退出 Host，由外层托管器拉起：

- systemd：`INVOCATION_ID` / `JOURNAL_STREAM` / `SYSTEMD_EXEC_PID`；
- Kubernetes：`KUBERNETES_SERVICE_HOST`；
- Docker：存在 `/.dockerenv`；
- 进程 PID 为 1（容器入口）；
- `DSH_MCVISERON_RESTART_MODE=supervisor-exit`（或 `exit`）。

退出码为 **75**（`EX_TEMPFAIL`），便于 `Restart=on-failure` / Docker `on-failure` 识别为需要重启。

### reexec

普通 `dsh web` 进程：

1. 写入一个 detached Node helper；
2. helper 等待原 PID 退出；
3. helper 用相同 `execPath`、argv、cwd 和环境启动新进程；
4. 原进程退出。

helper 会最多等待原进程 30 秒，避免端口未释放就启动新实例。可用
`DSH_MCVISERON_RESTART_MODE=reexec` 强制该模式。

## 关闭

关闭请求执行 `process.exit(0)`（桌面版关闭 Electron 主进程），不再启动新进程。
关闭后是否真正保持停止，由托管器策略决定：

### systemd

```ini
[Service]
ExecStart=/usr/bin/dsh web --host 0.0.0.0 --port 3000
Restart=on-failure
RestartSec=3
```

- 重启：进程以 75 退出，systemd 重新拉起；
- 关闭：进程以 0 退出，systemd 不再拉起。

### Docker

```bash
docker run --restart on-failure ...
```

- 重启：75 退出，Docker 重新拉起；
- 关闭：0 退出，保持停止。
- 若使用 `--restart unless-stopped`，关闭也会被 Docker 重新拉起；这是 Docker 策略，不是插件能覆盖的。

### Kubernetes

```yaml
restartPolicy: OnFailure
```

- 重启：75 退出，kubelet 重启容器；
- 关闭：0 退出，Pod 保持 Completed。
- `restartPolicy: Always` 下关闭也会被重新拉起；需要停止时使用 `kubectl delete pod` 或调整策略。

### 普通 CLI

直接运行 `dsh web` 时使用 reexec helper；关闭后进程直接结束，不会被重新拉起。

## 设置页与会话后动作

- 「重启 / 关闭」设置页同时提供重启与关闭按钮；
- 状态会显示当前模式（desktop / reexec / supervisor-exit）；
- `set_session_end_action` 的 `restart` / `close` 在 Linux/Web 同样可用；
- 操作系统关机仍是 Windows-only，Linux 上不提供。

## 安全与限制

- 路由仍只接受 loopback 请求并需要 `confirm: true`；
- 重启不会执行任意命令，只复用当前进程的 `execPath`、argv、cwd；
- supervisor-exit 依赖托管器配置；没有托管器的环境应使用 reexec；
- reexec 需要当前进程有权限启动新进程；容器内建议使用 supervisor-exit；
- 日志：`$TMPDIR/dsh-mcviseron-restart.log`（Windows 为 `%TEMP%`）。

## 测试

`test/restart.test.ts` 覆盖 Windows 桌面目标、Linux reexec/supervisor 探测、环境变量覆盖、状态/执行路由与关闭动作；`test/session-end.test.ts` 覆盖 Linux 的 restart/close 可用性。
