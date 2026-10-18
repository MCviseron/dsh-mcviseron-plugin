# 发布 dsh-mcviseron-plugin 到 npm

## 当前状态（2026-10-18）

- 包名 **`dsh-mcviseron-plugin` 在 npmjs 可用**（`npm view` 返回 404，未占用）。
- npm 账号 `mcviseron` 因使用恢复码登录被**临时只读暂停**，解冻时间 **2026-10-20 03:55 UTC = 北京时间 11:55**。暂停期间不要执行 `npm publish`、创建 token 或修改包设置。
- 本机全局 registry 指向 npmmirror，发布时必须显式指定 `--registry=https://registry.npmjs.org/`。
- 首次发布需要**手动**完成；之后由 `.github/workflows/publish.yml` 通过 OIDC Trusted Publishing 发布。

## 首次发布（账号解冻后）

1. 确认账号恢复与登录：

   ```powershell
   npm whoami --registry=https://registry.npmjs.org/
   ```

2. 在仓库根目录校验并打包：

   ```powershell
   pnpm check
   npm pack --dry-run
   ```

   `prepublishOnly` 也会执行 `pnpm check`。tarball 必须包含：
   `lib/appearance.js`、`lib/auto-review-fix.js`、`lib/task-guard.js`、`lib/client.js`、`cordis.patch.yml`、`package.json`、`README.md`、`LICENSE`。

3. 发布：

   ```powershell
   npm publish --registry=https://registry.npmjs.org/ --access public
   ```

   - 如果提示 `EOTP`：用验证器 App 的 6 位 OTP，`--otp=<code>`。
   - **不要使用恢复码（recovery code）**：npm 会把它视为安全敏感操作，触发 72 小时只读暂停。
   - 长期方案：创建 **Granular Access Token**（Read and write、Bypass 2FA），写入本机 `.npmrc` 后直接 publish，不再需要 OTP。

4. 如果出现 staged publishing（`0.0.0-stage` 占位）：

   ```powershell
   npx --yes npm@12 publish --access public --registry=https://registry.npmjs.org/ --otp=<code>
   # 或
   npx --yes npm@12 stage list
   npx --yes npm@12 stage approve <stage-id>
   ```

5. 验证并同步国内镜像：

   ```powershell
   npm view dsh-mcviseron-plugin version dist-tags.latest --registry=https://registry.npmjs.org/
   curl.exe -sI https://registry.npmjs.org/dsh-mcviseron-plugin/-/dsh-mcviseron-plugin-0.4.0.tgz | Select-Object -First 1
   curl.exe -X PUT "https://registry.npmmirror.com/-/package/dsh-mcviseron-plugin/syncs"
   ```

## 配置 Trusted Publishing（首次发布成功后）

npmjs.com → `dsh-mcviseron-plugin` → **Settings → Trusted Publisher → GitHub Actions**：

| 字段 | 值 |
| --- | --- |
| Organization/user | `MCviseron` |
| Repository | `dsh-mcviseron-plugin` |
| Workflow filename | `publish.yml` |
| Environment | 留空 |
| Allow npm publish | 勾选 |
| Allow npm dist-tag | 勾选 |

然后在 GitHub 仓库 **Settings → Actions → Variables** 设置 `NPM_PUBLISH_ENABLED=true`。

## 后续发版

1. 更新 `package.json` 版本与 `CHANGELOG.md`（Keep a Changelog）。
2. `pnpm check` 全绿。
3. `git tag vX.Y.Z && git push origin main --tags`。
4. `publish.yml` 会校验 tag 与版本一致、跑测试与构建、检查 tarball 内容，然后通过 OIDC 发布并附带 provenance。

> 未设置 `NPM_PUBLISH_ENABLED=true` 时，tag 构建仍会跑，但发布会跳过并输出 notice。

## 回滚与故障

- 发布内容有误：`npm deprecate dsh-mcviseron-plugin@X.Y.Z "reason"`，再发新版本修复；不要直接 `unpublish` 已被使用的版本。
- OIDC 发布失败：检查 npm 包的 Trusted Publisher 配置、workflow 文件名与 tag 是否匹配；回退到 `NPM_TOKEN`（granular token + Bypass 2FA）作为 secret。
- 账号再次被暂停：按 npm 邮件说明处理，暂停期间不要重试发布。
