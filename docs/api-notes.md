# DSH Task Inbox — API 调研笔记

> 目的：为 Task Inbox 后续阶段（会话创建/复用、fork、Workspace 管理、消息派发、数据持久化、UI 扩展点）记录**已核实**的 DSH API。
> 调研时间：2026-11-10 16:42–17:05（Asia/Shanghai）。
> 运行环境：DSH profile `desktop`，`DSH_HOME=C:\Users\liuxuedong\.dsh`，GUI `http://127.0.0.1:59553`。
> 安装版本：`@deepseek-ai/dsh-desktop-runtime` **0.2.2-rc.1**，`@deepseek-ai/cordis` **4.1.0**（证据：`pkg:@deepseek-ai/dsh-desktop-runtime/package.json` — 该文件位于 `app.asar/dsh/package.json`，第 4 行 `"version": "0.2.2-rc.1"`；`pkg:@deepseek-ai/dsh-client-ui-workspace/package.json:51` `"@deepseek-ai/cordis": "~4.1.0"`）。

## 证据标签与可用性图例

证据格式（本文每条断言都带其一）：

| 标签 | 含义 |
|---|---|
| `inspect:host/<Provider>.<method>(...)` | 实时 `cordis_inspect_query` 结果（host 平台） |
| `inspect:client/...` | 实时 `cordis_inspect_query` 结果（client 平台）——本次调研**全部超时**，见风险节 |
| `pkg:<包名>/<相对路径>:<行>` | 已安装包内文件（`app.asar` 内，用 read 工具读取；客户端 `.d.ts` 已被发行包裁剪，签名取自 README 与打包后的 `lib/client.js`） |
| `skill-ref:<文件名>:<行>` | 本机 `cordis-plugin-development` skill 的 reference 文件（DSH 官方插件开发文档） |

可用性图例：

- ✅ **已确认**：实时 inspect 或包文档明确给出，且非保留 API。
- ⚠️ **可调用但非第三方设计**：方法存在、可注入调用，但契约面向 DSH 内部或 Remote/UI 通道，未承诺第三方稳定性。
- 🚫 **保留/内部**：文档明示保留、实验或禁止第三方使用。
- ❓ **未确认**：本次调研无法核实（含 client 侧实时 inspect 超时）。

> 重要前提：本次 **client 侧实时 inspect（Service/Event/Builtin/Slots/Theme）连续 6 次超时**（16:42–17:05，每次 10s），报错原文 `Client inspect query ... timed out after 10000ms. Open or reconnect the Harness page, then retry.`。因此第 F 节 UI 与第 A/B 节 client 侧结论主要来自**已安装包 README + 打包后的 `lib/client.js`**（打包文件通过只读解析 `app.asar` 头后解到系统临时目录核对行号，行号与 `app.asar` 内同名文件一致），并用 read 工具抽查复核。所有依赖实时 Slot 树/Token 列表的结论均标记 ❓。
>
> **Lead 复核（2026-11-10 17:00 前后）**：Task 01 安装完成后，client 侧实时 inspect 已恢复正常；实时结果见文末「附：Lead 实时 client inspect 复核」，其中 Slot/Token 结论可直接替代对应 ❓ 项。

---

## A. 会话创建与复用（Session creation / reuse）

### A.1 Host 侧服务契约（实时 inspect 原文签名）

| 接口 | 签名（逐字） | 用途 | 可用性 | 证据 |
|---|---|---|---|---|
| `ctx.agentLoop.create` | `async create(id: SessionId, options: AgentOptions = {}, meta: Pick<SessionHeader, 'cwd'> = {}): Promise<Agent>` | 以调用方提供的 id 创建 agent+session，归当前 fiber 所有；有持久化后端时先落库再发布 | ⚠️ 低级原语，官方推荐走 `ctx.agents.create` | `inspect:host Service.listService(service="agentLoop")` |
| `ctx.agentLoop.createAgent` | `async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle>` | 显式传入 owner context 的受管创建 | ⚠️ factory 级原语（`dsh-agent-loop` 实现） | 同上 |
| `ctx.agentLoop.resume` | `async resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle>` | 从持久化恢复 agent | ⚠️ factory 级原语 | 同上 |
| `ctx.agents.create` | `async create(options: CreateAgentOptions): Promise<AgentHandle>` | **公开**的程序化创建入口（README 明确“Plugins and hosts create agents through `ctx.agents.create()`”） | ✅ | `inspect:host Service.listService(service="agents")`；`pkg:@deepseek-ai/dsh-agent-loop/README.md:61` |
| `ctx.agents.resume` | `async resume(options: ResumeAgentOptions): Promise<AgentHandle>` | **公开**的恢复入口 | ✅ | 同上 |
| `ctx.agents.get` | `get(id: SessionId): Agent \| undefined` | 取活着的 agent | ✅ | `inspect:host Service.listService(service="agents")` |
| `ctx.agents.list` / `roots` | `list(): Agent[]` / `roots(): Agent[]` | 枚举 live agent | ✅ | 同上 |
| `ctx.sessionController.create` | `@Remote('create') create(request: SessionCreateRequest): Promise<SessionCreateValue>` | 等价 UI 的“新建会话”：可复用命名空白会话、指定 workspace/cwd/preset | ⚠️ Remote（面向 Client 的网关方法；host 进程内可直接调，但会绕过 Peer 访问策略） | `inspect:host Service.listService(service="sessionController")` |
| `ctx.sessionController.resolveAgent` | `resolveAgent(sessionId: SessionId): Promise<ApiSessionAgentResult>` | “Resolve or resume one ordinary Session for another Host API domain” | ⚠️ 面向其它 Host API 域的受控入口，非通用插件 API | 同上 |
| `ctx.sessionController.list` | `@Remote('list') async list(_request: SessionListRequest, signal: AbortSignal): Promise<SessionListValue>` | 不唤醒 Agent 的会话列表 | ⚠️ Remote | 同上 |

关键类型（`inspect` 原文，仅摘必要字段）：

```ts
interface CreateAgentOptions {
    readonly sessionId: SessionId;
    readonly parentAgent?: Agent;
    readonly meta?: {
        readonly cwd?: string;
        readonly parentSession?: SessionId;
        readonly isSeeded?: boolean;
        readonly origin?: 'subagent';
        readonly delegationDepth?: number;
        readonly agentPreset?: string;
    };
    readonly inheritedEventCount?: SessionLogOffset;
    readonly seed?: readonly SessionEvent[];
    readonly agentOptions?: AgentOptions;   // { provider?, model?, reasoningEffort?, maxTokens? }
    readonly signal?: AbortSignal;
    readonly setup?: AgentSetup;
}
interface ResumeAgentOptions {
    readonly resumeSessionId: SessionId;
    readonly parentAgent?: Agent;
    readonly agentOptions?: AgentOptions;
    readonly signal?: AbortSignal;
    readonly setup?: AgentSetup;
}
interface AgentHandle { agent: Agent; dispose(): Promise<void>; }
interface Agent { readonly id: SessionId; }   // inspect 投影只暴露 id；可驱动方法见 A.3
```

`sessionController` 的请求/响应类型（`inspect` 原文）：

```ts
interface SessionCreateRequest {
    readonly workspaceId?: WorkspaceId;
    readonly cwd?: string;
    readonly sessionId?: SessionId;
    readonly agentPreset?: string;
}
interface SessionCreateValue { readonly sessionId: SessionId; readonly agentPreset?: string; }
```

语义补充（文档证据）：

- `session.create` 的“复用空白会话”规则：命名 `sessionId` 仅当仍 blank（未开始 turn）、属于请求目录、是请求 Workspace 的未归档成员、且无其它 writer 时复用；否则新建。复用/新建都会运行请求的 `agentPreset`（未指定则用默认）。命名 Session 在其它目录 → `session/conflict`；被 subagent 路由占用 → `session/agent-busy`。（`pkg:@deepseek-ai/dsh-api-session-controller/README.md:48`）
- `agents.create` 的运行归属：`AgentHandle` 是唯一能精确销毁该 agent 的句柄；“The loop runs each created agent to completion — the handle is only needed when the caller must tear the agent down itself.”（`pkg:@deepseek-ai/dsh-agent-loop/README.md:61`）
- `parentAgent` 决定运行时子关系；省略即运行时根。（`pkg:@deepseek-ai/dsh-agent/README.md:32`）

### A.2 Client 侧（UI 页面才可用，Host 插件不可调用）

