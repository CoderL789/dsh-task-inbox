# 路线图：DSH Task Inbox（待办箱）

本文件描述 DSH Task Inbox 从最小骨架到可发布插件的阶段计划，包括每个阶段的目标、交付物、验收标准与风险，并记录进度与开放问题。

状态图例：

- **完成（已通过验收）**：阶段目标已由用户验收；
- **实现完成（待用户验收）**：实现与自动化/安装验证已完成，等待用户人工验收；
- **审查修复完成（待复审）**：已按代码审查意见修复并回归，等待复审；
- **待开始**：尚未开始。

当前阶段总览：

| 阶段 | 主题 | 状态 | 目标 |
| --- | --- | --- | --- |
| Task 01 | 最小可运行独立插件 | **完成（已通过验收）** | 插件可被 DSH 安装加载，侧边栏入口与独立空状态页可用；文档与项目骨架就位 |
| Task 02 | 待办数据模型与持久化 + CRUD 界面 | **完成（已通过验收）** | 待办归属于插件、跨会话与重启存活，并提供完整增删改查界面 |
| Task 03A | 执行前配置与会话能力验证（仅预览） | **完成（已通过验收）** | 选择工作区 / 会话策略 / 来源会话并校验配置；不创建会话、不派发 |
| Task 03B | 执行派发（新建 / 复用 / Fork） | **0.4.7 已提交，待本地构建与 GUI 复验** | 按三种策略把 Todo 派发给 Agent，并持久化执行关联 |
| Task 03C | Modern Workbench UI 重构 | **主体实现完成，待 DSH GUI 验收** | 现代工作台、详情面板、Workspace 感知、执行配置工作区与统一时间线 |
| Task 04 | Agent 执行追踪 | 待开始 | 在派发时间线之上追踪 Agent Turn、完成状态与结果关联 |
| Task 05 | 打磨与开源发布准备 | 待开始 | 国际化、可访问性、打包与开源发布就绪 |

---

## Task 01：最小可运行独立插件

**状态：完成（已通过验收）**

**目标**：交付一个可以被 DSH 官方插件管理器安装、加载的独立插件包，并在界面上提供「Task Inbox」侧边栏入口与独立页面（仅插件名称 +「暂无待办」空状态）。不包含任何待办业务能力与 Agent 执行能力。

**交付物**：插件包骨架（`package.json`、`cordis.patch.yml`、`tsconfig.json`、`icon.svg`、`locale/*.json`）；TypeScript 构建链路；Host 挂载点；Client 侧边栏入口 + 独立空状态页；README / roadmap / api-notes；MIT LICENSE。

**验收结果**：已通过官方插件管理器安装到桌面测试 profile，Host 行 `enabled: true`、`fiberPhase: active`，`sidebar.panellist` 与 `main` 均出现 `task-inbox` 占用；用户验收通过并进入 Task 02。

**风险（已收敛）**：bundle patch 与 DSH 版本兼容、Slot 注册方式差异、profile 环境差异、文档与实现偏差。

---

## Task 02：待办数据模型与持久化 + CRUD 界面

**状态：完成（已通过用户代码审查与人工验收）**

**目标**：建立「待办归属于插件」的核心能力——待办可创建、编辑、删除、排序，并在跨会话、跨刷新、跨重启后依然存在。本阶段仍不执行待办，也**不实现**「标记完成」（避免与后续 Agent 执行验收状态混淆）。

**交付物（已实现）**：

- 数据模型与校验（`src/host/model.ts`）：`id`、`title`（trim 后 1–200 字符）、`description`（trim 后 0–2000 字符）、`status`（本阶段仅 `todo`）、`createdAt`、`updatedAt`、`order`；
- 持久化（`src/host/domain.ts` + `store.ts`）：`ctx.storageDomain` 独立存储域 `task_inbox`（version 1、`layout: 'single'`、表 `todos`、zod 记录 schema），JSON 后端落盘到 `$DSH_HOME/storages/task_inbox.json`；
- Host CRUD 服务（`src/host/service.ts`）：增删改查、相邻项上移 / 下移并重排 `order`、创建幂等（`requestId`，内存 10 分钟 / 200 条）、存储失败映射；
- 受认证的 Host/Client 通信（`src/host/api.ts` + `src/host/index.ts`）：`POST /plugins/dsh-task-inbox/api`，经 `ctx.webServer.register` 注册、`ctx.connection.requestRejection` 逐请求鉴权；统一 JSON 信封与错误码；
- Client 界面（`src/client/index.ts`）：新增 / 编辑表单、列表（标题 / 描述 / 本地化创建时间）、删除二次确认、上移 / 下移、加载中、成功 / 失败反馈、空状态复用 Task 01 设计、zh / en 文案、仅使用 `--dsw-alias-*` 主题 token；
- Task 01 审查修复：`ctx.locale.register` 的 disposer 收进 `ctx.effect`，插件重载时先释放旧字典再注册；Slot 贡献继续由 `ctx.slots.inject` 管理；
- 自动化测试：25 个 `node:test` 用例（`test/model.test.mjs`、`test/service.test.mjs`、`test/api.test.mjs`），覆盖校验、排序 / 移动、CRUD、幂等、存储失败不误报、API 解析与处理器、域 schema；
- 文档更新：README 使用说明、数据位置 / 备份 / 卸载策略、项目结构与限制；api-notes 追加 Task 02 实现确认。

**验收标准与状态**：

| # | 验收标准 | 状态 |
| --- | --- | --- |
| 1 | 不依赖任何会话即可创建与管理待办 | ✅ 已实现（Host 单元测试 + API 处理器测试） |
| 2 | 刷新页面、切换工作区 / 会话后待办仍在 | ⏳ 已实现（数据由 Host 存储域持有，与 Session 无关），待用户刷新验证 |
| 3 | 重启 DSH 后待办完整保留，顺序与状态一致 | ⏳ 已实现（JSON 单文件持久化），待用户重启验证 |
| 4 | 增删改查、排序在界面上可用，非法输入有校验提示 | ⏳ 代码 / 构建 / 类型检查通过，浏览器交互待用户验收 |
| 5 | 删除需要二次确认 | ✅ 已实现（行内确认 + 取消） |
| 6 | 存储异常时不错误提示保存成功 | ✅ 已实现（写入失败映射 `storage_failed`，界面按失败展示；单元测试覆盖） |
| 7 | 插件重新加载不产生重复注册 | ✅ Host 侧：重载后路由单次注册成功（若重复注册会因 duplicate route 失败）；Client 侧：locale 字典已改为 `ctx.effect` 管理，待人工重载验证 |
| 8 | 空列表展示「暂无待办」，与 Task 01 占位自然衔接 | ✅ 已实现（复用 Task 01 空状态卡片并增加“添加待办”入口） |

