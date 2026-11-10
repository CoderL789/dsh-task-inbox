# Task 03B 技术方案：执行派发（架构验证稿）

> 状态：**架构验证完成并已实现（2026-11-10，版本 0.4.0，等待用户验收）**；开发 Agent 未创建/Fork/恢复真实 Session，也未发送真实 Prompt；下方 §0.1 记录最终实现与草案的差异。
> 环境：DSH `0.2.2-rc.1`，profile `desktop`；证据来自 `cordis_inspect_query`、已安装包的 README / 构建产物（`app.asar` 内只读）。
> 前置：Task 03A（执行前配置预览）已通过审查与核心 UI 验收，版本 0.3.1。

## 0. 核心问题与结论

**问题**：能否让 Client 通过 DSH 正常的授权链路创建、复用、Fork Session，而不是让第三方 Host 插件直接调用 `@Remote`？

**结论：可以。** 当前版本的浏览器 Client 服务已经提供：

- `ctx.sessions.create(opts): Promise<SessionId>` —— 通过已认证的 Client Remote 调 `session/create`；
- `ctx.sessions.fork(opts): Promise<SessionId>` —— 通过 Client Remote 调 `session/fork`；
- `SessionFace.prompt(content, mode, signal?, requestId?)` —— 通过 Client Remote 调 `session/prompt`，带幂等 `requestId`。

因此推荐架构为 **“Client 走正常 Remote 授权链路做会话操作与 Prompt 派发；Host 只做 public API 的重新校验与执行记录持久化”**，Host 插件**不需要**调用 `@Remote` 方法，也不需要 `sessionController.*`。

## 0.1 实现更新（2026-11-10，版本 0.4.0）

本设计稿已按用户确认的架构实现，最终实现与早期草案的差异如下（以本节为准）：

1. **新建不预分配 Session ID**：Client 调用 `ctx.sessions.create({ workspaceId })`，使用返回的**实际 Session ID**；不再生成 `proposedSessionId`。Host 只在返回后通过 `execution-session` 持久化该 id。
2. **执行记录使用独立存储域**：新增 `task_inbox_executions`（version 1，JSON 单文件 `$DSH_HOME/storages/task_inbox_executions.json`），**没有升级/迁移 Todo 域 `task_inbox`（保持 v2）**，因此现有 Todo 数据零改动、不会被清空或重写。原因是 Task 03B 记录与 Todo 分属不同生命周期，独立域可避免升级既有 Todo 域带来的风险；Todo 域与执行记录域各自使用原子整表写与恢复逻辑。
3. **创建/Fork 前先落 `dispatching`**：`execution-intent`（prepared）→ Host `execution-dispatching`（dispatching，无目标）→ Client create/fork → `execution-session`（session_ready）→ Prompt 阶段再确认 dispatching。这样同一 `clientRequestId`/execution 重试时 Host 返回非 prepared 记录，Client 不会再创建第二个 Session；若进程在 create/fork 中中断，`execution-status` 会把无目标的 dispatching 转为 `unknown`，只能通过候选会话人工核对。
4. **Host 独立核验接受结果**：只读扫描目标 Session 日志中 `user/message` 的 `source.rpcId === requestId`。Client 报告 accepted 但未核验通过时保持 `dispatching`（不误报 accepted）；Client 报告 failed 但日志已含 requestId 时纠正为 `accepted`。
5. **新增 HTTP 协调操作**：`execution-intent`、`execution-session`、`execution-dispatching`、`execution-result`、`execution-status`、`execution-candidates`、`execution-bind`、`execution-unknown`、`execution-failed`；全部走 Task 02 的同源浏览器认证。
6. **Fork/复用约束**：Fork 默认 `allowMigration:false`；无幂等键，结果不确定时不自动重试，Host 只列出候选会话供用户手动绑定。复用使用 `queue` 模式，不默认打断运行中的 Agent。
7. **未命名 Session 显示**：实现为 Client 侧 `title → 短ID · ISO 创建时间 → 短ID` 的降级显示（宿主同时返回 `createdAt`）；`docs/task-03b-design.md` 第 6 节与 `dispatch-plan.ts` 的纯函数测试保持一致。
8. **UI**：Task 03A 的“确认配置（仅预览）”已替换为真实“确认并派发”，仅在 Client `sessions` 服务可用时启用；包含派发中禁用、accepted/failed/unknown/session_ready 反馈、打开目标会话、检查状态、继续派发、候选会话人工绑定；打开页面/选择配置/刷新不会自动创建会话或发送 Prompt。
9. **验证**：`pnpm build` / `typecheck` / `check` / `test` 通过，**111/111**（Host 执行服务 + Client mock 编排）；未对真实 Workspace/Session 发起测试执行，首次真实测试由用户在 GUI 明确确认触发。