| 接口 | 签名（取自构建产物） | 用途 | 可用性 | 证据 |
|---|---|---|---|---|
| `ctx.uiWorkspace.startSession` | `startSession(workspaceId, options)` | 新建/复用 Workspace 空白会话并导航；`options` 可含 `agentPreset`、`prompt`、`whenDraftExists: 'keep' \| 'replace' \| 'append'`、`clearPreviousDraft` | ⚠️ Client 服务（仅页面内可用） | `pkg:@deepseek-ai/dsh-client-ui-workspace/lib/client.js:1502`；`pkg:.../README.md:116` |
| `ctx.uiWorkspace.connectWorkspace` | `connectWorkspace(workspaceId, options = {})` | 连接/创建 Workspace 的空白会话（返回 sessionId Promise；同一 preset 的并发请求合并） | ⚠️ Client 服务 | `pkg:.../lib/client.js:1399` |
| `ctx.uiWorkspace.openSession` | `openSession(target)` | 同步替换主视图引用，target 为已知 Session id 或 durable direct-parent subagent address | ⚠️ Client 服务 | `pkg:.../lib/client.js:1473`；`pkg:.../README.md:86` |
| `ctx.uiWorkspace.openWorkspace` | `openWorkspace(workspaceId, beforeOpen, options = {})` | 打开 Workspace 空白会话；被后续导航取代时不再提交 UI | ⚠️ Client 服务 | `pkg:.../lib/client.js:1476` |
| `ctx.sessions.create` | `sessions.create(request)`（`request` 同 `SessionCreateRequest` 形状） | Client 侧创建会话包装（内部走 Remote `session.create`），供 `uiWorkspace` 使用 | ⚠️ Client 服务 | 调用点 `pkg:@deepseek-ai/dsh-client-ui-workspace/lib/client.js:1440`（`const sessionId = await this.sessions.create(request)`） |
| `ctx.sessions.binding` / `refreshProjections` | `binding(id)` / `refreshProjections(sessionId)` | 绑定/刷新本地会话投影 | ⚠️ Client 服务 | 调用点 `pkg:.../lib/client.js:1524`、`1455` |
| `ctx.layout.selectPanel` | `selectPanel(panelId)` | 选择已注册的主面板；`null` 选择 Conversation | ⚠️ Client 服务 | `pkg:@deepseek-ai/dsh-client-ui-layout/lib/client.js:522`；`pkg:.../README.md:36` |

`SessionTarget` 语义（逐字类型，host inspect）：

```ts
type SessionAddress =
    | { readonly kind: 'session'; readonly sessionId: SessionId }
    | { readonly kind: 'subagent';
        readonly parentSessionId: SessionId;
        readonly childSessionId: SessionId;
        readonly mode: 'one-shot' | 'continuable' | 'unknown'; };
```

Client 引用 target 的语义：`sessions.retain(target, { source, signal? })` 的 target 是“known Session id or a durable direct-parent subagent address”，Host 在打开历史时校验显式 address。（`pkg:@deepseek-ai/dsh-api-session-controller/README.md:84`；`inspect:host Service.listService(service="sessionController")` 中 `SessionAddress`）

### A.3 Host 插件 vs UI-only 结论

- **第三方 Host 插件可用**：`ctx.agents.*`（create/resume/get/list）、`ctx.agentLoop.*`（低级）、`ctx.sessions.*`（内存 store）、`ctx.workspaceRegistry`、`ctx.workspaceController`（Remote 面）、`ctx.workingDirectory`、`ctx.workspaceFiles`（Remote 面）。
- **仅 UI（Client）可用**：`ctx.uiWorkspace`、`ctx.sessions`（client 服务）、`ctx.layout`、`ctx.slots`、`ctx.locale`、`ctx.theme`。Host 插件不能调用这些服务（它们是浏览器半边注册的 Cordis 服务）。
- ⚠️ `ctx.agentLoop.create` 的返回是 `Agent` 而非 `AgentHandle`，ownership 在“accessing fiber”；插件若绕过 `ctx.agents.create` 自行调用，需要自己承担生命周期，不建议。

---

## B. 会话 fork

| 接口 | 签名（逐字/构建产物） | 用途 | 可用性 | 证据 |
|---|---|---|---|---|
| Client `sessions.fork` | `async fork(opts)`；`opts` 含 `sessionId`、`atSeq?`、`allowMigration?`、`increaseTitle?`、`onCreated?` | Client 侧 fork：调 Remote `session.fork`，成功后把子会话合入本地 summaries；`increaseTitle` 在成功后按递增标题 rename 子会话 | ⚠️ Client 服务（UI 用） | `pkg:@deepseek-ai/dsh-api-session-controller/lib/client.js:4007`（JSDoc 见 `:3994-4005`；manager 层见 `:3385`） |
| `ctx.uiWorkspace.forkSession` | `async forkSession(sessionId, onCreated, options)` → 内部 `this.sessions.fork({ sessionId, increaseTitle: true, ...(onCreated ? { onCreated } : {}), ...(options?.allowMigration !== void 0 ? { allowMigration: options.allowMigration } : {}) })` | 页面 fork：不导航、不取代待处理导航；**强制**递增标题 | ⚠️ Client 服务 | `pkg:@deepseek-ai/dsh-client-ui-workspace/lib/client.js:1494-1500`；`pkg:.../README.md:86` |
| Host `ctx.sessions.fork` | `fork(source: SessionForkSource, boundary?: SessionSeq, childSessionId?: SessionId): Session`（`type SessionForkSource = Session \| SessionId`） | 从**活着的**源 Session 的精确前缀创建独立 in-memory Session；boundary 为 inclusive seq，省略=当前最后事件；开放尾部补合成 tool result 与 turn/step closer | ✅ Host 内存 store API | `inspect:host Service.listService(service="sessions")` |
| `ctx.sessionController.fork` | `@Remote('fork') async fork(request: SessionForkRequest): Promise<SessionForkValue>`；`SessionForkRequest = { sessionId: SessionId; atSeq?: number; allowMigration?: boolean }`，返回 `{ sessionId: SessionId }` | 从**冷可读**的精确事件前缀 fork 出新 Session；`atSeq` 省略=最近完成 turn 的前缀；未找到事件报错 | ⚠️ Remote（host 可调但非第三方设计）；文档指出 create/fork 是“唯二直接创建新 Agent 的操作” | `inspect:host Service.listService(service="sessionController")`；`pkg:@deepseek-ai/dsh-api-session-controller/README.md:36` |

语义/限制（文档证据）：

- `session.fork` 复制的是“inclusive event prefix”，可切在开放 turn 内；子会话**不带** `parentSession`；`atSeq` 省略时选“最近完成的 turn 及其独立尾部”，不存在的事件被拒绝；聊天动作只选已完成 turn。（`pkg:@deepseek-ai/dsh-api-session-controller/README.md:67`）
- Client UI 的 fork 走“普通冷历史”读取；Host 报 migration-required 时只提示并导航，不重试；成功后用源的最后一个完成 turn，并通过 Session Controller 递增继承的持久标题，**不 retain 子会话、不打开历史、不改选择**。（`pkg:@deepseek-ai/dsh-client-ui-workspace/README.md:64`）
- 快捷键 fork 的限制：源必须是“已 retain 的主视图 Session 且导航已请求打开历史”；缺失或空白 Session 不可用；Host 拒绝“无完成 turn”的源；失败不改选择并给出本地化提示。（`pkg:@deepseek-ai/dsh-client-ui-workspace/README.md:70`）
- 标题：`increaseTitle: true` 时客户端用 `increasedForkTitle(sourceTitle)` 再 `rename`；rename 失败会抛 `Error`（fork 已成功但标题没涨）。（`pkg:@deepseek-ai/dsh-api-session-controller/lib/client.js:4018-4021`）
- ❓ **未确认**：`allowMigration` 除“透传 Host 的迁移许可”外，客户端没有本地 preflight 逻辑；Host 端具体迁移判定未在文档展开。
- ❓ **未确认**：Host 插件用 `ctx.sessions.fork` 得到的是 `Session`（无 Agent）；给它配 Agent 的官方路径未见文档示例（`ctx.agents.create` 需要显式 `sessionId`，是否可指向刚 fork 的 session id 未验证）。UI 路径（`sessionController.fork`）由 Host 直接创建新 Agent，因此更接近可用路径，但它是 Remote 面。

---

## C. Workspace 管理

### C.1 Host 服务