**已执行的验证**：

- `pnpm build`、`pnpm typecheck`、`pnpm check` 全部通过；
- `pnpm test`：**56/56** 通过（含并发创建 / 幂等、排序与其他变更竞争、排序写入失败保持原状态、写入结果不确定时的关闭重开比对与保护态、v1→v2 迁移、HTTP 分块 UTF-8 与字节上限、真实 `node:http` 服务器/客户端集成）；
- 用**真实 v1 存储文件**（2 条待办）做只读迁移模拟：迁移前后 id / 标题 / 描述 / 创建与更新时间 / 顺序完全一致，迁移后 CRUD 冒烟通过（未写真实文件）；
- 插件已通过官方 `install_bundle` 安装；安装后的 API 路由实测返回 **401 JSON 未授权信封**（说明路由注册、认证拦截与 Host 模块加载均正常）；Loader 行 `enabled: true`、`fiberPhase: active`；Client `main` / `sidebar.panellist` 均有 `task-inbox` 占用。

**未执行的验证（需用户 / 后续处理）**：

- 浏览器中的实际视觉、点击与 CRUD 端到端（本环境无浏览器控制能力）；
- 刷新页面、切换工作区 / 会话、重启 DSH 后的数据保留；
- 真实 v1 存储文件在插件下次重载时的**在线迁移**：已由插件热重载自动完成（迁移后 2 条真实待办均在，id / 标题 / 描述 / createdAt / order 一致），详见进度记录；本轮未操作 plugin_manager；
- 通过插件管理器禁用 / 启用 bundle 的重载测试（审批未授权，未执行；不绕过审批）。

**技术实现摘要**：

- 存储：不直接读写文件，而是使用公开的 `ctx.storageDomain.open(spec)`；域与表名遵循存储后端规则 `^[a-z][a-z0-9_]*$`（`task_inbox` / `todos`）。v2 把**整份有序列表存为单个 global 状态文档**（`{todos, migrated}`），因为 Storage Domain 没有跨记录事务，而 `Domain.global.set()` 是单次原子写；因此每次变更一次落盘，排序天然“全成或全不成”。
- 写入结果分类：确定未提交的错误（序列化失败、域层/存储契约拒绝）直接失败；可能已落盘的不确定错误（底层 I/O、`unknown-state`，`single` 布局可能在 rename 之后才报错）会关闭并重开存储域、从磁盘重新加载后与该次尝试比对，确认提交则成功、确认未提交才失败；重开失败或磁盘状态异常则进入保护态（后续读写拒绝，提示重启/重载），不基于旧内存继续写。
- 迁移：v1 的逐条记录表保留声明，`version: 2 + compatibleVersions: [1]` 允许打开旧文件；启动时若未迁移且存在旧记录，则排序/重编号后**一次原子写入** global（含 `migrated: true`），随后 best-effort `deleteMany` 清理旧记录；迁移写失败会中止插件激活，避免用空列表掩盖旧数据。
- 并发：所有变更经服务内单条 Promise 队列串行化（读-改-写不交错）；`requestId` 幂等检查在队列内执行，且缓存命中的 todo 必须仍存在；不同 requestId 的并发创建获得唯一 `order`。
- 通信：不使用 `@Remote` / typert 生成协议，而是单个同源 HTTP 端点 + 浏览器 Cookie 认证；请求体按**真实字节数**限流（256 KiB），超限时**读尽并丢弃**剩余请求体后再返回 413（附 `Connection: close`），避免提前 destroy 导致客户端拿不到 413；流式 `TextDecoder` 保证跨 chunk 边界的 UTF-8 正确解码；业务错误以 HTTP 200 + `{ok:false,error}` 返回。
- 校验与排序是纯函数，Host 服务只依赖状态仓储接口，因此可脱离 DSH 运行时做单元测试。

**风险 / 已知限制**：

- 每次变更重写整份有序列表（个人待办量级可接受；列表极大时写放大明显）；
- 并发串行化只在 Host 进程内生效，同一 `$DSH_HOME` 多进程同时写同一存储域不在支持范围内；
- 创建幂等缓存仅在内存中，DSH 重启后失效（只用于抵御快速重复提交）；
- 没有跨标签页实时同步：其他窗口的修改需刷新后可见；
- Client/Host 通过 Cookie 鉴权，若部署方式改变（非 loopback / 反向代理 / 自定义 Cookie），需要重新验证；
- 存储域名称与 `single` 布局写死在代码中；v1→v2 迁移在插件下次加载时执行，迁移写失败会中止激活（旧数据保留在文件中）并记录错误；
- 写入结果不确定且自动关闭/重开存储域失败时，插件进入保护态，需重启/重载 DSH 才能继续；磁盘文件不会被删除或重置；
- 无自动化 UI 测试，视觉与交互仍依赖人工验收。

---

## Task 03A：执行前配置与会话能力验证

**状态：完成（已通过代码审查与核心 UI 验收）**

**目标**：让用户在执行前选择执行上下文（Workspace + 会话策略 + 来源 Session），并验证 DSH 现有 API 能否支撑三种策略；本阶段**只预览与校验，不创建 / 恢复 / Fork 真实 Session，不向 Agent 派发 Prompt**。

**交付物（已实现）**：

- Host 只读执行上下文服务（`src/host/execution-context.ts`）：基于 public Host 服务 `workspaceRegistry.list()`、`sessionPersistence.list()`、`sessions.get()`、`sessionTitle.get()` 汇总 Workspace、Session 候选与可用性；新增 `execution-context` HTTP 操作（受 Task 02 同源认证保护）；
- 候选规则：Session 必须存在于所选 Workspace；空白会话不用于复用 / Fork；subagent-origin 会话排除；Workspace 目录缺失标记不可用；归档状态与「已完成轮次」作为 warning 交给派发时 Host 校验；
- Client 执行前配置界面：待办标题 / 描述预览、Workspace 选择、策略选择（新建 / 复用 / Fork）、来源 Session 选择、摘要、校验提示、取消 / 返回 / 确认；切换 Workspace 或策略时清除失效来源 Session；明确标注“仅预览，不会发送任务”；
- 中英文文案与明暗主题适配；无新增 UI 依赖；
- API 可行性验证记录：见 [api-notes.md](api-notes.md) 的 Task 03A 附录；
- Task 03B 方案：[task-03b-design.md](task-03b-design.md)。

