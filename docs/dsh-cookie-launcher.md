# DSH 启动 cookie 清理器

## 背景

DSH Desktop 的认证 cookie 在 **Electron main / defaultSession** 中，认证发生在任何插件加载之前。插件运行时的 prune 路由拿不到这些 cookie（诊断日志会一直是 `pruned=0`），所以不能靠运行时插件修复启动 431。

## 方案

Start Menu 快捷方式指向一个启动器：

```text
Start Menu -> wscript.exe //nologo launch-dsh.vbs
                    |
                    +-- clean-dsh-auth-cookies.py
                    |     只删除 host_key=127.0.0.1 且 name LIKE 'dsh-auth-%'
                    |     删除前备份，最多保留 10 份
                    |
                    +-- D:\DeepSeek Harness\DeepSeek Harness.exe
```

- 不改 `app.asar`，DSH 更新不会丢；
- 只动 DSH 的认证 cookie，不碰其他 host/其他 cookie；
- DSH 正在运行时数据库会锁住，清理脚本会记录并直接启动应用（单实例）；
- 日志：`%LOCALAPPDATA%\dsh-mcviseron\launcher.log`
- 备份：`%LOCALAPPDATA%\dsh-mcviseron\backups\`

## 安装 / 修复快捷方式

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ^
  "D:\Program\DSH-Plugin-Class\dsh-mcviseron-plugin\scripts\install-dsh-cookie-launcher.ps1"
```

脚本会：

1. 把两个启动文件复制到 `%LOCALAPPDATA%\dsh-mcviseron`；
2. 查找 Desktop / Start Menu / 任务栏中目标为 DSH exe 的快捷方式；
3. 首次修改前备份为 `.lnk.bak-dsh-cookie`；
4. 把快捷方式改为启动清理器。

## 注意

- **必须从快捷方式启动**；直接双击 `DeepSeek Harness.exe` 会绕过清理。
- DSH 更新器如果重建快捷方式，重新执行安装脚本即可。
- 原快捷方式备份：同目录 `.lnk.bak-dsh-cookie`。
- 清理脚本的数据库路径可用 `DSH_COOKIE_DB` 覆盖，便于测试。

## 验证

```text
TARGET|C:\Windows\System32\wscript.exe
ARGS|//nologo "C:\Users\...\AppData\Local\dsh-mcviseron\launch-dsh.vbs"
```

用合成数据库测试：只删除 `127.0.0.1` 的 `dsh-auth-*`，保留 `unrelated` 和 `localhost` 的 cookie，并在 `backups/` 生成备份。