| 接口 | 签名（逐字） | 用途 | 可用性 | 证据 |
|---|---|---|---|---|
| `ctx.workspaceRegistry.create` | `async create(path: string, title?: string): Promise<Workspace>` | 为**已存在目录**创建/复用一个 Workspace；路径经 `fs.realpath` 规范化；相对/不存在/非目录拒绝；同 canonical path 重复调用返回既有实体且不改标题；新建项插到最前 | ✅ | `inspect:host Service.listService(service="workspaceRegistry")` |
| `ctx.workspaceRegistry.initializeDefault` | `initializeDefault(resolveDirectory: () => Promise<string>): Promise<Workspace \| undefined>` | 仅在 registry 与 session 历史均为空时创建默认 Workspace | ✅ | 同上 |
| `ctx.workspaceRegistry.get` / `list` | `get(id: WorkspaceId): Workspace \| undefined`；`list(): Workspace[]` | 取/列出 Workspace（`sessionIds` 已按 canonical-cwd 索引过滤，无持久化读取） | ✅ | 同上 |
| `ctx.workspaceRegistry.delete` | `delete(id: WorkspaceId): Promise<boolean>` | 删除注册项，保留目录与全部 session 日志 | ✅ | 同上 |
| `ctx.workspaceRegistry.insertBefore` | `insertBefore(id: WorkspaceId, beforeId?: WorkspaceId): Promise<readonly WorkspaceId[]>` | 调整持久显示顺序（DOM-insertBefore 语义） | ✅ | 同上 |
| `ctx.workspaceRegistry.archiveSession` | `archiveSession(sessionId: SessionId, options: ArchiveSessionOptions = {}): Promise<void>`，`ArchiveSessionOptions = { readonly stopActivity?: boolean }` | 持久归档；不带 `stopActivity` 时会话必须 inactive，否则 `WorkspaceActiveSessionError`；带 `stopActivity` 则停止工作；归档会同时丢弃 pin | ✅ | 同上 |
| `ctx.workspaceRegistry.unarchiveSession` | `unarchiveSession(sessionId: SessionId): Promise<void>` | 取消归档，不恢复 pin、不改位置 | ✅ | 同上 |
| `ctx.workspaceRegistry.pinSession` / `unpinSession` | `pinSession(sessionId: SessionId): Promise<void>` / `unpinSession(sessionId: SessionId): Promise<void>` | pin/unpin 会话（pin 会前插，且要求会话存在且未归档） | ✅ | 同上 |
| `ctx.workspaceRegistry.resolveByPath` | `async resolveByPath(path: string): Promise<Workspace \| undefined>` | 按 canonical 路径查 Workspace，不创建不修改；路径缺失实时 reject | ✅ | 同上 |

`Workspace` 实体（逐字）：

```ts
interface Workspace {
    readonly id: WorkspaceId;
    readonly path: string;
    readonly title: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly sessionIds: readonly SessionId[];
    setTitle(title: string): Promise<void>;
    attachSession(sessionId: SessionId): Promise<void>;
    insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void>;
    detachSession(sessionId: SessionId): Promise<void>;
    status(): Promise<'ok' | 'missing-dir'>;
}
```

### C.2 Remote / Client 面

| 接口 | 签名（逐字） | 用途 | 可用性 | 证据 |
|---|---|---|---|---|
| `ctx.workspaceController.create` | `@Remote('create') create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateValue>`；`{ path: string }` → `{ workspace: WorkspaceView; created: boolean }` | 创建或幂等解析 Workspace | ⚠️ Remote | `inspect:host Service.listService(service="workspaceController")` |
| `ctx.workspaceController.initializeDefault` | `@Remote('initializeDefault') async initializeDefault(signal: AbortSignal): Promise<WorkspaceValue \| undefined>` | 首次使用的默认 Workspace | ⚠️ Remote | 同上 |
| `ctx.workspaceController.rename` | `@Remote('rename') rename(request: WorkspaceRenameRequest): Promise<WorkspaceValue>`；`{ workspaceId, title }` | 重命名（唯一非空标题） | ⚠️ Remote | 同上 |
| `ctx.workspaceController.delete` | `@Remote('delete') delete(request: WorkspaceDeleteRequest): Promise<WorkspaceDeleteValue>` | 删除注册项（保留文件与 Session） | ⚠️ Remote | 同上 |
| `ctx.workspaceController.insertBefore` / `insertSessionBefore` | `insertBefore(...)`: `{ workspaceId, beforeWorkspaceId? }`；`insertSessionBefore(...)`: `{ workspaceId, sessionId, beforeSessionId? }` | 调整 Workspace / 组内 Session 顺序 | ⚠️ Remote | 同上 |
| `ctx.workspaceController.archiveSession` / `unarchiveSession` / `pinSession` / `unpinSession` | `archiveSession(request: WorkspaceArchiveSessionRequest): Promise<WorkspaceArchiveValue>`（request 含 `sessionId`, `stopActivity?`）；其余为 `{ sessionId }` → `{ archivedSessionIds }` / `{ pinnedSessionIds }` | 归档/置顶 | ⚠️ Remote | 同上 |
| `ctx.workspaceController.follow` | `@Remote({ mode: 'stream' }) async *follow(signal: AbortSignal): AsyncIterable<WorkspaceFollowFrame>` | 完整 baseline + 增量（`baseline`/`replace`/`upsert`/`remove`/`order`/`archived`/`pinned`） | ⚠️ Remote stream | 同上 |
| `ctx.workingDirectory.defaultDirectory` / `get` / `ensure` / `set` | `readonly defaultDirectory: string`；`get(session: Session): string`；`ensure(agent: Agent, signal?: AbortSignal): Promise<string>`；`set(agent: Agent, path: string, signal?: AbortSignal): Promise<string>` | Session 的有效工作目录与变更（`set` 不改已有进程/权限） | ✅ | `inspect:host Service.listService(service="workingDirectory")` |
| `ctx.workspaceFiles.read` / `readBytes` / `stat` / `list` / `changes` | `@Remote async read(workspaceFileScope: WorkspaceFileScope, path: string, range: WorkspaceFileRange, signal: AbortSignal): Promise<WorkspaceFileText>` 等 | 在合成文件系统上读文件/列目录/watch 变更 | ⚠️ Remote（Host 侧可调用但面向 Client） | `inspect:host Service.listService(service="workspaceFiles")` |
| `ctx.directoryPicker.capability` | `abstract capability(): DirectoryPickerCapability` | 目录选择能力声明（Host 侧仅此一个抽象方法） | ⚠️ 抽象能力；真正 pick 走 Remote | `inspect:host Service.listService(service="directoryPicker")` |
| `ctx.directoryPickerController.pick` / `list` / `createDirectory` | `@Remote('pick') async pick(signal: AbortSignal): Promise<string \| null>` 等 | 原生目录选择/列目录/建目录 | ⚠️ Remote | `inspect:host Service.listService(service="directoryPickerController")` |

### C.3 Workspace ↔ path ↔ session 映射结论

- Workspace 只有 `id/title/path`，**不存 session 列表的派生缓存**；`sessionIds` 由启动/实时 canonical-cwd header 索引过滤得到（`inspect:host Service.listService(service="workspaceRegistry")`，`list()` 描述）。
- 会话归属用 canonical `cwd`：`SessionSummary.cwd`、`SessionHeader.cwd`、`WorkspaceView.path` 同源；`workspaceRegistry.create` 拒绝非目录，`session.create` 指定其它目录会 `session/conflict`（`pkg:@deepseek-ai/dsh-api-session-controller/README.md:48`）。
- 把一个新建 session 挂到 Workspace：`Workspace.attachSession(sessionId)`（`inspect` 原文）或 `workspaceController.insertSessionBefore`（Remote）。
- 删除 Workspace 只删注册项；会话与目录都保留（`workspaceRegistry.delete` 描述 + `pkg:@deepseek-ai/dsh-client-ui-workspace/README.md:64` “retention boundary”）。

---

## D. Agent 消息派发（第三方面向）

### D.1 结论速览（推荐路线）

1. **新建会话 + 指定 Workspace 派发 prompt（Host 插件，最接近“自己拥有”的路线）**
   - 取/建 Workspace：`ctx.workspaceRegistry.resolveByPath(path)` 或 `create(path, title)`；
   - 建会话与 Agent：`ctx.agents.create({ sessionId, meta: { cwd: workspace.path }, agentOptions })` → `AgentHandle`；
   - 挂到 Workspace：`await workspace.attachSession(sessionId)`；
   - 派发：`handle.agent.followup({ content: [...], source: {...} })`；
   - 跟踪完成：`await handle.agent.whenIdle()`，或监听 `session/event`（`turn/end`）；最后 `await handle.dispose()`（若插件拥有生命周期）。
   - 证据：`pkg:@deepseek-ai/dsh-agent/README.md:56-70`；`pkg:@deepseek-ai/dsh-agent-loop/README.md:61`；`inspect:host Service.listService(service="agents")` / `workspaceRegistry`；`followup/steer/inject/cancel/whenIdle` 实现见 `pkg:@deepseek-ai/dsh-agent-loop/lib/index.js:570-639`。
   - ❓ 未确认：`SessionId` 的公开铸造入口。`agents.create` 要求显式 `sessionId`，而 `SessionStore.create()` 的 `session-<n>` 自动分配只在 `ctx.sessions.prepare/create`（session store）内部；官方文档没有给出第三方生成 `SessionId` 的函数（可考虑用 `sessionController.create()` 返回的 id，但那是 Remote 面）。