**验收标准与状态**：

| # | 验收标准 | 状态 |
| --- | --- | --- |
| 1 | 每条待办有「执行」入口并可打开配置界面 | ✅ 已实现，待人工验收 |
| 2 | Workspace 列表、路径与可用性正确展示 | ✅ 已实现（public Host API + 单测） |
| 3 | 会话列表只显示所选 Workspace 的会话 | ✅ 已实现（Host 关联 + 单测） |
| 4 | 新建 / 复用 / Fork 三种策略与来源会话选择可用 | ✅ 已实现（预览） |
| 5 | 不可用 Workspace / 不存在 / 空白 / 不适用 / 状态未知会话有明确提示 | ✅ 已实现（空白三态 + 不可用原因 + warning） |
| 6 | 切换 Workspace 会清除无效来源 Session | ✅ 已实现 |
| 7 | 确认不会创建会话或派发任务，并明确提示未接通 | ✅ 已实现（预览提示） |
| 8 | 中英文与明暗主题兼容 | ✅ 已实现，待人工验收 |

**已执行的验证**：`pnpm build` / `typecheck` / `check` / `test`（**77/77**，含执行上下文筛选、会话空白三态判定与策略校验测试）；未调用 `plugin_manager`，未创建 / Fork / 恢复真实 Session，未修改 Workspace 或 Profile。

**风险 / 待验证**：

- 冷会话标题不通过 public Host API 获取，预览显示占位标题 + 短 ID；
- 归档状态、已完成轮次在预览阶段不可确认，需 Task 03B 派发时由 Host 最终裁决；
- 浏览器中的实际交互与中英文 / 明暗主题需人工验收。

---

## Task 03B：执行派发

**状态：生命周期依赖/能力门禁修复完成（版本 0.4.5，待复审/人工验收；开发 Agent 未对真实 Workspace/Session 发起测试执行）**

**0.4.5 初始化与门禁修复（2026-11-11）**：

- **Host 依赖惰性解析**：`ExecutionService` 不再在 apply 阶段捕获 `workspaceRegistry/sessionPersistence/sessions/sessionTitle` 的早期 `undefined`，改为每次使用时调用 provider；缺失时明确返回 `execution_unavailable`。修复重启后「工作区/派发不可用」的初始化时序竞争。
- **派发能力探测**：新增 `execution-capability`，按当前策略与 Workspace 检查实际依赖（workspace registry、session persistence、workspace 存在/可用），返回 `dispatchReady`、`dispatchReason`、missing/warnings；Host 写操作仍独立校验，不信任 Client ready 标记。
- **Client 安全门禁**：执行历史状态区分 loading/loaded/error；统一 `canConfirmDispatch` / `canDispatchSelected` 门禁；历史未加载/失败、能力不可用、存在未解决执行、Session API 缺失或派发进行中时禁止确认、继续、恢复、Prompt 重试；收到 `execution_unavailable` 后能力标记未确认，必须重新检查状态。
- **历史空状态**：正常空历史显示「暂无未解决执行」；加载中/失败/能力不可用分别显示对应提示，不再用 `return null` 隐藏；加载失败提供重新检查入口。
- **Session 标签**：标题/未命名/空白/状态未知均附带可区分短 Session ID（默认 8 位，冲突自动延长）；下拉框按完整 Session ID 去重，保留空状态/活跃/未找到提示。
- 测试增至 **164/164**：延迟激活依赖、能力探测、API 能力响应、empty/loading/error 门禁、Session 标签碰撞/去重、既有状态机/幂等回归。

**最终 UI 收尾（2026-11-11）**：

- 执行配置页新增「历史未解决执行」区域：加载当前 Todo 的全部 Execution，筛选 prepared/session_ready/dispatching/unknown；展示短 Execution ID、策略、状态、创建时间、来源/目标 Session；默认选择最新未解决执行，即使最新一条已 accepted 也能找到更早的未解决记录。选择仅展示/恢复，不自动 create/fork/prompt；切换 Todo 清空选择。
- reuse 历史记录 targetSessionId 缺失时提供「恢复绑定并继续派发」：二次确认提示可能发送未接收 Prompt 但不会创建新会话；恢复使用该 Execution 原有 executionId/requestId/sourceSessionId/Prompt 快照，调用 `execution-reuse-recover`，先日志核验；已有 accepted 直接恢复、不重发；日志不可读保持 unknown；不 create/fork。
- 执行详情区分「来源会话」与「目标会话」：新建仅目标；复用来源与目标相同时合并、target 未保存时明确显示；Fork 分别展示；未命名 Session 回退短 ID/创建时间。
- 加载历史失败显示错误并提供重试（不误显示空列表）；恢复期间按钮禁用并增加同步 single-flight 锁，防止重复点击重复派发。
- 测试增至 **154/154**：多未解决执行选择、最新 accepted 不隐藏较早 unknown、选择无副作用、不同记录使用各自 requestId、reuse 恢复不 create/fork、来源/目标映射、清空选择、并发恢复不重复创建等。

**第三轮审查修复（2026-11-10）**：

