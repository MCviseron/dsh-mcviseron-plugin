# Contributing

## 开发环境

- Node.js `^22.19.0 || >=24`
- pnpm `10.6.3`（仓库声明 `packageManager`）

```bash
pnpm install
pnpm check
```

`pnpm check` 依次执行 `tsc --noEmit`、全部 `node --experimental-strip-types test/*.test.ts`（60 项）与 `node build.mjs`。

## 代码约定

- **组件化**：每个组件一个目录（`src/components/<id>/`），导出唯一的 `install<Component>(ctx, config)`；`src/index.ts` 只负责拆分配置与装配，不写业务逻辑。
- Host 与浏览器共用 `src/` 下的纯逻辑（`schedule.ts`、`api.ts`、`namespace.ts`），不把 DOM 或 cordis 服务引入纯逻辑，保证可单测。
- 组件的宿主接缝全部**特性探测**：服务缺失、字段缺失、老会话格式都必须降级为 no-op 或原样放行，绝不能让插件加载失败或阻塞审批。
- 浏览器半边不引入新的 DSH 客户端包为必需依赖：`theme` 服务按需惰性解析，行与设置即使在主题插件缺失时也可用。
- 设置命名空间固定为 `mcviseron`（= `cordis.patch.yml` 的条目 id）。任何会改变条目 id 的改动都必须同步 `src/namespace.ts`。
- 新增第三方依赖前先确认能否用现有 DSH 服务或 Web API 完成（YAGNI）。

## 新增一个组件

1. 在 `src/config.ts` 增加一个分组 schema（字段全部 `.volatile()`，字段名避免与其他组件冲突）。
2. 新建 `src/components/<id>/index.ts`，导出 `install<Component>(ctx, groupConfig)`，内部自行做类型收窄与默认值。
3. 在 `src/index.ts` 的 `apply()` 中装配；如果组件需要浏览器 UI，在 `src/client/` 增加并在 `settings.general.item` 注册。
4. 增加行为测试与真实 Cordis 上下文测试；必要时扩展 `test/plugin.test.ts` 的装配断言。
5. 更新 README（组件表、配置表）、CHANGELOG 与 `docs/automation-task.md`。

## 提交

- 使用 Conventional Commits：`feat:`、`fix:`、`docs:`、`chore:`、`refactor:`、`test:`。
- 每个发布版本更新 `CHANGELOG.md`（Keep a Changelog 格式），并同步 `package.json` 版本号。
- `lib/` 是构建产物，不入库。

## DSH 版本升级流程

1. 安装目标 DSH 版本对应的 `@deepseek-ai/*` 开发依赖（`pnpm add -D @deepseek-ai/dsh-client-connection@<ver> ...`，仅类型需要）。
2. `pnpm check`；若接口变化，按组件逐层修复：
   - 设置桥：`ctx.settings.describe/mutate/configure`；
   - 外观：`settings.general.item` 插槽、locale/slots 注册、`ctx.theme.setTheme/getTheme`；
   - Auto review：`permissionPresets.set`、`approval.request`、`displayReason`、`llm.stream`；
   - Todo 守卫：`tools/pre-execute` / `post-execute` / `agent/pre-step` / `session/event`、session format source kind。
3. 在 `CHANGELOG.md` 的 `Compatibility` 段落记录验证过的版本与 peer 范围。
4. 手动验证：外观开关与时段、跨午夜窗口、刷新后配置仍在；触发一次 Auto review 被拒看审批卡片译文；跑一个多阶段任务看 todo notice。

## 发布

1. `pnpm check` 全绿。
2. 更新 `package.json` 版本与 `CHANGELOG.md`。
3. `git tag vX.Y.Z && git push origin main --tags`。
4. GitHub Release 附带 `CHANGELOG` 对应段落（可选：`pnpm publish`）。