## 1. 运行时证据

### 1.1 Client 服务契约（`cordis_inspect_query` Client `Service`）

| 能力 | 契约 | 证据 |
|---|---|---|
| 创建会话 | `ISessions.create(opts?: { workspaceId?, cwd?, sessionId?, agentPreset? }): Promise<SessionId>` | `inspect:client Service.listService(service="sessions")` 的 referencedTypes `ISessions`；构建实现 `pkg:@deepseek-ai/dsh-api-session-controller/lib/client.js:3988`（`ClientSessions.create`）与 `:3336`（`SessionManager.create` → `this.remote.session.create`） |
| Fork 会话 | `ISessions.fork(opts: { sessionId, atSeq?, increaseTitle?, onCreated?, allowMigration? }): Promise<SessionId>` | 同上 referencedTypes；构建实现 `lib/client.js:4007`、`SessionManager.fork` `:3385`（`this.remote.session.fork`） |
| Prompt 派发 | `ISession.prompt(content: PromptContentPart[], mode: 'queue' \| 'steer', signal?, requestId?): Promise<RemoteResult<{ accepted: true }>>` | referencedTypes `ISession`；构建实现 `lib/client.js:2334`（`this.remote.session.prompt({ requestId, sessionId, mode, content, clientTimeZone })`） |
| 取得 SessionFace | `ctx.sessions.retain(target, { source })` → `SessionReference.ready` → `binding.session` | referencedTypes `SessionReference/SessionBinding`；`retain` 构建实现 `lib/client.js:3858`，会打开历史；`source` 取 `'controllerOperation'` |
| 会话列表刷新 | `ctx.sessions.refresh(): Promise<void>` | referencedTypes `ISessions.refresh`；用于复用前确保目标已在 Client 目录中 |
| 无导航的创建 | `SessionManager.create()` 只调 Remote 并把占位行合并进列表，**不做导航** | `lib/client.js:3336-3374`；`ClientSessions.create` `:3988-3993` |
| 无导航的 Fork | `ctx.sessions.fork()` 只调 Remote 并合并 child 占位行，**不做导航**；`uiWorkspace.forkSession` 仅额外 `increaseTitle:true` | `lib/client.js:4007-4023`；`dsh-client-ui-workspace/lib/client.js:1494-1500` |

### 1.2 权限与信任链路

- 浏览器页面通过 `dsh-client-connection` 的正常认证获得 **owner Peer**；`dsh-api-remote-access` README 明确：**“The owner (`{ kind: 'owner' }`) is never checked”**，每个 Gateway 调用仍会解析资源并可能被非 owner policy 拒绝；页面注入的 access baseline 对 owner 恒为 allow（`pkg:@deepseek-ai/dsh-api-remote-access/README.md:27,68`）。
- 因此 Client 插件的 `ctx.sessions.create/fork`、`SessionFace.prompt` 调用与宿主 UI 的其他会话操作走**同一条** Connection RPC → API Gateway → Peer 鉴权链路；不是 Host 内部绕过。
- 非 owner 页面（如 liveshare viewer）会被服务端 `remote-access/denied` 拒绝；插件必须把该错误显示给用户，**不得绕过**。
- Prompt 的 `requestId` 由服务端幂等：同一 requestId 已在队列/日志中时返回原接受结果，不重复插入（`pkg:@deepseek-ai/dsh-api-session-controller/README.md:36`）。

