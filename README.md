# dsh-mcviseron-plugin

[English](README.en.md) | 中文

MCviseron 的 **DeepSeek Harness（DSH）总插件**：一个插件行承载全部 DSH 组件，后续组件共用同一个设置命名空间、生命周期与发布流程。

当前组件：

- **外观 · 按时间自动切换深浅色** —— 在 DSH「设置 → 通用 → 外观」下方新增一个选项，按本机时间自动切换浅色 / 深色。

## 功能

- 默认 **08:00（含）– 23:00（不含）为早间，使用浅色**；**23:00（含）– 08:00（不含）为晚间，使用深色**。
- 早间时段可以自定义（`HH:MM`）；开始时间大于结束时间时按跨午夜处理（例如 `22:00 – 06:00`）。
- 使用本机时间，自动适配时区与夏令时；标签页休眠、系统时间跳变后会在 20 秒内重新校准。
- 开关、时段改动立即生效并持久化到 DSH 设置（profile 配置层），跨浏览器会话有效。
- 不抢用户的手动选择：仅在**启用时、修改时段后、以及每个边界时刻**应用主题；中途手动切换配色会保留到下一个边界。
- 设置行实时显示「当前时段」与「下次切换」。

## 安装

### 方式一：作为 bundle 装入 profile（推荐）

在目标 profile 目录（例如 `~/.dsh/profiles/desktop`）：

```bash
pnpm add link:D:/Program/DSH-Plugin-Class/dsh-mcviseron-plugin
```

然后在 `package.json` 的 `dsh.profile.bundles` 中加入 `dsh-mcviseron-plugin`：

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-mcviseron-plugin"]
    }
  }
}
```

重启 DSH 后，本包的 `cordis.patch.yml` 会插入插件行（条目 id 固定为 `mcviseron`）。

### 方式二：发布后从 npm 安装

```bash
pnpm add dsh-mcviseron-plugin
```

> **注意**：DSH 0.2 起，插件的设置命名空间等于 profile 条目 id。本插件硬编码为 `mcviseron`，因此安装时请保留 `cordis.patch.yml` 中的条目 id（或手动写成 `id: mcviseron`），否则设置行会显示「无法读取插件设置」。

## 配置

Profile 的 patch 层可以直接写默认值，设置行中的改动会持久化到同一命名空间：

```yaml
- id: mcviseron
  name: dsh-mcviseron-plugin
  config:
    enabled: true
    lightStart: '08:00'
    lightEnd: '23:00'
```

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | 是否按时间自动切换；插件默认不接管配色 |
| `lightStart` | `HH:MM` | `08:00` | 早间开始（含） |
| `lightEnd` | `HH:MM` | `23:00` | 早间结束（不含） |

时间使用本机本地时间（不是 UTC）。`lightStart === lightEnd` 表示全天浅色。

## 工作原理

- **Host 半边**（`src/index.ts`、`src/routes.ts`）：导出 `Config`（三个 `.volatile()` 字段），使 profile 条目即设置命名空间；关闭自动生成的设置页；在 Host Web 服务器上注册两条 loopback 接口（`/api/dsh-mcviseron/settings/describe|mutate`），让浏览器设置行读写该命名空间。DSH 0.2 的官方设置 apiproxy 不向浏览器暴露第三方命名空间，因此这层窄桥是必要的。
- **浏览器半边**（`src/client/`）：把一行注册到 `settings.general.item`（紧跟在官方「外观」「字号」之后），负责开关、时段输入与状态文案；`ScheduleDriver` 每 20 秒读一次本机时间，在时段变化时调用 `ctx.theme.setTheme('light' | 'dark')`，并在 `visibilitychange` / `focus` 时补一次校准。
- 主题状态本身由官方 `ui-theme` 插件持有并持久化（`ui-theme` 命名空间）；本插件只按计划调用 `setTheme`，不复制主题状态。

### 时间语义

早间窗口是 `[lightStart, lightEnd)`：

- `start < end`：普通当日窗口；
- `start > end`：跨午夜窗口；
- `start === end`：全天浅色。

## 兼容性

| DSH 版本 | 状态 |
| --- | --- |
| `0.2.1-rc.2` | ✅ 本次发布验证（desktop profile + Web GUI） |
| `0.2.0-rc.x` | ✅ peer 范围覆盖（同一套设置与主题接口） |
| `0.1.x` | ❌ 不支持：0.1 的插件自行注册设置命名空间，与本插件的 `mcviseron` 命名空间模型不同 |

DSH 升级后若接口变化，请运行 `pnpm check` 并按 [CONTRIBUTING](CONTRIBUTING.md) 的升级流程处理；仓库同时通过 DSH「自动化任务」定期跟踪新版本。

## 目录结构

```
src/
  api.ts                 浏览器与 Host 共用的 loopback 路径
  namespace.ts           设置命名空间（= profile 条目 id）
  schedule.ts            纯时间规则（可单测，宿主/浏览器共用）
  config.ts              Config schema（0.2 设置命名空间）
  loopback.ts            loopback 信任栅栏
  routes.ts              settings describe/mutate 桥
  index.ts               Host 插件入口
  client/
    index.ts             浏览器插件入口（locale + 设置行 + 驱动）
    AppearanceScheduleRow.tsx  设置行 UI
    driver.ts            按时切换主题的驱动
    bridge.ts            设置读写桥客户端
    locales.ts           中英文案
    styles.ts            行内样式（读取 --dsw-* token）
test/
  schedule.test.ts       时间规则单测
```

## 开发

```bash
pnpm install
pnpm check     # typecheck + test + build
```

构建产物：`lib/index.js`（Host ESM）与 `lib/client.js`（浏览器模块，`window.__ModuleLoader__` 包装）。`lib/` 不入库，由 `pnpm build` / `pnpm install` 生成。

## 自动化任务

仓库通过 DSH「自动化任务」定期检查最新 DSH 版本并修复兼容性问题（任务内容与创建方式见 [CHANGELOG](CHANGELOG.md) 与下节）。

> 任务 id 与下次运行时间由 DSH 自动化任务页面维护；本仓库只记录任务提示词，便于重建。

## 许可

[Apache-2.0](LICENSE)