2. **等价的 UI 行为（不建议第三方 Host 插件依赖）**
   - `ctx.sessionController.create({ workspaceId, sessionId?, agentPreset? })` → `{ sessionId }`，随后 `ctx.sessionController.prompt({ requestId, sessionId, mode: 'queue' | 'steer', content, clientTimeZone? })`。
   - 证据：`inspect:host Service.listService(service="sessionController")` 的 `create`/`prompt` 签名与 `SessionPromptRequest`；语义见 `pkg:@deepseek-ai/dsh-api-session-controller/README.md:36`（prompt 会先显式 resume；requestId 幂等：已在队列/日志中则返回原接受结果）。
   - 属性：⚠️ 两个方法都标 `@Remote`，契约是“网关给 Client 的”；host 进程内调用会绕过 `dsh-api-remote-access` 的 Peer 策略（README:38），不是第三方 API。

### D.2 已有会话的派发

| 目标 | 路径 | 签名/证据 | 可用性 |
|---|---|---|---|
| 活着的 Agent | `ctx.agents.get(sessionId)` → `agent.followup(input)` / `agent.steer(input)` / `agent.inject(input)` | `get(id: SessionId): Agent \| undefined`（inspect:agents）；`followup(input)` `steer(input)` `inject(input)`（`pkg:@deepseek-ai/dsh-agent-loop/lib/index.js:570-578`；语义 `pkg:@deepseek-ai/dsh-agent/README.md:56-70`） | ✅（Agent 公开面） |
| 冷会话 | `ctx.agents.resume({ resumeSessionId })` → `handle.agent.followup(...)` | `inspect:host agents`；`pkg:@deepseek-ai/dsh-agent/README.md:30-32` | ✅ |
| 冷会话（不自己持有 Agent） | `ctx.sessionController.prompt({ requestId, sessionId, mode, content })` | `inspect:host sessionController`；README:36 | ⚠️ Remote |
| 任意普通 Session → Agent | `ctx.sessionController.resolveAgent(sessionId)` | inspect 原文 “Resolve or resume one ordinary Session for another Host API domain” | ⚠️ 受控入口 |

补充事实（`inspect:host Event.listEvents`）：

- `agent/inbox/inserted` / `claimed` / `discarded`（emit）：inbox 变化通知；
- `agent/status`（emit）：`idle` ⇄ `running`；
- `session/event`（emit，post-commit）、`turn/end` 在 session 日志中，完成判定以日志/`whenIdle()` 为准，不要轮询 `agent/status`（`skill-ref:practices.md:28`）。
- `Agent.inbox` 的 structural 接口（`append/prepend/replace/remove/clear/splice`）存在（`pkg:@deepseek-ai/dsh-agent/README.md:104`），但它是高级/结构层 API，属于 ⚠️。

### D.3 fork 会话的派发

- Host：`ctx.sessionController.fork({ sessionId, atSeq?, allowMigration? })` → 新 `sessionId`（且该操作会创建新 Agent，README:36），随后用 `sessionController.prompt` 或 `agents.get/resume + followup`。
- Client/UI：`uiWorkspace.forkSession(sessionId, onCreated, { allowMigration })` → 子 id；随后 `openSession(childId)` 或经由 `sessions.retain(childId, {source})` 打开。
- ❓ 未确认：纯 Host 插件路径中，`ctx.sessions.fork` 产出的 `Session` 如何合法获得可驱动的 Agent（无文档示例）；建议优先评估 `sessionController.fork`，但须接受其为 Remote 面的事实。

### D.4 候选 API 的排除结论

| 候选 | 结论 | 证据 |
|---|---|---|
| `ctx.subagents.sendMessage` | 仅限“sender 的 direct parent 或 direct continuable child”，且要求 sender 是 exact live Agent；不能对任意会话派发 | `inspect:host Service.listService(service="subagents")` 方法描述 |
| `ctx.subagents.prompt` | `@Remote` 面向 Client 的 continuable 子代理消息 | 同上；`SubagentPromptRequest` 含 `parentSessionId/childSessionId/mode:'continuable'/delivery` |
| `ctx.commands.execute` | 执行“斜杠命令”，不是模型 prompt 替代品；需要 exact agent | `inspect:host Service.listService(service="commands")` |
| `ctx.agentTeams.sendMessage` | 仅 Team Lead/teammate 关系；实现包名 `@deepseek-ai/dsh-experimental-agent-team`（Config 目录中 `include:agent-team` 条目）→ 实验性 | `inspect:host agents`/`agentTeams` 签名；`inspect:host Config.listConfigs`（page 2，`include:agent-team`） |
| `appendPluginRecord()` | 仅用于写入 `ignorable` 的 `plugin:` 记录，文档明示“reserved for DSH's experimental packages”，迁移时仅 best-effort | `skill-ref:practices.md:21` |

---

## E. 数据持久化

| 方案 | 契约/签名 | 用途 | 可用性 | 证据 |
|---|---|---|---|---|
| **storageDomain 自建域（推荐给 Task Inbox 的 todo 数据）** | `async open<S extends DomainSpec>(spec: S): Promise<Domain<S>>`；`defineDomain({ name, version, tables: { t: domainTable(zodSchema) } })`；`Domain.table(name)` 返回 `KvTable`；`Domain.global.get()/set(value)`；`Domain.close(): Promise<void>` | schema 校验的持久 KV 域；读同步自内存、写先落盘且按写链串行；每次写 emit `domain/changed` | ✅（`dsh-storage-domain` 是已安装/已配置行） | `inspect:host Service.listService(service="storageDomain")`；`pkg:@deepseek-ai/dsh-storage-domain/README.md:34-58`；`inspect:host Config.listConfigs` 中 `include:storage-domain` / `include:storage-json` 均为 `schema` 状态 |
| `KvTable` 方法 | `get(key): V \| undefined`；`entries(): IterableIterator<[K, V]>`；`keys()`；`readonly size: number`；`put(key, value): Promise<void>`；`delete(key): Promise<boolean>`；`deleteMany(keys): Promise<number>`；`update(key, fn): Promise<V>` | 表读写 | ✅ | `inspect:host Service.listService(service="storageDomain")` 的 `KvTable` 声明 |
| 域路由配置 | `backend`（默认后端名，必填）、`routes`（domain name → backend name）；`backend-not-found` 在 open 阶段报错 | 指定域落到哪个 backend | ✅ | `pkg:@deepseek-ai/dsh-storage-domain/README.md:62-69` |
| storage hub | `readonly backend: BackendRegistry`；`mount<K extends keyof StorageForms>(form: K, facility: StorageForms[K]): () => void`；`form<K extends keyof StorageForms>(form: K): StorageForms[K]` | 表单设施挂载/解析（域由 storageDomain 提供，业务插件一般不需要 mount） | ⚠️ 面向 form 所有者；`StorageForms` 在 inspect 投影中为空接口 → ❓ 运行时挂了哪些 form 未确认 | `inspect:host Service.listService(service="storage")` |
| 插件 Config + configEditor | `entries(): Entry[]`；`configuration(): Array<{ entry; inherited; override }>`；`async edit(entry: Entry, change: (current, inherited) => Record<string, unknown>): Promise<void>`；用法 `ctx.get('configEditor')`，`change` 返回整行完整 config | 运行期持久化自己的配置（普通字段会重启插件；`.volatile()` 字段原地生效） | ✅（但需当前 profile 存在 configEditor；缺失时报错给用户） | `inspect:host Service.listService(service="configEditor")`；`skill-ref:host-plugin.md:68-77` |
| credentials | `resolve(ref)`；`describe(ref)`；`set(ref, value)`；`unset(ref)`；`readRecord(key)`；`describeRecord(key)`；`listRecords()`；`modifyRecord(key, mutate)`；`deleteRecord(key)` | 密钥/凭据（不要写进 config） | ✅（抽象服务，需注入 `credentials`） | `inspect:host Service.listService(service="credentials")`；`skill-ref:host-plugin.md:77` |
| session projections | `apply(state, event)` / `stateOf()`（`ctx.sessionProjections`），纯同步、同引用不发布 | **仅**用于从 session 日志派生状态；不是插件自有数据的持久化 | ✅（推荐用于会话派生状态）但 ❓ 本次未查询该服务的确切契约 | `skill-ref:practices.md:26-28` |
| `appendPluginRecord()` | 写入 `ignorable: true` 的 `plugin:` 记录 | 往 session 日志写入插件记录 | 🚫 保留/实验：会涉及 Session 格式迁移，仅 best-effort 保留 | `skill-ref:practices.md:21` |

持久化选择建议（基于上述证据）：