### 1.3 其他相关 Client 接口（本方案不使用或仅参考）

| 接口 | 结论 |
|---|---|
| `uiWorkspace.startSession(workspaceId, options)` | 返回 `void`，会**导航**到 Workspace 空白会话；`options.prompt` 只是写入草稿（draft），**不发送**。不适合后台派发。 |
| `uiWorkspace.openWorkspace(...)` | 连接并导航；不适合“不改变当前选择”的执行流程。 |
| `uiWorkspace.connectWorkspace(workspaceId)` | 内部就是 `sessions.create`（复用空白或新建），返回 SessionId，**不导航**；可作为 `create` 的备选，但 `ctx.sessions.create` 更直接、可传 `sessionId`。 |
| `uiWorkspace.forkSession(...)` | 等价于 `ctx.sessions.fork({ increaseTitle: true })`；不导航。若需要自动递增标题可用它，否则用 `ctx.sessions.fork`。 |
| `ctx.sessions.retain/using` | 取得 `SessionFace` 以调用 `prompt`；会打开历史（Remote 读取），但不改选择。 |
| `uiWorkspace.openSession` | 纯导航；不用于执行。 |

## 2. 架构对比

### 方案 A：Client 授权链路（推荐）

- 创建：`ctx.sessions.create({ workspaceId, sessionId: proposedSessionId })`
- Fork：`ctx.sessions.fork({ sessionId, allowMigration? })`（或 `uiWorkspace.forkSession` 以递增标题）
- 派发：`retain(target)` → `binding.session.prompt([{ type: 'text', text }], 'queue', signal, requestId)` → `{ accepted: true }`
- 优点：
  - 与用户 UI 操作完全相同的认证/权限链路，无 Host `@Remote` 直调；
  - `prompt` 原生 `requestId` 幂等，适合“用户只确认一次”；
  - 无导航副作用（create/fork 均不改变当前选择）；
  - SessionId 由 Host 返回，不存在第三方伪造 SessionId 的问题。
- 代价 / 限制：
  - 依赖 `dsh-api-session-controller` 的 **Client 服务契约**；`create/list` 未出现在 Client inspect 的方法目录中，但 `ISessions` 类型与构建实现均存在 → 属于“随版本发布的 Client 契约，非文档化第三方 API”，升级需回归；
  - `retain` 会建立 Client Session 生成并打开历史（网络/内存成本）；
  - 页面必须在线且已认证；页面刷新/关闭会丢失客户端进行中的上下文（恢复靠 Host 记录）。

### 方案 B：Host 公开 `agents.get/resume` + `followup`

- 复用：`ctx.agents.get(id)` 或 `ctx.agents.resume({ resumeSessionId })` → `handle.agent.followup(...)`；创建仍需 Client 或 @Remote 先产生 Session。
- 优点：public Host API（`pkg:@deepseek-ai/dsh-agent/README.md:56-70`），不依赖 Client 服务。
- 缺点：
  - Host 插件以 Host 权限行动，不经过 Browser Peer 的 Remote 授权链；
  - `followup` 没有 requestId 幂等，失败重试可能重复派发；
  - writer lock（`session/writer-held`）与 AgentHandle 生命周期/释放由插件自行管理；
  - 需要插件持有 Agent，页面关闭后执行语义与 UI 脱节。
- 结论：**仅作为 Client 路径不可用时的降级方案**，不作为 Task 03B 主路径。

### 方案 C：Host 直接调用 `sessionController.*`（`@Remote`）

