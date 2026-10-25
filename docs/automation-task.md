# DSH 自动化任务：跟踪 DSH 版本兼容性

本仓库通过一条 DSH「自动化任务」定期检查最新 DSH 版本，升级兼容范围并修复版本更新导致的 bug。任务覆盖总插件的全部组件。

## 任务摘要

| 项 | 值 |
| --- | --- |
| 标题 | 维护 dsh-mcviseron-plugin 对最新 DSH 的兼容性 |
| 任务 id | `schedule-f3ea5b03-26e2-4192-95d7-d3d4b61ef751` |
| 规则 | 每周一 10:00（`Asia/Shanghai`，本地墙钟） |
| 下次运行 | `2026-10-19T02:00:00.000Z`（2026-10-19 10:00 +08:00） |
| 绑定会话 | `session-2465e99b-e04d-4830-ae30-857aff299b07`（本插件开发会话） |
| 存储 | `~/.dsh/storages/schedule.json`（DSH 0.2 schedule domain v1） |

任务已通过 DSH 0.2.1-rc.2 自带的 `decodeScheduleRecord` / `scheduleView` 解码校验；记录格式为 `kind: "weekly"`、`time: "10:00:00.000"`、`timeZone: "Asia/Shanghai"`、`weekdays: [1]`。

> 该记录直接写入 schedule domain 文档。运行中的 DSH 在启动时加载它，因此**需要重启 DSH 后才会出现在「自动化任务」页面并开始计时**。重启前若在自动化任务页面新建/删除其他任务，运行中的 Host 会重写整个文档并覆盖这一条；遇到这种情况重新写入即可。

## 任务提示词

```text
维护 dsh-mcviseron-plugin（总插件）对最新 DSH 版本的兼容性。

仓库：D:\Program\DSH-Plugin-Class\dsh-mcviseron-plugin（GitHub: https://github.com/MCviseron/dsh-mcviseron-plugin）
目标版本：以 npm 官方最新版 @deepseek-ai/dsh 为准（npm view @deepseek-ai/dsh version；必要时也查 https://registry.npmjs.org/@deepseek-ai/dsh 的 dist-tags.latest）。

本仓库承载一个 master 条目 `mcviseron`（`name: dsh-mcviseron-plugin`），内部挂载四个子组件；升级时逐一检查：
- appearance 子组件：settings.general.item 插槽、locale/slots 注册、ctx.theme.setTheme/getTheme、loopback 设置桥（ctx.settings.describe/mutate/configure）、Config 顶层字段与 volatile 引用展开。
- auto-review-fix 子组件：ctx.inject 的 permissionPresets.set 与 approval.request 包装、displayReason / reason 结构、llm.stream 分块格式。
- task-guard 子组件：tools/pre-execute、tools/post-execute（additionalContexts）、agent/pre-step、agent/assistant-stream（意图检测）、session/event、session format v3/v4 的 source kind、todo 标题翻译（llm）。
- restart 子组件：一级设置分区（settings.section）与重启子页、loopback restart 路由、Electron 主进程 PID/EXE 推导、Windows 任务计划程序直接启动 exe。
旧仓库 dsh-auto-review-restart-fix 与 dsh-task-guard 已废弃，不要修改；它们的功能已并入本仓库。

步骤：
1. 读取仓库 package.json 与 CHANGELOG.md 的「Compatibility」段落，确认当前声明兼容的 DSH 版本。
2. 获取最新 DSH 版本。若与当前声明一致，直接结束并回复「已是最新兼容版本」。
3. 若发布了新版本：
   a. 执行 pnpm install，把 @deepseek-ai/dsh-client-connection、dsh-client-locale、dsh-client-ui-settings、dsh-client-ui-slots、dsh-client-ui-renderer、dsh-host-webserver、dsh-settings、@deepseek-ai/cordis 的开发依赖升级到与最新 DSH 相同版本，并更新 peerDependencies 范围。
   b. 对照最新包的类型声明与 lib 实现，按组件逐层修复不兼容处（先 Host 设置桥，再 autoReview、taskGuard，最后浏览器外观行）。
   c. 执行 pnpm check（tsc --noEmit + 119 项 node 测试 + esbuild 构建），补齐或修正测试；必要时更新 test/plugin.test.ts 的装配断言。
   d. 更新 CHANGELOG.md（新版本段落记录兼容版本与修复）、README.md / README.en.md 的兼容性表；提交并推送到 main。
4. 不要执行 npm publish；不要重启或关闭正在运行的 DSH；不要修改 D:\Program\DSH-Plugin-Class 下的其他插件仓库。

手动验证要点：
- 外观：开关即时生效；修改时段后下一次边界正确切换；跨午夜窗口（如 22:00–06:00）正确；刷新页面后配置仍在；设置行显示当前时段与下次切换。
- Auto review：触发一次被拒调用，审批卡片中文末尾出现【审查理由 · 中文翻译】，英文原文不变；重启后 Auto 会话不变成完全访问。
- Todo 守卫：只含 pending 的 todo_write 后出现【todo 同步】notice；连续 5 次工具调用不更新 todo 后出现停滞 notice。
```

## 在界面中重建

若需要在 DSH「自动化任务」页面手动重建（推荐，避免直接改存储）：

1. 打开侧栏「自动化任务」，新建任务。
2. 标题填上表「标题」。
3. 选择「每周」、星期一、10:00，时区 `Asia/Shanghai`。
4. 提示词粘贴上面的整段。
5. 绑定到任意常用会话（任务会在该会话中投递提醒）。

## 旧插件的周检任务

0.2.0 之前，`dsh-auto-review-restart-fix` 与 `dsh-task-guard` 各自在别的会话里建过每周巡检任务。功能合并后这些任务已从 schedule 存储中删除；如果重启后仍在「自动化任务」页面看到它们，可手动删除，避免继续去改已废弃的仓库。