1. Task Inbox 自己的 todo 数据 → 使用独立 `defineDomain`（`ctx.storageDomain.open`），表 key 用 todo id，value 用 zod schema；写入即持久化，不进入 session 日志、模型不可见（storage-domain README:126-137）。
2. 用户可调参数 → 插件 `Config`；运行期保存 → `configEditor.edit`。
3. 敏感值 → `ctx.credentials.modifyRecord`（`skill-ref:host-plugin.md:77`）。
4. 不要用新 session 事件 `type`；不要用 `appendPluginRecord`（保留）。
5. ❓ 未确认：`ctx.fiber.entry` 在第三方插件中是否总是可用（`skill-ref:host-plugin.md:70-75` 给出该写法，但本次未在运行时验证）。

---

## F. UI 扩展点（页面已在 Task 01 实现，本节点用于后续维护）

| 接口/契约 | 逐字签名或结论 | 用途 | 可用性 | 证据 |
|---|---|---|---|---|
| `sidebar.panellist` 列表 Slot | 声明：`"sidebar.panellist": { kind: "list", scope: "root" }` | 侧边栏全局面板入口（图标 + label） | ✅（声明来自已安装代码；实时 Slot 树 ❓） | `pkg:@deepseek-ai/dsh-client-ui-sidebar/lib/client.js:749-752` |
| `main` keyed Slot | 声明：`"main": { kind: "keyed", scope: "root" }`；渲染 `renderSlot("main", {}, { entryKey: panelId ?? "conversation" })` | 全局主面板容器；**`conversation` 是保留 key**（表示 Conversation） | ✅（同上；实时 Slot 树 ❓） | `pkg:@deepseek-ai/dsh-client-ui-layout/lib/client.js:713-716`、`:127`；`pkg:@deepseek-ai/dsh-client-ui-layout/README.md:36` |
| 面板 id 与 main 对齐 | “Plugins add an icon component to the root-scoped `sidebar.panellist` list with an `id`, optional `order`, and a string or locale-aware `label`. The same id addresses the component registered in the layout's root-scoped `main` keyed slot; selecting a missing main entry throws without changing the current selection.” | 同一 `id` 注册两张表；`key` 选项即 main keyed 的 key | ✅ | `pkg:@deepseek-ai/dsh-client-ui-sidebar/README.md:42`；built: `pkg:@deepseek-ai/dsh-client-ui-layout/lib/client.js:697-699`（`entries("main")` 读取 `options.key`） |
| `ctx.slots.inject` | `inject(key, callback)`；`callback` 返回一个 disposer 或 disposer 可迭代集合；声明不存在时等声明，collapsed 时销毁贡献，恢复后重装 | 依赖声明生命周期注册 Slot 贡献 | ✅ | `pkg:@deepseek-ai/dsh-client-ui-renderer/lib/client.js:1368-1427`（service 为 `slots`，`super(ctx, "slots")` 见 `:1347-1348`）；`skill-ref:practices.md:36` |
| `ctx.slots.register` | 包装 `SlotRegistry.prototype.register = function register(rawOptions, component) { ... ctx.effect(() => this._register(options, component), "slots.register()") }`；注册选项形状见示例：`ctx.slots.register({ name, id, order, locale, inject }, Component)` | 注册列表项/单槽/keyed 项 | ✅ | `pkg:@deepseek-ai/dsh-client-ui-renderer/lib/client.js:1813-1815`；选项形状 `pkg:@deepseek-ai/dsh-client-ui-workspace/README.md:181-188` |
| `ctx.layout.selectPanel` | `selectPanel(panelId)`；`null` 选择 Conversation；未注册 key 抛错且不改变当前面板 | 从插件 UI 跳转全局面板 | ✅ | `pkg:@deepseek-ai/dsh-client-ui-layout/lib/client.js:522-525`；`pkg:.../README.md:36`、`:63` |
| `ctx.layout.beginNavigation` | 返回用于异步 UI 导航的 `AbortSignal`（后续 `selectPanel` 会 abort 它，但不取消底层 Session 创建） | 页面导航防竞态 | ✅ | `pkg:@deepseek-ai/dsh-client-ui-layout/README.md:63` |
| `sidebar.panellist.actions`（More 菜单） | 注册项收到 `entries`（`id`, `label`, `pinned`, `active`）、`onOpen(id)`、`onPinnedChange(id, pinned)`、`onDismiss()` | 面板列表 “More” 菜单 | ✅ | `pkg:@deepseek-ai/dsh-client-ui-sidebar/README.md:44` |
| `usePanelInfo` Hook | 面板行读取自身选中态；搜索/目录选择器聚焦不会改变显示面板 | 侧边栏行选中态 | ✅（React Hook，仅 Client） | `pkg:@deepseek-ai/dsh-client-ui-sidebar/README.md:42` |
| Client locale `register` | `ctx.locale.register(ns, { zh, en, ja })`（对象形式必须含 `zh`+`en`）；按语言包形式 `ctx.locale.register('common', 'it', { ... })` | 注册命名空间字典 | ✅ | `pkg:@deepseek-ai/dsh-client-locale/README.md:40`、`:54-59`；built: `pkg:@deepseek-ai/dsh-client-locale/lib/client.js:1675` |
| Client locale `bind` | `ctx.locale.bind(ns)` → 绑定翻译函数；slot 渲染文案随语言切换实时更新 | 组件内取翻译函数 | ✅ | `pkg:@deepseek-ai/dsh-client-locale/README.md:40`；built: `.../lib/client.js:1702` |
| `ctx.locale.resolveText` / `addLanguage` | `resolveText(text)`；`addLanguage({ id, label, fallback })` | 解析 `LocalizedText` / 注册语言包 | ✅ | `pkg:@deepseek-ai/dsh-client-locale/README.md:44`、`:54`；built `.../lib/client.js:1529`、`:1585` |
| 主题 tokens | `--dsw-alias-*` token 通过 CSS 消费；`--dsw-*` 由 ui-theme 发布；禁止字面色（美术除外）；`ctx.theme` 可注册第三方主题（alias token 覆盖） | 页面配色/字体跟随宿主 | ✅（文档），❓ 具体 token 清单（Theme.listTokens 超时未取得） | `skill-ref:practices.md:34`；`pkg:@deepseek-ai/dsh-client-ui-theme/README.md:28`、`:44`；`pkg:@deepseek-ai/dsh-client-ui-layout/README.md:51` |
| Client 模块加载格式 | `window.__ModuleLoader__.load({ id: "<包名>", factory: (require) => { ... } })`；模块内 `require("react")` 等来自浏览器模块表 | 浏览器半边打包格式 | ✅ | `pkg:@deepseek-ai/dsh-client-ui-workspace/lib/client.js:1-11`；`skill-ref:ui-plugin.md:9` |
| `dsh.client` manifest 字段 | `platform`（如 `"web"`）、`immediately`、`inject`（仅排序激活，允许）、`external`（非 baseline 运行时 import）；示例：`"dsh": { "client": { "inject": [...], "platform": "web" } }` 与 `"client": { "external": ["@deepseek-ai/dsh-api-gateway/client"], ... }` | 浏览器插件清单 | ✅ | `skill-ref:ui-plugin.md:3`；`pkg:@deepseek-ai/dsh-client-ui-workspace/package.json:45-57`；`pkg:@deepseek-ai/dsh-api-session-controller/package.json:45-56` |
| Client 原始组件 import | 🚫 不要 `require('@deepseek-ai/dsh-client-ui-primitives')` 或任何其它 Harness Client 包；`inject` 项只用于激活顺序 | 避免内部依赖 | 🚫（官方明文禁止） | `skill-ref:practices.md:35` |

---

## G. 兼容性风险

