# Contributing

## 开发环境

- Node.js `^22.19.0 || >=24`
- pnpm `10.6.3`（仓库声明 `packageManager`）

```bash
pnpm install
pnpm check
```

`pnpm check` 依次执行 `tsc --noEmit`、`node --experimental-strip-types test/schedule.test.ts` 与 `node build.mjs`。

## 代码约定

- Host 与浏览器共用 `src/` 下的纯逻辑（`schedule.ts`、`api.ts`、`namespace.ts`），不把 DOM 或 cordis 服务引入纯逻辑，保证可单测。
- 浏览器半边不引入新的 DSH 客户端包为必需依赖：`theme` 服务按需惰性解析，行与设置即使在主题插件缺失时也可用。
- 设置命名空间固定为 `mcviseron`（= `cordis.patch.yml` 的条目 id）。任何会改变条目 id 的改动都必须同步 `src/namespace.ts`。
- 新增第三方依赖前先确认能否用现有 DSH 服务或 Web API 完成（YAGNI）。

## 提交

- 使用 Conventional Commits：`feat:`、`fix:`、`docs:`、`chore:`、`refactor:`、`test:`。
- 每个发布版本更新 `CHANGELOG.md`（Keep a Changelog 格式），并同步 `package.json` 版本号。
- `lib/` 是构建产物，不入库。

## DSH 版本升级流程

1. 安装目标 DSH 版本对应的 `@deepseek-ai/*` 开发依赖（`pnpm add -D @deepseek-ai/dsh-client-ui-theme@<ver> ...`，仅类型需要）。
2. `pnpm check`；若接口变化，优先按 [README](README.md) 的「工作原理」逐层修复：先 Host 设置桥，再浏览器驱动，最后设置行。
3. 在 `CHANGELOG.md` 的 `Compatibility` 段落记录验证过的版本与 peer 范围。
4. 手动验证：切换开关、修改时段到下一分钟、跨午夜窗口、刷新页面、关闭再打开设置页。

## 发布

1. `pnpm check` 全绿。
2. 更新 `package.json` 版本与 `CHANGELOG.md`。
3. `git tag vX.Y.Z && git push origin main --tags`。
4. GitHub Release 附带 `CHANGELOG` 对应段落（可选：`pnpm publish`）。