- 可行但**明确不推荐**：非第三方稳定契约，且 Host 进程内调用绕过 Peer 访问策略，与本次架构目标冲突。
- 标记：**在“不绕过 Peer 鉴权”的约束下不可行**。

### 方案 D：Client `uiWorkspace.startSession` + 草稿

- 只能创建并导航、把 Prompt 写入草稿，不能提交；把“发送”留给用户手动点击，不是可靠的派发通道。**不作为执行路径。**

## 3. 推荐方案与调用链

采用 **方案 A**：Host 负责 Todo/执行记录的持久化与**派发前后重新校验**，Client 负责经授权的会话创建/Fork/Prompt。

### 3.1 新建（new）

```
用户点击“确认执行并派发”
  → Client: Host POST execution-intent { requestId, todoId, strategy:'new', workspaceId, proposedSessionId }
      Host（public APIs）重新校验：Todo 存在、Workspace 存在且 available、proposedSessionId 未占用/可复用空白
      Host 持久化 ExecutionRecord { status:'prepared', requestId, proposedSessionId, workspaceId }
  → Client: ctx.sessions.create({ workspaceId, sessionId: proposedSessionId })
      Remote session/create（Browser owner Peer）
  → Client: ctx.sessions.retain(actualSessionId, { source:'controllerOperation' })
      await reference.ready
  → Client: reference.binding.session.prompt([{type:'text', text: todoText}], 'queue', undefined, requestId)
      成功：RemoteResult { accepted: true }；失败：错误码
  → Client: Host POST execution-result { requestId, sessionId: actualSessionId, status:'accepted'|'failed', errorCode? }
      Host 再次校验 Todo/Workspace/Session（fresh）+ session 归属/非空白（只读 probe）后落库
  → Client: reference.release()
```

### 3.2 复用（reuse）

```
intent → Host 重新校验 Todo/Workspace/Source Session（存在、属于 workspace、blankState='non-blank'）
  → Client: ctx.sessions.refresh()  // 确保目标在 Client 目录
  → retain(sourceSessionId) → await ready → session.prompt(..., 'queue', ...)
  → result（Host 复核 Todo/Session 仍有效）
```

### 3.3 Fork（fork）

```
intent → Host 重新校验 Todo/Workspace/Source Session（非空白；completed-turn 仅 warning）
  → Client: ctx.sessions.fork({ sessionId: sourceSessionId, allowMigration? })
  → 得到 childSessionId（Fork 不导航；源会话不被修改）
  → retain(child) → await ready → session.prompt(..., requestId)
  → result
```

> Fork 的 `increaseTitle` 可按产品需要启用；`uiWorkspace.forkSession` 会强制递增标题。

### 3.4 为什么不用 Host @Remote / 不用 agents 路径

- Client 路径已经完全覆盖三种策略，并且使用与正常 UI 相同的授权链路；Host 只需 public API 读取校验与 storage 持久化即可，无必要引入 @Remote 绕过。
- Host `agents` 路径作为**降级**：若未来 DSH 收紧 Client `sessions.create/prompt` 契约或非浏览器场景需要派发，可评估 `agents.resume+followup`，但必须接受 writer lock、无 requestId 幂等与 Host 权限语义。

## 4. Client/Host 协调：requestId、SessionId 与执行记录

### 4.1 执行记录（Task 03B 新增，domain v3 迁移保留 v2 数据）

```ts
interface ExecutionRecord {
  executionId: string
  requestId: string            // Client 生成；同时用于 Remote session/prompt 幂等
  todoId: string               // 只引用，不复制/不覆盖 Todo
  strategy: 'new' | 'reuse' | 'fork'
  workspaceId: string
  workspacePath: string        // 执行时快照
  proposedSessionId?: string   // new：Client 预先铸造，Host 校验后交给 create
  sourceSessionId?: string     // reuse/fork
  targetSessionId?: string     // create/fork/reuse 后确认
  status: 'prepared' | 'dispatching' | 'accepted' | 'failed' | 'unknown'
  errorCode?: string
  createdAt: string
  updatedAt: string
}
```