| 风险 | 具体事实 | 影响 | 证据 |
|---|---|---|---|
| 版本耦合 | 安装的 desktop runtime 与全部 `@deepseek-ai/dsh-*` 包固定为 `0.2.2-rc.1`；cordis peer `~4.1.0` | 插件跨版本升级可能失效；签名随包版本变化 | `pkg:@deepseek-ai/dsh-desktop-runtime/package.json:4`（即 `app.asar/dsh/package.json`）；`pkg:@deepseek-ai/dsh-client-ui-workspace/package.json:51` |
| Client 类型被裁剪 | 已安装的客户端包内 **没有 `lib/types/**/*.d.ts`**（read 工具对这些路径返回 not found）；签名只能取自 README 与 `lib/client.js` | 第三方 Client 插件无法获得编译期类型保障，只能按文档/实现对齐 | 本次对 `@deepseek-ai/dsh-client-ui-workspace/lib/types/index.d.ts` 与 `lib/types/client/index.d.ts` 的 read 均返回 not found |
| `@Remote` 不是第三方 API | `sessionController`/`workspaceController`/`subagents.prompt` 等方法标 `@Remote`，服务于 API Gateway + `dsh-api-remote-access` Peer 策略；Host 进程内调用绕过访问控制 | 直接调用会绕过授权模型，且契约未承诺第三方稳定 | `inspect:host Service.listService(service="sessionController")`；`pkg:@deepseek-ai/dsh-api-session-controller/README.md:36-38` |
| Client 服务不可在 Host 插件使用 | `uiWorkspace`/`sessions`/`layout`/`slots`/`locale`/`theme` 均在浏览器半边（built 内 `super(ctx, "slots")`、`rootCtx.reflect.provide("sessions", ...)`） | Host 插件不能调用；页面逻辑必须写在 Client 半边 | `pkg:@deepseek-ai/dsh-client-ui-renderer/lib/client.js:1347-1348`；`pkg:@deepseek-ai/dsh-api-session-controller/lib/client.js:3856` |
| Session 日志规则 | 不能 append 新 `type`：live `Session.append()` 不能设置 `ignorable: true`，含未知 type 的日志将无法 reopen；`appendPluginRecord()` 属实验保留 | 任务/todo 状态不要写进 session 事件 | `skill-ref:practices.md:21` |
| 未知事件/旧读者兼容 | 未知 type 仅当 envelope 带 `ignorable: true` 才被接受；迁移会重写部分记录 | 写入自定义事件是长期兼容风险 | 同上 |
| Slot/主题/本地化耦合 | Slot key 与 token 名可随版本改名；插件应只依赖 `--dsw-alias-*` 语义 token、locale 服务、公开 Slot key | 改名会降级样式而非破坏渲染，但 key 改名会直接失效 | `skill-ref:practices.md:34`；`pkg:@deepseek-ai/dsh-client-ui-sidebar/README.md:42` |
| 面板 key 冲突 | `main` keyed Slot 使用 `entryKey`；`conversation` 为保留 key；同 id 在 `sidebar.panellist` 与 `main` 必须一致 | id 冲突/缺失会 throw 或无法选中 | `pkg:@deepseek-ai/dsh-client-ui-layout/lib/client.js:127`；`pkg:@deepseek-ai/dsh-client-ui-layout/README.md:36` |
| 实验性 packages | Agent Teams 的实现包是 `@deepseek-ai/dsh-experimental-agent-team`；`appendPluginRecord` 仅实验包保留 | 不应作为 Task Inbox 的基础设施 | `inspect:host Config.listConfigs`（page 2 `include:agent-team`）；`skill-ref:practices.md:21` |
| 会话归档/停止语义 | 归档不带 `stopActivity` 时若会话有活动会 reject；带 `stopActivity` 会停止工作，后续唤醒被 `agent/pre-step` gate 挡住 | 自动归档排队任务可能中断运行中的 turn | `inspect:host workspaceRegistry.archiveSession` 描述；`pkg:@deepseek-ai/dsh-api-session-controller/README.md:79` |
| 写入 owner 竞争 | 同名 Session 的并发 resume/fork 有 writer lock / `session/writer-held`；`session.create` 对命名空白的复用有严格条件 | 多插件并发操作同一会话易冲突 | `pkg:@deepseek-ai/dsh-api-session-controller/README.md:48`、`:69` |

---

## 风险与未验证项（收口）

**实时 client inspect 不可用（影响最大）**

- 2026-11-10 16:42–17:05 期间，`client` 平台 `Service.listService`、`Event.listEvents`、`Builtin.listBuiltins`、`Slots.listSubTree`、`Theme.listTokens` **全部 6 次 10s 超时**，错误一致：`Client inspect query ... timed out after 10000ms. Open or reconnect the Harness page, then retry.` 因此：
  - ❓ Client Service/Event 的**实时**方法清单与签名（本文 client 侧签名来自已安装包 README 与 `lib/client.js`）；
  - ❓ `Slots.listSubTree` 实时 Slot/Factory 树（本文 Slot 声明来自 ui-layout/ui-sidebar 的内置注册代码，而非实时树）；
  - ❓ `Theme.listTokens` 的完整 `--dsw-alias-*` token 清单；
  - ❓ `Builtin.listBuiltins` 的纯 JS 符号表。
  - 复现方式：页面打开/刷新后重试以上 5 个 query；或由 Lead 在已连接页面环境下重跑，补上实时证据。

**其它未确认项**

1. ❓ 第三方 Host 插件铸造 `SessionId` 的官方入口（`agents.create` 需要显式 id；`SessionStore` 的自动 id 只在 session store 内部）。
2. ❓ Host 侧 `ctx.sessions.fork` 得到 `Session` 后，给它配 Agent 的官方路径（无文档示例）。
3. ❓ `PromptContentPart` 的完整类型联合（inspect 只给出 `content: readonly PromptContentPart[]`，未展开声明）。`SessionPromptRequest.mode` 与 `requestId` 语义已确认（幂等）。
4. ❓ `storage` 的 `StorageForms` 运行时挂载清单（inspect 投影为空接口 `export interface StorageForms {}`）。
5. ❓ `sessionProjections` 服务的确切方法签名（本文只引用了 practices.md 的 `apply/stateOf` 结论，未查询该 Service）。
6. ❓ `ctx.fiber.entry` 在第三方插件中的可用性与稳定性（`skill-ref:host-plugin.md:70-75` 写法，本次未运行验证）。
7. ❓ `WorkspaceFileScope` / `WorkspaceFileRange` 的字段形状（workspaceFiles inspect 未展开）。
8. ❓ `increaseTitle` 的标题递增算法细节（只确认调用 `increasedForkTitle(sourceTitle)` + `rename`，算法在客户端 bundle 内部）。
9. ❓ `allowMigration` 的 Host 迁移判定细节。

**结论使用建议**

- 后续阶段优先使用 **Host 稳定面**：`ctx.agents.create/resume (+ followup/steer/inject/whenIdle)`、`ctx.workspaceRegistry` + `Workspace.attachSession`、`ctx.storageDomain` 自建域、`Config/configEditor`、`credentials`。
- UI 页面沿用 Task 01 已验证的 `sidebar.panellist` + `main` keyed slot + `ctx.slots.inject/register` + `ctx.locale` + `--dsw-alias-*` token；不要 import Client primitives。
- 不把 `sessionController.*`、`uiWorkspace.*`、`sessions.fork` 当作第三方契约；若使用，按 ⚠️ 处理并做好版本升级回归。

---

## 附：Lead 实时 client inspect 复核（2026-11-10 约 17:00）

> 本节补充上文队友调研期间 client 侧超时未能取得的实时证据。查询环境：Task 01 安装完成后、已连接的 Harness Web GUI（profile `desktop`，`http://127.0.0.1:59553`）。

### 附.1 Client Service 实时目录（`inspect:client Service.listService`）

实时返回的服务键包括：`layout`、`locale`、`sessions`、`slots`、`theme`、`timer`、`uiWorkspace`、`workspaces`。与 Task Inbox 直接相关的签名：

| 服务 | 实时签名 |
|---|---|
| `ctx.slots` | `inject(key: keyof SlotMap & string, callback: () => SlotInjectionEffect): () => void`；`register(rawOptions, component)`（注册即 `ctx.effect` 追踪，随 fiber 销毁） |
| `ctx.locale` | `register(ns: string, locale: string, dict: LocaleDict): () => void`；`bind(ns: string): Translate`；`subscribe(fn: () => void): () => void`；`getLocale()` / `getSnapshot()` |
| `ctx.layout` | `selectPanel(panelId: MainPanelId \| null): void`；`beginNavigation(): AbortSignal`；`toggleSidebar()`；`openRightbar(track, fullscreen)` |
| `ctx.sessions`（client） | `fork(opts): Promise<SessionId>`（`opts` 含 `sessionId`、`atSeq?`、`increaseTitle?`、`onCreated?`、`allowMigration?`）；`retain/using/scope/binding/refreshProjections/search` |
| `ctx.uiWorkspace` | `startSession(workspaceId?, options?)`、`connectWorkspace(workspaceId, options?)`、`openSession(target)`、`openWorkspace(workspaceId, beforeOpen?, options?)`、`forkSession(sessionId, onCreated?, options?)`、`archiveSession/unarchiveSession`、`pickDirectory/listDirectory/createDirectory` |
| `ctx.workspaces` | `create({path})`、`rename(workspaceId, title)`、`delete(workspaceId)`、`archiveSession/unarchiveSession/insertSessionBefore` |

### 附.2 Slot 实时树（`inspect:client Slots.listSubTree`）