- **复用会话绑定**：`boundElsewhere` 只约束新建/Fork 目标防冒领；`reuse` 允许一个 Session 关联多条 execution（每条独立 requestId），不同 Todo、同一 Todo accepted 之后均可复用；复用仍校验 Workspace、来源 Session、非空白与执行状态，并仍受未解决执行/防重规则约束。
- **复用失败恢复**：新增 `execution-reuse-recover`。当 reuse 的 targetSessionId 缺失但 sourceSessionId 已确定时，重新校验 Workspace/来源会话并用原 executionId/requestId/Prompt 快照恢复绑定；不创建/Fork；先只读日志核验，已 accepted 则直接升级，日志不可读/超限则保持 unknown，不自动派发。Client 对 reuse 失败不再显示“会话已创建”，而是显示实际业务错误并提供“恢复复用绑定”入口。
- **旧接口收紧**：`execution-dispatching` 不再接受 prepared→dispatching，仅用于 `session_ready` 的 Prompt 阶段；旧 Client 无法绕过 `execution-acquire` 进入 create/fork。已有 prepared 执行仍可通过 acquire 恢复。
- **Prompt 重试收紧**：`authorizePromptRetry` 在日志 accepted 时只升级不重发；日志不可读/扫描超限（unknown）时拒绝授权并保持 unknown；仅 `not-found` 时按 requestId 幂等契约授权一次安全重试，仍不 create/fork。
- 测试增至 **148/148**：新建 accepted 后其他 Todo 复用、同一 Todo accepted 后新执行、reuse 关联失败恢复、旧接口绕过、日志不可读/扫描上限、并发恢复等。

**第二轮审查修复（2026-11-10）**：

- **非幂等操作独占执行权**：新增 `execution-acquire`，在串行化 mutation 内把 prepared→dispatching 并发放租约（`dispatchLeaseToken`、`dispatchLeaseAcquiredAt`、`dispatchLeaseExpiresAt`）；只有 `acquired: true` 的调用者才可 create/fork，状态已是 dispatching/unknown 的并发/重试调用返回 `acquired: false`；租约永不重新发放，重启/超时后只能走 unknown/恢复。Client 必须检查 `acquired`，不能仅凭 `status === 'dispatching'` 继续。
- **clientRequestId 完整幂等比较**：mutation 内命中相同 id 时再次比较 todoId/workspaceId/strategy/sourceSessionId；完全相同才返回原 execution，任何差异返回 `execution_conflict`，绝不返回其他 Todo/Workspace 的记录。
- **unknown 的安全 Prompt 恢复**：Client 恢复前先刷新 Host 状态；Host `execution-prompt-retry` 先只读日志核验，若已 accepted 则升级且不再发送；否则只授权一个调用者将 unknown→dispatching，复用相同 executionId/targetSessionId/requestId/不可变 Prompt 快照，永不 create/fork；未获授权保持 unknown 提示人工检查。过期 Client 状态在 Prompt 前也会再次查询 Host，不会重发 accepted 任务。
- 测试增至 **139/139**，新增并发抢权（create/fork 最多一次）、相同 clientRequestId 不同参数并发冲突、unknown+target 恢复、迟到 accepted、并发恢复、Prompt 回执丢失等用例。

**第一轮审查修复（2026-11-10）**：

- **拒绝重复创建/Fork**：同一 Todo 存在 prepared/session_ready/dispatching/unknown 执行时，Host `execution-intent` 返回 `execution_unresolved`（并发 intent 也只成功一个）；Client 在 unknown/dispatching 下不再提供“重新派发”，只能检查状态/候选/恢复；发起全新执行必须先二次确认「放弃此执行」（`execution-abandon`，在途 dispatching 禁止放弃，已创建 Session 保留）。
- **异常分类保守**：`isDefiniteSessionOperationError` 只把明确业务拒绝码（如 `session/conflict`、`session/agent-busy`、`remote-access/denied`）视为确定失败；网络超时/连接中断即使带 `code` 也按 unknown 处理。
- **Prompt 已接受但 Host 回执失败**：保留 executionId/requestId/目标 Session，状态保持 `dispatching`（错误码 `host_result_unavailable`），UI 优先“检查状态”，后续通过只读日志核验；绝不因此重新创建 Session。
- **状态机临界区**：所有状态检查/修改移入串行化 store mutation；accepted 不会被迟到 failed/unknown 覆盖；已绑定目标不能被其他 Session 替换；unknown 可通过日志核验恢复 accepted；无目标 dispatching 只有超过 120 秒宽限才转 `dispatch_interrupted`（避免其他窗口轮询误判）。
- **目标绑定校验**：复用必须绑定原来源；新建/Fork 目标必须晚于执行意图创建、不能被其他执行占用；人工候选绑定按原策略复核（new 需空白、fork 不得为源/空白），并记录 `bindingSource: manual` + UI 提醒 Host 无法自动证明来源。
- 测试增至 **129/129**，覆盖重复点击/并发请求/跨窗口等效并发 intent、网络错误码歧义、Host 回执失败与刷新恢复、accepted 并发保护、目标不可覆盖、宽限期、放弃与人工绑定校验。

**实现（2026-11-10，版本 0.4.0；0.4.1/0.4.2/0.4.3 为三轮审查修复）**：

- 采用已确认的 Client 授权链路：`ctx.sessions.create/fork` + `ctx.sessions.retain` + `SessionFace.prompt(..., 'queue', ..., requestId)`；Host 不调用任何 Remote Session 方法；
- 新建使用 `create()` 返回的实际 Session ID（不预生成 proposedSessionId）；Fork 默认 `allowMigration:false`；创建/Fork 成功后先经 `execution-session` 持久化目标 Session，再发送 Prompt；
- Host 新增独立执行记录域 `task_inbox_executions`（v1；Todo 域保持 v2 不迁移），提供 `execution-intent` / `execution-session` / `execution-dispatching` / `execution-result` / `execution-status` / `execution-candidates` / `execution-bind` / `execution-unknown` / `execution-failed`；
- 执行状态：`prepared` → `dispatching`（创建/Fork 前落库，防止同一执行重复创建）→ `session_ready` → `dispatching`（Prompt 阶段）→ `accepted` / `failed` / `unknown`；
- Host 独立核验：只读扫描目标 Session 日志中 `user/message` 的 `source.rpcId === requestId`；Client 报告的 accepted 未通过核验时保持 `dispatching`，不直接标记 accepted；
- Fork 未知结果：不自动重试；Host 列出 intent 之后、同 Workspace、未被绑定的候选会话，由用户手动绑定后继续；
- UI：真实「确认并派发」、派发中禁用、accepted/failed/unknown/session_ready 反馈、打开目标会话、检查状态、继续派发、候选核对/绑定、未命名会话短 ID/时间显示、中英文与明暗主题；
- 测试：164/164（Host 意图/校验/状态机并发/执行权租约/日志核验/恢复/放弃/复用共享与恢复/生命周期依赖/能力探测 + Client 编排 mock `ctx.sessions` 的成功/失败/断连/回执丢失/刷新恢复/并发抢权/unknown Prompt 恢复/历史选择与来源目标映射/门禁/标签等路径）。