- **只确认一次**：UI 在 confirm 后立即锁定按钮；Host 对同一 `requestId` 的 `execution-intent` 幂等（同 payload 返回原记录，payload 不同则冲突）。
- **新会话 ID 协调**：Client 先用 `crypto.randomUUID()` 生成 `proposedSessionId` 写入 intent；`sessions.create({ sessionId })` 会让该 id 成为新会话身份（若 Host 因命名空白不满足而复用/新建，会返回实际 id，Client 以实际 id 回报）。
- **复用 ID**：直接使用 Task 03A 选中的 sourceSessionId。
- **Fork ID**：由 `sessions.fork` 返回 childId；Client 在 `onCreated` 回调里也可立即回报（减少响应丢失窗口）。
- **Todo 保护**：执行记录只引用 `todoId`；任何失败都不删除/修改 Todo；Task 04 再定义完成/执行状态。

### 4.2 失败与重启恢复

| 场景 | 恢复方式 |
|---|---|
| `execution-intent` 失败 | 无副作用，提示用户重试（可复用同 requestId）。 |
| 新建：create 超时/结果未知 | 用 `proposedSessionId` 通过 public `sessionPersistence.stat/list` 检查是否已创建；同一 requestId/proposedSessionId 重试 create 是安全的（命名空白复用）；若已被 prompt 使用（非 blank）则不重试，要求用户确认。 |
| 复用：prompt 超时/结果未知 | 同一 `requestId` 重试 prompt 是安全的：Host 端已在队列/日志中则返回原接受结果，不会重复插入。 |
| Fork：fork 结果未知 | **无法自动幂等**（无 requestId，child 无 parent 关系）。禁止自动重试；Host 列出该 workspace 在 intent 时间之后新增的会话，交由用户选择/人工确认；无法确认时记录 `unknown`。 |
| Prompt 已发出但 result 上报失败 | Client 重试 result 上报（同一 requestId 幂等）；Host 恢复时也可只读扫描目标 Session 日志中的 `user/message`（requestId/rpcId）判断是否 accepted。 |
| DSH/页面重启 | Host 启动或用户打开 Task Inbox 时，对 `prepared/dispatching` 记录执行只读 reconcile：Session 是否存在、是否已有对应 requestId 的消息/轮次；无法判断则标记 `unknown`，**不自动重派**。 |

只读判断使用 public Host `sessionPersistence.open(id,'read')` 读取日志；Task 03A 已用同一方式判断 `turn/start`，不恢复 Agent、不写 Session。

## 5. Host 派发前重新校验（不信任预览快照）

Task 03A 的 `execution-context` 只是预览缓存。**真正派发前** Host 必须在 `execution-intent` 与 `execution-result` 两个时点重新读取：

1. Todo 仍存在（`TodoService`/domain 当前状态）；
2. Workspace 仍存在、路径未变、`status() === 'ok'`；
3. Source Session 仍存在、属于该 Workspace（`workspaceRegistry` 的 `sessionIds` + `sessionPersistence.stat`）；
4. 复用/Fork 的 Source 空白状态用只读日志 probe 重新判定（`turn/start`）；
5. 新建后目标 Session 已创建、属于该 Workspace、仍为 blank（首次 prompt 前）；
6. 复用/Fork 的目标/来源在 prompt 前后的归属一致。

规则已固化为纯函数 `src/host/dispatch-plan.ts`：`validateDispatchPreconditions()`（含 `not_confirmed`、`invalid_request_id`、`todo_not_found`、`workspace_unavailable`、`session_required/not_found/wrong_workspace/blank/state_unknown/not_blank`），并用 `test/dispatch-plan.test.mjs` 覆盖。该模块是 Task 03B 的校验基础，当前**未接入运行时**。