- `root` 子树包含 `sidebar` 与 `main`。`sidebar.panellist`：`kind: list`、`scope: root`，注册选项 `id`（必填）、`order?`、`label?: string \| (() => string)`；ownerProps 为 `{ size: number; active: boolean }`（图标组件入参）；catalog 明确：每个 panellist id 对应 `main` 的主面板，sidebar 拥有按钮并从列表元数据解析 label。
- `main`：`kind: keyed`、`scope: root`，purpose 为 “Central panel selected by sidebar entry id”，注册选项只有 `key`（必填）；已有 key `conversation`（保留，承载 Conversation），**未占用的 key 不绑定 Session**。
- 安装后实时占用：`sidebar.panellist` = `plugins`(0)、`schedules`(10)、`task-inbox`(20)，均 `active: true`；`main` 同样新增 `key: task-inbox`，`active: true`。
- 同时确认 Host Loader 行：`include:task-inbox`（`moduleName: dsh-task-inbox`）`enabled: true`、`fiberPhase: active`（`plugin_manager list_plugins`）。

### 附.3 主题 tokens 实时清单（`inspect:client Theme.listTokens`）

全部要求 light/dark 覆盖：`--dsw-alias-bg-base`、`--dsw-alias-bg-layer-1`、`--dsw-alias-bg-layer-2`、`--dsw-alias-bg-overlay`、`--dsw-alias-border-l1`、`--dsw-alias-border-l2`、`--dsw-alias-brand-primary`、`--dsw-alias-label-primary`、`--dsw-alias-label-secondary`、`--dsw-alias-state-error-primary`、`--dsw-alias-state-idle-primary`、`--dsw-alias-state-success-primary`、`--dsw-alias-state-warn-primary`、`--dsw-specific-sidebar-fill`。

Task 01 页面仅使用 `bg-base`、`bg-layer-1/2`、`border-l1`、`label-primary/secondary`、`brand-primary`。

### 附.4 Task 01 实现与本节证据的对应关系

- Client 模块声明 `dsh.client.inject: ["@deepseek-ai/dsh-client-ui-layout"]`；`main` 由该包声明，`sidebar.panellist` 由 `@deepseek-ai/dsh-client-ui-sidebar` 声明（两者均在 web-app 中激活，inject 仅用于激活排序，实际注册由 `ctx.slots.inject` 等待声明完成）。
- Task 01 使用 `ctx.locale.register(ns, locale, dict)` 的**单语言**形式分别注册 `en` / `zh`（与 F 节的对象形式等价，均受支持）；`ctx.locale.bind(ns)` 在渲染时读取当前语言，组件订阅 `ctx.locale.subscribe` 以在切换语言后重绘。
- 以上实时证据替代 F 节中标注为 ❓ 的 Slot 树、注册选项、Theme token 三类结论；A/B 节中 client 侧签名也已由附.1 实时确认（`sessions.fork`、`uiWorkspace.*`、`layout.selectPanel`）。

---

## 附：Task 02 实现确认（2026-11-10）

本节记录 Task 02 实际采用的存储与 Host/Client 通信方案，以及对应证据与限制。实现源码见 [src/host/domain.ts](../src/host/domain.ts)、[src/host/store.ts](../src/host/store.ts)、[src/host/service.ts](../src/host/service.ts)、[src/host/api.ts](../src/host/api.ts)、[src/host/index.ts](../src/host/index.ts)、[src/client/index.ts](../src/client/index.ts)。

### 1. 插件自有持久化（`ctx.storageDomain`，已确认可用）

- 采用普通 spec 对象直接调用 `ctx.storageDomain.open(spec)`：
  `{ name: 'task_inbox', version: 1, layout: 'single', tables: { todos: { valueSchema: z.object({...}) } } }`。
- 名称规则：存储后端的 `UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/`（`pkg:@deepseek-ai/dsh-storage/lib/index.js:80`），因此域名 / 表名使用下划线（`task_inbox` / `todos`），不能用连字符。
- 不导入 `@deepseek-ai/dsh-storage-domain` 的 `defineDomain` / `domainTable`（已安装包不保证对第三方插件可解析），而是构造同形状 spec；运行时 `open()` 对已存记录调用 `tableSpec.valueSchema.parse(raw)`（`pkg:@deepseek-ai/dsh-storage-domain/lib/index.js:397`），因此使用 `zod@4.4.3`（与 storage-domain 依赖版本一致，见其 `package.json`），无需依赖 `defineDomain` 的加载期校验。
- 落盘位置：JSON 后端 `root` 为 `$DSH_HOME/storages`，`single` 布局为 `<root>/<unit>.json`（`pkg:@deepseek-ai/dsh-storage-json/README.md:12,36,50,80-90`），即 `$DSH_HOME/storages/task_inbox.json`；缺失文件在首次写入时创建，写入为原子替换。
- 生命周期：`Domain.close()` 在插件的 `ctx.effect` disposer 中调用；storage-domain 文档明确“调用方拥有 handle”（`pkg:@deepseek-ai/dsh-storage-domain/README.md:58`）。
- 运行时证据：插件安装后 API 路由可用（401 认证拦截），说明 `apply` 已完成 `storageDomain.open()` 并注册路由；若域打开失败，`apply` 会抛出、路由不会存在。

### 2. Client ↔ Host 通信（同源 HTTP 端点，已确认可用）

- 未使用 `@Remote` / typert 生成协议，而是选择一个**插件专属的同源 HTTP 端点**：
  - Host：`ctx.webServer.register({ kind: 'exact', path: '/plugins/dsh-task-inbox/api', handler })`（`inspect:host Service.listService(service="webServer")` 的 `register` 契约；`WebRoute` 的 exact/prefix 类型已确认）；
  - 认证：每个请求调用 `ctx.connection.requestRejection({ headers })`（`inspect:host Service.listService(service="connection")`，文档描述为“Apply Connection's Host/Origin checks and browser authentication to another Web route”），返回 401/403 时直接拒绝；
  - Client：`fetch('/plugins/dsh-task-inbox/api', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' } })`；浏览器自动携带同源 HttpOnly Cookie。
- 不使用 Connection 的 `/api` 共享通道（该路径由 API Gateway / Connection 拥有，见 `pkg:@deepseek-ai/dsh-client-connection/README.md:34`），避免与官方 RPC 路由冲突。
- 运行时证据：未认证 `POST` 实测返回 `401` + `{"ok":false,"error":{"code":"unauthorized",...}}`；GET 返回 405；说明路由已注册且认证栅栏生效。

### 3. 插件内部 API 契约（供后续阶段维护）

| op | 请求 | 成功 data | 说明 |
|---|---|---|---|
| `list` | `{op:'list'}` | `{todos: Todo[]}` | 按 `order`、`createdAt`、`id` 排序 |
| `create` | `{op:'create', title, description?, requestId}` | `{todo}` | `requestId` 用于快速重复提交去重（内存 10 分钟 / 200 条） |
| `update` | `{op:'update', id, title, description?, requestId}` | `{todo}` | 保留 id/createdAt/status/order，仅更新内容与 updatedAt |
| `delete` | `{op:'delete', id}` | `{deleted: boolean}` | 幂等，未找到返回 `false` |
| `move` | `{op:'move', id, direction:'up'|'down'}` | `{todos}` | 相邻交换并重排 0..n-1 |

- 统一信封：成功 `{ok:true,data}`；业务失败 `{ok:false,error:{code,message}}`（HTTP 200，避免 Client 误判成功）；JSON 解析失败 400、超大请求体 413、非 POST 405、未认证 401/403、未预期异常 500。
- 错误码：`invalid_title`、`invalid_description`、`not_found`、`storage_failed`、`invalid_payload`、`internal_error`、`unauthorized`；Client 按 code 显示本地化文案。

### 4. 风险与限制

- **认证依赖浏览器 Cookie**：该端点只接受已认证的同源浏览器请求；CLI / 外部调用会被 401 拒绝（设计如此）。若 DSH 改为非 loopback 部署、反向代理或更换 Cookie 策略，需要重新验证。
- **非 `@Remote` 契约**：虽然用了公开的 `webServer` / `connection` 服务，但没有走 API Gateway 的 Peer 访问策略；`requestRejection` 负责信任与认证，但没有按远程 Peer 方法级鉴权（本插件是本地 owner-only 场景）。
- **域声明硬编码**：域名 `task_inbox`、version 1、`single` 布局、表 `todos` 均写死；升级 schema 时需提升 version 并声明 `compatibleVersions`，否则旧数据会以 `version-mismatch` 拒绝打开。
- **移动非事务**：上移 / 下移会对多条记录逐条 `put`，中途存储失败可能留下部分已更新的顺序（值仍合法）。
- **依赖可用性**：`inject: ['webServer','connection','storageDomain']` 为硬依赖；缺少任一服务的 Profile（例如无 Web 载体的 headless Profile）不会激活本插件，这是有意选择（没有传输层就无法服务 Client）。

### 5. 验证状态

