# Contributing

## 开发环境

- Node.js `^22.19.0 || >=24`
- pnpm `10.6.3`（仓库声明 `packageManager`）

```bash
pnpm install
pnpm check
```

`pnpm check` 依次执行 `tsc --noEmit`、全部 `node --experimental-strip-types test/*.test.ts`（71 项）与 `node build.mjs`。

## 代码约定

- **一个组件 = 一个 bundle 条目**：`src/<component>/index.ts` 导出该条目自己的 `Config` 与 `apply(ctx, config)`，并作为一个子路径导出写进 `package.json` 与 `cordis.patch.yml`；DSH 插件清单按 loader 条目逐条渲染。
- 组件实现放在 `src/components/<component>/`，条目文件只做 Config 与装配；入口 `apply()` 必须先用 `toPlain()` 展开 DSH 0.2 的 volatile 配置引用。
- 每个条目的设置命名空间 = 条目 id（例如 `mcviseron-appearance`）。浏览器侧需要读写时，只暴露自己的条目命名空间，并加 loopback 信任栅栏。
- Host 与浏览器共用 `src/` 下的纯逻辑（`schedule.ts`、`api.ts`、`namespace.ts`），不把 DOM 或 cordis 服务引入纯逻辑，保证可单测。
- 组件的宿主接缝全部**特性探测**：服务缺失、字段缺失、老会话格式都必须降级为 no-op 或原样放行，绝不能让插件加载失败或阻塞审批。
- 新增第三方依赖前先确认能否用现有 DSH 服务或 Web API 完成（YAGNI）。

## 新增一个组件

1. 新建 `src/components/<id>/index.ts`（纯实现）与 `src/<id>/index.ts`（Config + `apply`）。
2. 在 `package.json` 的 `exports` 增加 `"./<id>": "./lib/<id>.js"`，在 `build.mjs` 的 `hostEntries` 增加构建项。
3. 在 `cordis.patch.yml` 增加一条 `- id: mcviseron-<id> / name: dsh-mcviseron-plugin/<id>`。
4. 如果组件需要浏览器 UI：在 `src/client/` 实现，并在 `settings.general.item` 注册；如需读写配置，复用 `src/routes.ts` 的桥并加上条目命名空间。
5. 增加行为测试与真实 Cordis 上下文测试；在 `test/plugin.test.ts` 加载新条目验证组合行为。
6. 更新 README（组件表、配置表）、CHANGELOG 与 `docs/automation-task.md`。

## 提交

- 使用 Conventional Commits：`feat:`、`fix:`、`docs:`、`chore:`、`refactor:`、`test:`。
- 每个发布版本更新 `CHANGELOG.md`（Keep a Changelog 格式），并同步 `package.json` 版本号。
- `lib/` 是构建产物，不入库。

## DSH 版本升级流程

1. 安装目标 DSH 版本对应的 `@deepseek-ai/*` 开发依赖（`pnpm add -D @deepseek-ai/dsh-client-connection@<ver> ...`，仅类型需要）。
2. `pnpm check`；若接口变化，逐条目修复：
   - `mcviseron-appearance`：`ctx.settings.describe/mutate/configure`、`settings.general.item` 插槽、`ctx.theme.setTheme/getTheme`；
   - `mcviseron-auto-review-fix`：`permissionPresets.set`、`approval.request`、`displayReason`、`llm.stream`；
   - `mcviseron-task-guard`：`tools/pre-execute` / `post-execute` / `agent/pre-step` / `session/event`、session format source kind。
3. 在 `CHANGELOG.md` 的 `Compatibility` 段落记录验证过的版本与 peer 范围。
4. 手动验证：插件管理器显示 3 个组件；外观开关与时段、跨午夜窗口、刷新后配置仍在；触发一次 Auto review 被拒看审批卡片译文；跑一个多阶段任务看 todo notice。

## Profile 健康检查

- 本地安装/更新插件优先用 DSH 插件管理器。
- 在 `~/.dsh/profiles/<profile>` 里手动执行 `pnpm install` 后，务必跑一次 `node scripts/repair-profile.mjs`：pnpm 在 Windows 上会把跨盘符的 `link:D:/...` 依赖写成坏符号链接，并可能让插件管理器把这些条目从 `dsh.profile.bundles` 中移除。
- 修复脚本是幂等的，可随时运行确认 `link:` 依赖与 bundles 一致。

## 发布

1. `pnpm check` 全绿。
2. 更新 `package.json` 版本与 `CHANGELOG.md`。
3. `git tag vX.Y.Z && git push origin main --tags`。
4. GitHub Release 附带 `CHANGELOG` 对应段落（可选：`pnpm publish`）。