**公开 API 的能力边界**：archive 状态与「已完成轮次」无法通过 public Host 只读 API 确认，只能在真实 `session.prompt` 时由 Host Remote 的归档 gate/会话规则最终裁决；记录失败时应把 Remote 错误码原样落库，而不是提前断言可执行。

## 6. 未命名 Session 的显示（已纳入设计）

Task 03A 的 `execution-context` 已返回 `title?` 与 `createdAt?`。Task 03B 选择会话时按以下优先级显示，禁止所有未命名会话都显示同一个 “Untitled”：

1. Host 有标题 → `title`；
2. 无标题但有 `createdAt` → `短ID · ISO 创建时间`（例如 `1a2b3c4d · 2026-11-10T11:09:55.804Z`）；
3. 都没有 → `短ID`（sessionId 前 8 位）。

已固化为纯函数 `describeSessionChoice()`（同上模块/测试），保证两个未命名会话可区分。

## 7. 风险与限制

| # | 风险/限制 | 影响 | 缓解 |
|---|---|---|---|
| 1 | `sessions.create/list` 未出现在 Client inspect 方法目录，仅见 `ISessions` 类型与构建实现 | 可能是“随版本发布的 Client 契约”，非文档化第三方 API；升级可能变化 | Task 03B 前在目标版本回归验证；把依赖点集中到一个小模块；失败时明确降级为“派发不可用” |
| 2 | `retain` 会打开历史并建立 Client generation | 额外网络/内存；若历史不完整可能 ready 失败 | 仅有目标的 prompt 需要 retain；失败不派发并提示 |
| 3 | Fork 无幂等键 | 未知结果可能产生重复 child | 不自动重试；只读列出候选交用户确认；记录 unknown |
| 4 | 新建 create 可能因命名 blank 复用规则返回不同 id | 执行关联必须用实际返回 id | 以 `sessions.create` 返回值为准回报 Host |
| 5 | 页面刷新/关闭中断协调 | 客户端无法完成 result 上报 | Host execution record + 只读 reconcile；不自动重派 |
| 6 | 公开 Host API 无法确认 archive/completed-turn | 预览/预检可能过于乐观 | Remote prompt 是最终裁决；失败原样记录错误码 |
| 7 | 非 owner 页面/Peer | Remote 调用被 `remote-access/denied` | 显示错误，不绕过；本插件面向 owner 页面 |
| 8 | 依赖浏览器连接 | 断线时无法派发 | 提示连接状态；intent 落库后不自动重试，用户确认后重试 |
| 9 | Prompt accepted ≠ 执行完成 | 用户可能误以为完成 | UI 明确“已接受，执行中”；状态机/历史在 Task 04 |

## 8. Task 03B 实施步骤（尚未开始）

1. Host：新增 `execution-intent` / `execution-result`（或等价）只读校验与记录操作；domain v3 增加 `executions` 表（保留 v2 数据）。
2. Client：确认按钮接入 `sessions.create/fork/retain/prompt`；加入 Host intent/result 协调；错误码映射与中英文文案；执行中/失败/不确定 UI。
3. 恢复：只读 reconcile（`sessionPersistence` + execution records），不自动重派；Fork unknown 人工确认。
4. 测试：纯函数（校验/命名）+ Service/API 单测 + 真实 `node:http` 桥接测试；Client 交互人工验收。
5. 验收：三种策略真实执行、仅用户确认触发、失败不丢 Todo、重启可判断、不绕过权限。

## 9. 待确认问题

1. 是否接受依赖 Client `ctx.sessions.create/fork` + `SessionFace.prompt` 这一“shipped Client 契约”（非文档化第三方 API）？
2. “会话已创建但 prompt 未接受”时，UI 是否允许用户选择“重试 / 放弃并保留空会话 / 记录 unknown”？
3. Fork 未知结果的人工确认流程是否需要专门的会话选择列表？
4. Task 04 的“执行完成”语义是否在 prompt accepted 后由 `turn/end` 事件判定（本轮仅预留执行关联）。