**已知限制**：archive/已完成轮次无法由 public Host API 预检（由 Remote prompt 最终裁决）；Fork 无幂等键；Client `sessions.create/list` 属随版本发布契约；真实 GUI 派发/刷新恢复尚未人工验收。

**核心结论**：**可以**让 Client 通过 DSH 正常的授权 Remote 链路完成创建 / Fork / Prompt 派发，不需要第三方 Host 插件直接调用 `sessionController.*`（`@Remote`）。

**架构验证要点**（详见 [task-03b-design.md](task-03b-design.md) 与 [api-notes.md](api-notes.md)）：

- Client `ctx.sessions.create()`、`ctx.sessions.fork()`、`SessionFace.prompt(content, mode, signal, requestId)` 由 Session Controller Client 端实现并经 Connection RPC → API Gateway → Peer 鉴权；浏览器页面为 owner Peer，owner 不被 policy 检查，非 owner 仍会被服务端拒绝（不绕过鉴权）。
- 三条策略统一采用：Host 记录 intent + 重新校验 → Client 授权 Remote create/fork → retain → prompt(requestId) → Host 记录 result/复核；Host 不调用 @Remote。
- Host 公开 `agents.get/resume + followup` 仅作为降级方案（无 Peer 授权链、无 requestId 幂等、writer lock 风险）；Host 直调 `@Remote` 在“不绕过 Peer 鉴权”约束下**不采用**。
- 恢复：Host 持久化执行记录（独立域 `task_inbox_executions` v1；Todo 域 v2 不迁移）；重启后用只读 `sessionPersistence.open(id,'read')` 判断 requestId 是否已落成消息；Fork 无幂等键，未知结果不自动重试、交用户确认；Prompt 以 requestId 幂等兜底。
- 未命名 Session 显示：`title → 短ID · ISO 创建时间 → 短ID`（`describeSessionChoice`，含纯函数测试）。
- 派发前 Host 重新校验 Todo / Workspace / Source/Target Session（`validateDispatchPreconditions`，含纯函数测试），不信任 Task 03A 预览快照；archive 状态与「已完成轮次」由真实 Remote prompt 最终裁决。

**目标**：按用户选择的策略真正派发 Todo 给 Agent，并持久化 Todo ↔ Workspace / Session 的执行关联；完整状态机与历史在 Task 04。

**交付物（已实现）**：

- Client 授权链路派发：`ctx.sessions.create/fork` + `retain` + `SessionFace.prompt`；
- Host 执行意图/关联/状态持久化（独立域 `task_inbox_executions` v1；Todo 域 v2 不迁移）；
- 幂等 requestId、接受确认（Host 日志核验）、失败与重启恢复（Fork 未知结果人工确认）；
- 用户明确确认后才派发；Todo 原内容不因失败丢失；
- UI 接通“确认并派发”，区分预览与真实派发。

**验收标准**：

1. 三种策略均可完成一次真实执行，Agent 在所选工作区内工作；
2. 复用已有会话时，待办内容正确进入该会话上下文；
3. Fork 从所选会话分出独立新会话，原会话内容不被修改；
4. 派发请求可确认已接受，重复提交不会重复派发；
5. 任一策略失败时不丢失待办，重启后可恢复或明确标记 unknown；
6. 执行关联（Todo / Workspace / Session / requestId）可查询，为 Task 04 预留状态机。

**风险**：

- Client `sessions.create/list` 未出现在 inspect 方法目录，仅见 `ISessions` 类型与构建实现 → 属“随版本发布的 Client 契约”，需版本回归；
- `retain` 打开历史的成本与失败处理；页面刷新/关闭中断协调（靠 Host 记录恢复）；
- Fork 无幂等键，未知结果需人工确认；create 命名复用可能返回不同 id（以实际返回为准）；
- 公开 Host API 无法确认 archive/completed-turn，最终由 Remote prompt 裁决；
- 执行记录使用独立的 `task_inbox_executions` 域（v1），Todo 域保持 v2 不迁移；若未来合并域需另行设计并保留两侧数据；
- 权限：非 owner Peer 会被拒绝，本插件面向 owner 页面，不绕过。

---

## Task 03C：Modern Workbench UI 重构

**状态：主体实现完成；最新 CI build / typecheck / check / 175 项 Node 测试全部通过；待 DSH GUI 人工验收**

**目标**：将当前 CRUD + 执行配置页面升级为融入 DSH 原生视觉的现代工作台。支持概览与筛选、Workspace 感知、任务详情、双栏执行配置和统一 Execution 时间线；不把 Prompt accepted 误报为 Agent 完成。

**设计边界**：

- DSH 的 ui-theme 是主题唯一权威；插件只消费 DSH 语义 token，不自建主题偏好。
- Todo 仍是全局对象，不增加永久 workspaceId / sessionId；列表展示最近一次 Execution 的 Workspace / 策略 / Session，详情保留每条历史。
- accepted 仅表示 DSH 接受 Prompt，不代表 Agent 已开始或完成。
- 第三方 bundle 不 runtime-import DSH Client 包 / ui-primitives；控件由插件自身实现。
- Todo 域 task_inbox v2 不变；Execution 事件采用向后兼容的可选字段，与状态变更同一次串行化 mutation 写入；旧记录不伪造事件。

**已完成的实现**：

- **03C-02：只读数据模型与事件**
  - ExecutionRecord 增加可选 `events?: ExecutionEvent[]` 与严格事件 schema；旧记录没有 events 时仍可读取，不提升执行存储域版本。
  - Host 在创建意图、取得派发租约、关联 Session、开始 Prompt、接受 / 失败 / unknown、恢复和放弃等状态变更时，在同一次 store mutation 中追加事件；只读轮询不追加事件。
  - 新增只读 `execution-overview` API；返回跨 Todo 的最小执行摘要，不包含 Prompt、requestId、clientRequestId、lease token 或事件数组；可用时附带 live Session 标题，标题不可用不影响查询。
  - 测试覆盖旧记录兼容、事件原子追加、概览排序 / 只读性 / 敏感字段排除，以及 Session 标题读取失败降级。
