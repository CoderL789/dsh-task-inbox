# Task 03B 技术方案：执行派发

> 状态：设计稿（Task 03B 尚未实现）。基于 2026-11-10 安装的 DSH `0.2.2-rc.1` 运行时 inspect 验证结果。
> Task 03A 只做执行前配置预览，不创建/恢复/Fork 真实 Session，不发送 Prompt。

## 1. 目标与边界

- Todo 保持独立；只有用户显式点击“执行并确认”后才可能派发。
- 三种策略：新建会话、复用已有会话、从已有会话 Fork。
- 执行操作必须先落“意图/关联记录”，再调用 DSH；任何失败都不能丢失原 Todo。
- Task 03B 预留执行关联字段；完整执行状态机/历史列表属于 Task 04。

## 2. API 可行性结论（三种策略）

| 策略 | 首选 API | 性质 | 可行性 / 限制 |
|---|---|---|---|
| 新建 | Host `ctx.sessionController.create({ workspaceId?, cwd?, agentPreset? })` → `{ sessionId }` | `@Remote`（Host 进程内可调，面向 Client 网关设计） | 可行但非第三方稳定契约；会直接创建 Agent；命名空白 Session 复用规则见 README；需校验 workspace 存在。 |
| 新建（备选） | `ctx.agents.create({ sessionId, meta: { cwd }, agentOptions })` | public Host API | 需要显式 `SessionId`，而当前没有公开的第三方 SessionId 铸造入口（`sessionController.create` 是文档中的创建入口），因此不单独使用。 |
| 复用 | `ctx.agents.get(sessionId)` → `agent.followup(...)`；冷会话先 `ctx.agents.resume({ resumeSessionId })` → `handle.agent.followup(...)` | public Host API | 可行；`AgentHandle.agent` 支持 `followup/steer/inject/cancel/whenIdle`。需要 writer lock：同一 Session 已被其它 writer 持有时 resume 会失败（`session/writer-held`）。 |
| 复用（备选） | `ctx.sessionController.prompt({ requestId, sessionId, mode, content })` → `{ accepted: true }` | `@Remote` | 服务端自动 resume 并返回 accepted；`requestId` 幂等（已在队列/日志中则返回原接受结果）。绕过 Peer 访问策略，按 ⚠️ 处理。 |
| Fork | `ctx.sessionController.fork({ sessionId, atSeq?, allowMigration? })` → `{ sessionId }` | `@Remote` | 文档明确 create/fork 是“唯二直接创建新 Agent 的操作”；省略 `atSeq` 复制最近完成轮次前缀，源会话不被修改；冷可读。 |
| Fork（备选） | Host `ctx.sessions.fork(source, boundary?, childSessionId?)` → `Session` | public Host API | 只能从**活着的**源 Session 复制，且返回 `Session` 而非 Agent；如何为 child Session 合法创建 Agent 没有公开文档路径，不建议作为 Task 03B 主路径。 |

**结论**：Task 03B 若要真正派发，最现实的实现是 Host 进程内调用 `sessionController.create/fork/prompt`（`@Remote`，⚠️ 非第三方契约），复用已有会话则优先用 public `agents.get/resume + agent.followup`。必须在方案与 UI 中标注 API 稳定性风险，并接受版本升级回归成本。

## 3. Session ID 如何合法产生

- 新建：`sessionController.create()` 返回的 `sessionId` 是唯一受支持的“新建会话”身份来源；不要自行铸造。
- Fork：`sessionController.fork()` 返回 child `sessionId`。
- 复用：使用既有 Session 的 id（来自公共 `workspaceRegistry.sessionIds` / `sessionPersistence.list`）。
- 不使用 `sessions.create()` 的 `session-<n>` 自动 id 直接派发（该 Session 不由 Agent 生命周期拥有）。

## 4. 冷会话恢复

- `ctx.agents.resume({ resumeSessionId })` → `AgentHandle`；`handle.agent.followup(...)` 唤醒并投递。
- 若另一 writer 持有：`session/writer-held`，应提示用户“会话正被其它客户端/Agent 占用”，不要重试抢占。
- 也可用 `sessionController.prompt` 让其服务端完成 resume；同样需要处理 writer/not-found/agent-busy 错误。
- 恢复后必须持有 handle 直到执行结果确认或超时；插件卸载时释放（`handle.dispose()` / effect disposer）。

## 5. Fork 语义与源会话保护

