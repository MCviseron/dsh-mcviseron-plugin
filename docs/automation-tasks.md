# 会话内编辑官方自动化任务

## 问题

DSH 官方的 `schedule_create/list/update/delete` 只在声明了
`@deepseek-ai/dsh-tool-schedule` 的 preset 中注册。当前会话的工具面里没有它们，
所以模型只能直接改 `%USERPROFILE%\.dsh\storages\schedule.json`；运行中的 Schedule
服务还持有内存副本，改了文件也不立即生效，必须重启。

## 补丁

新增 `automation-tasks` 组件，通过 Host 的 `ctx.schedule` 服务注册四个工具：

| 工具 | 作用 |
|---|---|
| `automation_task_list` | 列出当前会话绑定的任务，返回 id、title、prompt、时间信息 |
| `automation_task_create` | 创建任务，必须给 title、prompt 和恰好一个时间选择器 |
| `automation_task_update` | 按 id 原地修改 title / prompt / 时间选择器 |
| `automation_task_delete` | 按 id 删除任务 |

时间选择器：

- `after_seconds`：创建时的相对延迟；
- `at`：RFC 3339 绝对时间；
- `every_seconds`：固定间隔，至少 60 秒；
- `daily`：`{ time, time_zone }`；
- `weekly`：`{ time, time_zone, weekdays }`；
- `cron`：`{ expression, time_zone }`。

## Host Schedule 管理 API

组件不直接编辑 `schedule.json`，只调用 Host 的 `ctx.schedule` 服务。DSH 0.2.2
与旧版接口不同，组件用 `typeof schedule.edit === 'function'` 探测并分层适配：

### DSH 0.2.2+

```ts
// 列表：分页信封
const page = await schedule.list({}, exec.signal)
// page.items: ScheduleTask[]

// 创建：request 带 target，sessionId 作为绑定参数
const task = await schedule.create({
  title: '...',
  prompt: '...',
  timing: { kind: 'weekly', weekly: { time: '09:00', time_zone: 'Asia/Shanghai', weekdays: [6] } },
  target: { kind: 'session', sessionId },
}, sessionId, exec.signal)

// 修改 / 删除：统一走 edit
await schedule.edit({ id, action: 'update', patch }, sessionId, exec.signal)
await schedule.edit({ id, action: 'delete' }, sessionId, exec.signal)
```

### 旧版 API

```ts
const tasks = await schedule.list({ sessionId }, exec.signal) // ScheduleTask[]
const task = await schedule.create(sessionId, request, exec.signal)
await schedule.update(sessionId, id, patch, exec.signal)
await schedule.delete(sessionId, id, exec.signal)
```

### 工具参数到 timing 的映射

| 工具参数 | Host timing |
|---|---|
| `after_seconds` | `{ kind: 'after', after_seconds }` |
| `at` | `{ kind: 'at', at }` |
| `every_seconds` | `{ kind: 'every', every_seconds }` |
| `daily` | `{ kind: 'daily', daily }` |
| `weekly` | `{ kind: 'weekly', weekly }` |
| `cron` | `{ kind: 'cron', cron }` |

`listRecords()` 同时接受 `ScheduleTask[]` 和 `{ items: ScheduleTask[] }`，避免
0.2.2 升级后 `.find is not a function`。旧 API 的 update/delete 只在新 API 缺失时
才使用。

## 自动存盘

工具直接调用 `ctx.schedule`；该方法负责持久化，和官方自动化任务 UI 使用同一个
存储。模型不需要、也不应该再编辑 `schedule.json`，不需要重启 DSH 让任务内容生效。

## 使用

在会话中直接说：

> 把当前自动化任务的 prompt 改成……，每周六 09:00 执行

模型会先 `automation_task_list` 找 id，再 `automation_task_update`；结果直接落盘。

## 限制

- 只操作**当前会话绑定**的任务；
- 子 agent 调用会被 Schedule 服务按官方规则拒绝；
- 任务时间规则最终由 Host Schedule 校验；
- 工具注册依赖 Host 的 `schedule` 服务，缺失时组件不注册并写诊断日志。