- **03C-03：工作台页面结构**
  - 新增四项概览：全部待办、未派发、待恢复、最近一次执行已 accepted。
  - 新增标题 / 描述搜索，状态 / 最近 Workspace / 策略筛选，手动 / 最近更新 / 创建时间排序；不改变 Todo 持久化顺序。
  - 列表行展示最近执行的 Workspace、策略、Session 标题 + 短 ID 和状态。
  - 任务详情展示完整 Todo、最近执行摘要、来源 / 目标 Session、时间、状态 / 错误码和历史执行列表。
  - 宽屏采用列表 + 详情双栏；不超过 1080px 时切换为单列详情视图，并提供返回列表操作，保留筛选和列表上下文。
- **03C-04：执行工作区与时间线**
  - 执行配置调整为参数区 + 摘要区双栏工作区，窄屏自动单列；原 Task 03B Host 门禁与派发编排不变。
  - 展开 Execution 可查看按时间正序排列的事件、Session 短 ID、客户端 / 人工关联来源和错误码；旧记录明确提示没有事件明细。
  - 未解决记录仍通过既有恢复操作进入执行配置，不会因为查看时间线而自动 create / fork / prompt。
  - 修复关闭执行配置后详情历史 / overview 刷新，并对并发刷新响应加序号保护，避免旧响应覆盖新选中任务。
- **03C-05：视觉、响应式和 GUI 验收**
  - 已实现 DSH token 样式、明暗主题继承、键盘焦点、hover 能力检测、减少动态效果和窄屏布局代码。
  - **尚未完成人工验收**：需在 DSH GUI 中验证浅色 / 深色 / system、390px、常见桌面宽度、键盘 / 触屏、加载 / 空 / 错误 / unknown / accepted / failed / 人工绑定等状态。
  - 当前没有自动化浏览器 UI 测试；Node 测试与 CI 不替代 GUI 验收。

**自动化验证（2026-11-11）**：

- GitHub Actions 最新验证提交：`4fc416482da75f2db6ec6a759f83b2b6f958740b`；
- `pnpm build`、`pnpm typecheck`、`pnpm check` 全部通过；
- `pnpm test`：**175/175 通过，0 失败**；
- 验证只运行构建与测试，没有调用真实 Workspace / Session，也没有创建、Fork 或发送 Prompt。

**待办 / 风险**：

- 当前分支 `src/` 已更新，但仓库中提交的 `lib/` 尚未由最新源码重新生成；在本地执行 `pnpm build` 并提交 `lib/` 前，不应把此分支当作可直接安装的最终 bundle。
- 详情面板在 1080px 以下采用单列详情视图（而非浮层抽屉），已提供返回列表操作；仍需 GUI 验证体验。
- 首页 overview 优先显示可获取的 live Session 标题 + 短 ID；冷 Session 或标题服务不可用时降级为短 ID。
- 独立 bundle 的样式注入、CSP / 热重载与 DSH 主题实时同步仍需在真实 GUI 验证。
- Task 04 才引入 Agent Turn 开始 / 结束、完成状态、结果摘要和取消能力；本阶段不得将 accepted 显示为完成。

**设计文档**：[task-03c-design.md](task-03c-design.md)。

---

## Task 04：Agent 执行追踪与结果关联

**状态：待开始**

**目标**：在 Task 03C 的派发事件时间线之上，追踪 Agent 实际运行生命周期：Turn 开始 / 结束、成功 / 失败 / 取消、结果摘要与会话跳转。不得把 Prompt accepted 当作 Agent 完成。

**交付物**：

- 执行记录模型与生命周期状态机；
- Host 侧执行状态跟踪与持久化；
- Client 侧界面：执行状态展示、执行历史列表、从执行记录跳转到对应会话 / 结果；
- 异常恢复：DSH 重启或崩溃后，对孤儿执行（会话已不存在或状态不明）的处理与标记；
- 文档更新：状态语义与排查方法。

**验收标准**：

1. 执行状态在界面上能实时反映（至少在执行开始与结束时正确更新）；
2. 历史列表按时间排序，可回溯每次执行绑定的会话、工作区与结果摘要；
3. 重启后执行记录与状态保持一致，孤立记录被明确标记而不静默丢失；
4. 失败 / 取消有明确状态与原因，可从记录中查看；
5. 从历史记录可跳转到对应会话（若能力可用）。

**风险**：

- 执行状态依赖 Agent 会话的事件 / 结果能力，接口稳定性与事件粒度为最大不确定项；
- 崩溃与重启后的状态对齐（孤儿执行判定）复杂度较高；
- 结果摘要的获取与展示可能超出当前 DSH 暴露的能力范围，需要降级方案；
- 状态机若不严谨，易出现状态卡死或错误终态。

---

## Task 05：打磨与开源发布准备

**状态：待开始**

**目标**：完成国际化、可访问性、打包与开源发布所需事项，使插件具备对外发布的质量与流程。

**交付物**：

- 完整国际化：`en` / `zh` 文案覆盖全部界面与提示；
- 可访问性：键盘导航、焦点管理、语义标签与对比度检查；
- 打包与发布准备：安装包内容校验（含构建产物与必要文件）、版本策略、发布说明（Changelog / Release Notes）；
- 开源就绪：README、LICENSE、路线图与文档最终校对，贡献指南与发布渠道确定；
- 质量：关键流程的人工验收清单，必要时补自动化测试。

**验收标准**：

1. 两种语言界面完整可切换，无遗漏硬编码文案；
2. 纯键盘可完成待办创建、执行与查看历史等核心流程；
3. 以官方插件管理器安装发布包可复现成功，卸载干净；
4. 仓库文档与实现一致，无编造的 URL、徽章或 API；
5. 发布前完成一轮人工验收并记录结果。

**风险**：

- 国际化接入方式已在 Task 01/02 验证（Client locale 服务 + 内联字典），但完整覆盖范围与 `locale/*.json` 的最终用途仍待确认，成本未定；
- 视觉与交互质量目前依赖人工验收，缺少自动化视觉回归手段；
- 发布流程与包名 / 版本策略需要维护者决策，可能影响文档与安装说明；
- 发布前若上游 DSH 版本对插件接口有破坏性变更，需额外适配时间。

---

## 进度记录