- `sessionController.fork({ sessionId, atSeq })` 复制 **inclusive event prefix**，返回独立 Session；不设置 `parentSession`（普通 fork）。
- 省略 `atSeq` = 最近完成 turn 及独立尾部；源会话上的 open turn 由合成 closers 处理，源日志不改写。
- 若源需要迁移（migration-required），`allowMigration` 由用户显式授权；默认不迁移。
- Fork 本身不修改源会话；但派发到 fork child 的 prompt 只写 child。
- 标题：UI 可用 `increaseTitle` 语义（Task 03B 若走 `sessions.fork` 的 Client 面才强制递增；Host `sessionController.fork` 不自动递增，需自行 rename 或接受默认标题）。

## 6. 如何确认 Agent 已接受、避免重复派发

1. 派发前持久化一条 `execution` 记录（见 §7），状态 `dispatching`，携带 `requestId`（客户端/服务端生成并持久化）。
2. 投递：
   - 复用：`agent.followup({ content, source: { kind: 'user' } })` 后 `await agent.whenIdle()` 或监听 `session/event` 的 `user/message`；
   - 或 `sessionController.prompt({ requestId, ... })` → 必须收到 `{ accepted: true }`。
3. 接受判定：`prompt` accepted / `followup` 不抛错且能在 Session 日志中观察到对应 `requestId` 的 durable `user/message`（`rpcId`）后才标记 `accepted`。
4. 幂等：同一逻辑执行使用固定 `requestId`；`prompt` 对已接受的 requestId 返回原接受结果，不重复插入。`followup` 没有内建 requestId 幂等，必须由插件在重试前先查询日志确认。
5. 失败：超时/异常时记录 `unknown`，**不得盲目重发**；先通过 Session 日志确认是否已写入，再决定重试或标记失败。

## 7. Todo ↔ Workspace / Session 的持久绑定

在插件域中新增 `executions` 表（Task 03B 时做一次 domain version+1 迁移，保留 `todos` 数据）：

```ts
interface ExecutionRecord {
  executionId: string          // uuid
  todoId: string               // 原 Todo 引用，不复制/不覆盖 Todo
  strategy: 'new' | 'reuse' | 'fork'
  workspaceId: string
  workspacePath: string        // 执行时快照，防止 workspace 改名/删除后无法追溯
  sourceSessionId?: string     // reuse/fork 的来源
  sessionId?: string           // 创建/复用/fork 后的目标会话
  requestId: string            // 派发幂等键
  status: 'dispatching' | 'accepted' | 'failed' | 'unknown'
  errorCode?: string
  createdAt: string
  updatedAt: string
}
```

- `todoId` 仅引用，Todo 内容永不因执行失败被删除或改写。
- `workspaceId/path` 与 `sessionId` 双写：workspace 被删除时仍能显示历史；session 被归档时标记不可继续。
- Task 04 在此表上扩展状态机/历史，不需要重新设计关联。

## 8. 失败与重启恢复

- 意图记录先落盘（`dispatching` + requestId），再调用 DSH。
- 进程重启后：扫描 `dispatching/unknown` 记录：
  1. 若 `sessionId` 已知：读取该 Session 事件，按 `requestId`/内容匹配确认是否已接受；
  2. 已接受 → 标记 `accepted`；
  3. 明确未接受 → 标记 `failed`，允许用户手动重试（新 requestId 或复用原 requestId 视 API 幂等能力而定）；
  4. 无法判定 → 保持 `unknown`，UI 提示用户检查会话，不自动重发。
- DSH 重启导致 Agent 消失时，复用策略可重新 `agents.resume`；新建/fork 已产生 Session 则保留 Session，Todo 仍为 `todo`（Task 04 再定义完成语义）。

## 9. 用户触发与安全约束

- 只有用户点击“执行”并在配置面板明确确认后才允许派发；打开页面、选择工作区/会话、查看 Todo 都不得触发任何 Session/Agent 操作。
- 配置面板必须展示 Todo 内容、Workspace、策略、来源 Session，并区分“预览”与“真实派发”；Task 03A 阶段始终显示“派发未接通”。
- 权限：派发不得绕过 DSH 的审批/权限模型；`@Remote` 的 Peer 授权在 Host 内调用时被绕过，需在 Task 03B 记录该风险或改用受支持的 Host API。
- 不修改源 Session 内容；Fork 不写源日志；归档/运行中会话的适用性在派发时由 Host 最终裁决。

## 10. 待决问题（Task 03B 前）

1. `sessionController.*` 作为 `@Remote` 在第三方插件中的稳定性与授权边界；是否需要向 DSH 申请官方 Host API。
2. `agents.resume/followup` 的 writer lock 与 AgentHandle 生命周期细节（插件卸载/超时释放）。
3. Fork 后是否需要重命名（`increaseTitle`）以及 rename 失败的处理。
4. `requestId` 在 `followup` 路径上的可观测性（user/message `rpcId`）与去重查询方式。
5. Execution 记录与 Todo 的 domain 迁移（v3）及旧 v2 数据兼容。