- 已执行：`pnpm build` / `pnpm typecheck` / `pnpm check` / `pnpm test`（25/25）；官方 `install_bundle` 安装；未认证路由返回 401 JSON；Loader 行 `enabled: true`、`fiberPhase: active`；`sidebar.panellist` / `main` 注册存在。
- 未执行：浏览器内的 CRUD 端到端、刷新与 DSH 重启后的数据保留、bundle 禁用/启用的重载测试（用户未批准该 Profile 操作，不绕过审批）。真实 v1 数据的在线迁移在后续轮次的插件热重载中自动发生，结果见「第二轮审查修复确认」第 3 节。

---

## 附：Task 02 审查修复确认（2026-11-10）

本节记录 P1（排序原子性 / 并发幂等）与 P2（HTTP 请求体）修复所依据的机制与实现，证据来自 `cordis_inspect_query` 契约、已安装包源码与本地测试。

### 1. Storage Domain 的原子写能力（调研结论）

- **没有跨记录事务 / 批量写**：`KvTable` 只有 `put`、`delete`、`deleteMany`、`update`，每次调用在域写链上只产生一次后端操作（`pkg:@deepseek-ai/dsh-storage-domain/lib/index.js:270-305`）；因此“逐条写多个记录”无法做到全成或全不成——这正是旧 `move()` 的问题。
- **`Domain.global.set(value)` 是单次原子写**：实现为 `await unit.setGlobal(value)` 后才更新内存并 emit（`pkg:@deepseek-ai/dsh-storage-domain/lib/index.js:165-176`），失败时内存不改变。
- **底层介质本身是原子替换**：JSON 后端 `single` 布局每次写入“临时文件 → fsync → 原子 rename → 目录 fsync”（`pkg:@deepseek-ai/dsh-storage-json/README.md:74-76`）。
- **结论**：把整份有序列表作为**单个 global 值**持久化，每次业务变更只调用一次 `global.set()`，即可获得“全成或全不成”的排序语义；这是当前 Storage Domain 能提供的最强保证。被否决的替代方案：保留逐条记录 + 单独 order 数组，需要两次写与失败修复逻辑，达不到原子性要求。

### 2. 数据格式 v2 与 v1 迁移

- 域声明升级为 `version: 2, compatibleVersions: [1]`，保留旧 `todos` 表声明；v2 `global` schema 为 `{ todos: Todo[], migrated: boolean }`（`src/host/domain.ts`）。
- 启动时 `migrateLegacyTodos()`（`src/host/store.ts`）：若未迁移且旧表有记录，按旧 `order` 排序并重编号后**一次 `global.set({todos, migrated: true})`**；成功后 best-effort `deleteMany` 清理旧记录。
- 迁移写失败会**中止插件激活**（`apply` 抛错），避免服务空列表而旧数据仍在文件里造成“数据丢失”假象；清理失败只记日志，`migrated` 标记保证不会二次迁移。
- 真实数据验证：用当前测试 profile 的 v1 存储文件（2 条待办）做**只读离线模拟**，迁移前后 id / 标题 / 描述 / createdAt / updatedAt / order 完全一致，迁移后 CRUD 冒烟通过；未修改真实文件。
- 在线迁移会在插件下次加载（重启 / 重载）时发生；本次未操作 `plugin_manager`，因此在线执行留给用户验收。

### 3. 并发与幂等

- `TodoService` 内所有变更进入单条 Promise 队列（`mutationTail`），读-改-写不交错：并发创建不会分配相同 `order`，`move` 不会与 `update`/`delete` 竞争丢数据；队列对失败隔离，后续操作不受影响。
- `requestId` 幂等检查在队列内、且要求缓存命中的 todo **仍然存在**（避免删除后被缓存“复活”）；并发相同 `requestId` 只产生一条待办、一次写入。
- 证据：`src/host/service.ts`；测试 `test/service.test.mjs`（并发同 requestId、并发不同 requestId、并发 move+update、并发 create+move、并发 delete+update、写入失败保持原状态）。

### 4. HTTP 请求体处理

- `readBody()` 改为按 `byteLength` 统计真实字节数（多字节中文无法绕过 256 KiB 上限），并使用流式 `TextDecoder`，跨 `data` chunk 边界被切开的 UTF-8 码点可正确还原；超限时调用 `request.destroy?.()` 停止读取（`src/host/api.ts`）。
- 测试：`test/api.test.mjs` 新增“UTF-8 跨 chunk 拆分”“按字节而非字符串长度限流”“分块流式超限”用例。

### 5. 验证状态

- `pnpm build` / `typecheck` / `check` 通过；`pnpm test` **43/43** 通过。
- 未执行：真实运行中的在线迁移、浏览器端到端、重启持久化、插件重载测试（未做任何 `plugin_manager` 变更操作）。

---

## 附：Task 02 第二轮审查修复确认（2026-11-10）

本轮只修两个问题：HTTP 超限连接处理、Storage Domain 写入结果不确定时的恢复；其余架构不变。

### 1. HTTP 超限：先读尽再响应，避免提前断连

- 真实 Node 行为：在请求体尚未读完时 `request.destroy()` 会关闭 socket；仍在上传的客户端可能收到 `ECONNRESET`，从而丢失本应返回的 413。
- 修复（`src/host/api.ts`）：超限后不再销毁请求，而是**继续读取并丢弃**剩余字节（内存只保留到上限），在 `end` 时拒绝为 `BodyTooLargeError`，由处理器返回 `413` 且附 `Connection: close`（该交换不再复用连接）。缓冲区保持有界，仅带宽被消耗。
- 验证：新增 `test/http.integration.test.mjs`，使用**真实 `node:http` 服务器 + HTTP 客户端**（非 EventEmitter 模拟）覆盖：正常 create/list、带 `Content-Length` 的超限上传可靠收到 413、chunked 超限收到 413、跨网络 chunk 的 UTF-8、401。

### 2. 写入结果不确定时的恢复

依据（已安装版本源码）：
- Domain 层对 `StorageError("unknown-state")` 会隔离：后续读写全部拒绝（`pkg:@deepseek-ai/dsh-storage-domain/lib/index.js:224-242`）。
- 但 JSON `single` 布局的写入是“临时文件 → fsync → rename → 目录 fsync”；`setGlobal()` 只回滚内存，然后**原样抛出底层错误**（`pkg:@deepseek-ai/dsh-storage-json/lib/index.js:252-261,279-284`）。错误可能发生在 rename 之后，此时磁盘已更新而 API 报失败；Domain 不会把这类原始 I/O 错误标记为隔离。
- storage-json README 明确：I/O 失败后“a rejected write does not prove that disk data or its stamp stayed unchanged”，应停止使用并关闭/重开以重新加载磁盘状态（`pkg:@deepseek-ai/dsh-storage-json/README.md:60,73-76`）。
- 因此不能继续使用旧内存，也不能无条件告知用户“未修改”。

修复（`src/host/store.ts` + `src/host/service.ts`）：
- **分类**：`TypeError`（序列化前失败）、`DomainError`、`StorageError` 的 `closed/invalid-record/malformed-medium/version-mismatch/backend-not-found/facet-unsupported` 视为**确定未提交**；`StorageError("unknown-state")` 与其它原始 I/O/未知错误视为**结果不确定**。
- **恢复**：不确定时立即 `domain.close()` 并重新 `ctx.storageDomain.open(spec)`（重新加载磁盘状态），把磁盘列表与“本次尝试写入的列表”“写入前列表”比较：
  - 等于尝试值 → 实际已提交，按成功返回；
  - 等于写入前值 → 确认未提交，返回确定失败（`storage_failed`）；
  - 其它状态或重开失败 → **保护态**：memorize 一个 `storage_uncertain` 错误，后续 `read/write` 全部拒绝，不再触碰可能过期的内存，提示重启/重载 DSH。
- **用户提示**：新增错误码 `storage_uncertain`（Client 中英文案），不再把不确定结果描述成“数据未被修改”；确定的 `storage_failed` 才提示修改未保存。
- **测试**：`test/store.test.mjs` 新增分类、确定失败可重试、unknown-state 已提交确认、原始 I/O 未提交确认、重开失败保护态、第三态保护态等用例；`test/service.test.mjs` 新增不确定结果阻断后续操作、确定失败后重试用例。

### 3. 本轮验证状态

- `pnpm build` / `typecheck` / `check` 通过；`pnpm test` **56/56** 通过。
- 未调用 `plugin_manager`、未提交/推送。
- 真实存储文件说明：v1→v2 在线迁移已在**上一轮**（19:25 左右）由插件热重载自动执行，**不是本轮操作**；本轮多次 `pnpm build` 后文件 mtime 未变化。迁移后 2 条真实待办均在（id / 标题 / 描述 / createdAt / order 与迁移前一致）；两条记录的 `updatedAt` 变为迁移后某次排序操作的时间，迁移代码与测试本身不改 `updatedAt`。已额外复制一份只读备份 `$DSH_HOME/storages/task_inbox.v2.after-migration.backup.json`，未改动原文件。