| 日期 | 事件 | 状态 |
| --- | --- | --- |
| 2026-11-10 | 仓库初始化；Task 01 插件骨架开发与构建 | 已完成 |
| 2026-11-10 | 通过官方插件管理器安装到桌面测试 profile，确认 Host 行与 Client Slot 注册 | 已完成 |
| 2026-11-10 | Task 01 用户验收通过 | 已完成 |
| 2026-11-10 | Task 02 Host 半区：存储域 `task_inbox`、数据模型 / 校验 / 排序、CRUD 服务、受认证 HTTP 端点、25 个单元测试 | 已完成 |
| 2026-11-10 | Task 02 Client 半区：CRUD 界面、二次确认删除、上移 / 下移、加载与反馈、zh/en、主题适配、locale 生命周期修复 | 已完成 |
| 2026-11-10 | Task 02 静态验证：`pnpm build` / `typecheck` / `check` / `test`（25/25）通过 | 已完成 |
| 2026-11-10 | Task 02 安装验证：官方 `install_bundle` 已安装；API 路由返回 401 认证拦截、Loader 行 active、Slot 占用正常 | 已完成 |
| 2026-11-10 | Task 02 浏览器交互、刷新与重启持久化、插件重载的人工验收 | 已完成（用户验收通过） |
| 2026-11-10 | Task 02 文档更新（README / roadmap / api-notes） | 已完成 |
| 2026-11-10 | Task 02 审查修复 P1：改为单 global 状态原子写 + v1→v2 迁移；服务层串行化读-改-写与幂等；新增并发 / 失败 / 迁移测试 | 已完成 |
| 2026-11-10 | Task 02 审查修复 P2：请求体按真实字节限流、流式 UTF-8 解码，新增分块与超限测试 | 已完成 |
| 2026-11-10 | 审查修复后验证：build / typecheck / check 通过，43/43 测试通过，真实 v1 数据迁移离线模拟通过 | 已完成 |
| 2026-11-10 | 第二轮审查修复：HTTP 超限改为读尽后返回 413（真实 node:http 集成测试）、存储不确定结果分类 + 关闭重开比对 + 保护态 | 已完成 |
| 2026-11-10 | 第二轮验证：build / typecheck / check 通过，56/56 测试通过（含真实 HTTP 集成） | 已完成 |
| 2026-11-10 | 在线迁移：插件热重载自动完成 v1→v2；核对 2 条真实待办数据保留，并另存一份只读备份 | 已完成（无需人工触发） |
| 2026-11-10 | Task 02 审查修复后的浏览器交互、重启与在线迁移人工验收 | 已完成（Task 02 通过验收） |
| 2026-11-10 | Task 03A：完成 Workspace / Session / 派发 / 权限 API 验证，区分 public Host / Client / @Remote / 内部接口；记录于 api-notes | 已完成 |
| 2026-11-10 | Task 03A：Host 只读执行上下文（Workspace / 会话候选 / 可用性）+ `execution-context` HTTP 操作；Client 执行前配置预览 UI（工作区 / 策略 / 来源会话 / 摘要 / 校验） | 已完成 |
| 2026-11-10 | Task 03A 验证：build / typecheck / check / test（67/67）通过；未创建 / Fork / 恢复真实会话，未调用 plugin_manager | 已完成 |
| 2026-11-10 | Task 03A 审查修复：Session 空白状态改为三态（确认空白/确认非空白/无法确认），通过只读日志 `turn/start` 判定；无法确认时保守排除；77/77 测试通过 | 已完成 |
| 2026-11-10 | Task 03B 技术方案文档（三种策略 API、Session 产生/恢复/Fork、幂等与失败恢复） | 已完成 |
| 2026-11-10 | Task 03A 浏览器交互与中英文 / 明暗主题人工验收 | 已完成（核心 UI 验收通过） |
| 2026-11-10 | Task 03B 架构验证：确认 Client `ctx.sessions.create/fork` + `SessionFace.prompt` 走正常 Remote/Peer 授权链路；Host 不直调 @Remote；输出推荐调用链、协调协议与风险 | 已完成 |
| 2026-11-10 | Task 03B 架构验证产物：`validateDispatchPreconditions` / `describeSessionChoice` 纯函数 + 测试；设计文档与 api-notes 更新；build/typecheck/check/test（83/83） | 已完成 |
| 2026-11-10 | Task 03B 实现（0.4.0）：Client 授权链路 create/fork/retain/prompt + Host 执行意图/独立执行记录域/日志核验/候选绑定 + UI 接通；111/111 测试通过 | 已完成 |
| 2026-11-10 | Task 03B 第一轮审查修复（0.4.1）：未解决执行防重/显式放弃、保守异常分类、Host 回执失败待核验、状态机临界区与 accepted 保护、中断宽限、目标绑定复核；129/129 测试通过 | 已完成 |
| 2026-11-10 | Task 03B 第二轮审查修复（0.4.2）：非幂等 create/fork 独占执行权租约、clientRequestId 完整参数幂等比较、unknown 安全 Prompt 重试授权；139/139 测试通过 | 已完成 |
| 2026-11-10 | Task 03B 第三轮审查修复（0.4.3）：复用共享 Session、reuse 失败恢复、旧 dispatching 接口收紧、Prompt 重试严格按日志结果授权；148/148 测试通过 | 已完成 |
| 2026-11-11 | Task 03B 最终 UI 收尾（0.4.4）：历史未解决执行选择/恢复、reuse 恢复二次确认、来源/目标 Session 展示、UI single-flight；154/154 测试通过 | 已完成 |
| 2026-11-11 | Task 03B 初始化与门禁修复（0.4.5）：Host 依赖惰性解析、execution-capability 能力探测、Client 统一派发门禁、历史空状态、Session 短 ID/去重；164/164 测试通过 | 已完成 |
| 2026-11-11 | Task 03B 派发前置校验收紧（0.4.6）：Session Persistence 实际读取探测、acquire 前 Host 复核 Workspace/Session、reuse/fork 来源复核、Client 来源会话门禁；新增回归测试 | 已实现，待自动化回归与 GUI 验收 |
| 2026-11-11 | 0.4.7 修复 Client currentConfirmGate 漏传策略与来源 Session 状态；抽取并测试 selectedSourceSessionGate，修复 pnpm build 编译错误 | 已提交，待本地构建与 GUI 复验 |
| 2026-11-11 | Task 03C 现代工作台设计基线：确定 DSH 主题继承、工作台 / 详情 / 执行配置 / 时间线、Workspace 语义和旧 Execution 兼容边界 | 设计已写入仓库，待实施 |
| 2026-11-10 | Task 03B 真实 GUI 派发、刷新/重启恢复、三策略与中英文/明暗主题人工验收 | 待完成（由用户明确确认后触发） |
| 2026-11-10 | 等待用户确认 Task 03B 实现方案 | 待完成 |

## 已知开放问题

| # | 问题 | 影响 | 当前处理 |
| --- | --- | --- | --- |
| 1 | 会话新建 / 复用 / Fork 与派发 API 的形态与稳定性 | Task 03B 的派发层设计，可能需要随官方接口调整 | **已定案并实现**：Client 正常 Remote 授权链路（`ctx.sessions.create/fork` + `SessionFace.prompt`），Host 不直调 @Remote；见 [api-notes.md](api-notes.md) 与 [task-03b-design.md](task-03b-design.md) |
| 2 | 待办持久化选型 | 数据位置、备份、升级迁移与卸载行为 | **已解决**：Todo 使用 `task_inbox`（v2，不迁移）；执行记录使用独立 `task_inbox_executions`（v1）；卸载保留、手动删除可清理；见 README「数据、备份与卸载」 |
| 3 | 缺少自动化视觉 / 交互验证（无截图回归、无浏览器控制） | Task 02/03A/03B 的界面与端到端交互只能人工验收 | 以人工验收清单为准，Task 05 再评估自动化手段 |
| 4 | 包名、版本策略与发布渠道（npm / 本地 / 远程仓库）未定 | 安装文档与发布流程；当前阶段明确不发布 npm | Task 05 前决策；仓库地址已确定 <https://github.com/CoderL789/dsh-task-inbox> |
| 5 | 自动化测试策略：无 UI 测试；Host/Client 编排单测为主 | 回归保障与发布信心 | Task 03B 已增至 111 个测试（Host + Client mock 编排）；UI 测试 Task 05 评估 |
| 6 | 完整国际化覆盖范围与 `locale/*.json` 的用途未定（`locale/*.json` 目前仅含插件元信息，界面文案由 Client 半区内联字典提供） | Task 05 的 i18n 工作量与文案维护方式 | Task 05 前确认，可考虑把字典抽到共享资源 |
| 7 | Client locale 字典 disposer 生命周期 | 插件重载时重复注册风险 | **已修复**：字典注册包在 `ctx.effect` 中，返回 disposer；重载时先释放旧字典 |
| 8 | 排序原子性 / 部分提交风险 | 数据一致性与用户信任 | **已解决**：v2 将整份有序列表存为单个 global 状态，每次变更一次原子写；失败保持原状态，有并发 / 失败测试覆盖 |
| 9 | 多标签页 / 多窗口无实时同步 | 其他窗口的修改需刷新才可见 | 当前单窗口使用场景可接受；如需要可在后续用 `domain/changed` + Remote 实现 |
| 10 | 本阶段不做「标记完成」 | 待办状态固定 `todo` | 有意为之，Task 04 随执行状态机一起设计 |
| 11 | v1 旧数据在线迁移 | 用户下次重载插件时才会发生 | **已完成**：插件热重载自动迁移；2 条真实待办数据核对保留，并另存只读备份 |
| 12 | 整表重写带来的写放大与多进程写同一存储域不受支持 | 列表极大或双进程场景下性能 / 一致性 | 个人待办量级可接受；多进程场景不支持，文档已注明 |
| 13 | 存储写入结果不确定（可能在 rename 之后失败） | 可能误报失败/成功或基于过期内存继续写 | **已修复**：Todo 与执行记录域均区分确定/不确定，关闭重开存储域后按磁盘状态判定；无法恢复时进入保护态要求重启 |
| 14 | ~~Task 03B 派发主路径依赖 @Remote~~ | — | **已解决**：改用 Client 授权 Remote 链路；Host 仅 public API 校验/持久化 |
| 15 | Task 03A 预览的信息限制 | 冷会话无标题；归档状态与「已完成轮次」无法在预览阶段确认 | UI 以 warning 明确提示；会话空白三态已修复；真实派发由 Host 重新校验 + Remote 最终裁决 |
| 16 | Task 03B 方案已确认 | 是否接受 Client `ctx.sessions.create/fork` + `SessionFace.prompt` 的“随版本发布的 Client 契约” | **已确认并实现**；契约风险保留在风险清单，升级 DSH 需回归 |
| 17 | Client `sessions.create/list` 未出现在 inspect 方法目录 | 可能为未文档化 Client 契约，升级可能变化 | 依赖点集中在 Client 派发编排模块；升级 DSH 时回归；失败时降级“派发不可用” |
| 18 | Fork 无幂等键 | 未知结果可能重复 child | 不自动重试；Host 只读列出候选，由用户手动绑定；记录 unknown |
| 19 | ~~执行记录需要 domain v3 迁移~~ | — | **已改为**独立执行记录域 `task_inbox_executions`（v1），Todo 域 v2 不迁移；现有 Todo 数据零改动 |
| 20 | 真实 GUI 派发与刷新/重启恢复未人工验收 | 首次真实派发风险与恢复流程 | 第一轮审查问题已修复并回归；由用户明确确认后在 GUI 触发验收；开发 Agent 未对真实 Workspace/Session 执行测试 |
| 22 | 未解决执行需要人工放弃才能开始新执行 | 用户可能觉得受阻塞 | 恢复优先（检查/候选/继续）；放弃需二次确认并保留已创建 Session；在途 dispatching 不允许放弃 |
| 23 | 创建/Fork 执行权租约过期后不重新发放 | 若持有者崩溃，执行可能停在 dispatching | 超过 120s 后状态查询转 unknown，只能走候选/人工恢复，不会自动重发创建/Fork |
| 21 | Host 无法预检 archive 状态 / 已完成轮次 | 预览/意图校验可能过于乐观 | 由真实 Remote prompt 的 Host 规则最终裁决；失败错误码原样记录 |

注：当前阶段未发布到 npm；安装均以本地插件包绝对路径为准。仓库地址：<https://github.com/CoderL789/dsh-task-inbox>。
