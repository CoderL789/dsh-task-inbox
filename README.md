# DSH Task Inbox（待办箱）

> 一个与「会话」解耦的智能待办插件，为 DeepSeek Harness（DSH）而写：先收集，后执行。

仓库地址：<https://github.com/CoderL789/dsh-task-inbox>（本阶段不发布到 npm）

DSH Task Inbox 让你把想做的事先记下来，而不是立刻塞进某个对话。待办归属于插件而不是某个会话；真正要执行时，再选择一个工作区，并决定以哪种方式交给 Agent：

- **新建会话**：为这条待办开一个新会话；
- **复用已有会话**：把待办放进一个正在进行的会话；
- **从已有会话 Fork**：基于某个会话的上下文分出一条新会话。

执行后由插件记录执行结果。待办因此可以跨会话、跨上下文、跨重启地存活。

> Task 01–03A 已通过验收；Task 03B 0.4.7 的执行派发与恢复链路已实现；Task 03C Modern Workbench 主体功能已提交至 `feature/task-03c-modern-workbench`。该分支最新 CI 已通过 build / typecheck / check / 全量测试；仍待在 DSH GUI 中验收 390px 布局、明暗主题、键盘 / 触屏和真实刷新恢复。真实 Session 创建 / Fork / Prompt 仍只由用户明确触发。本分支 `src/` 已更新，但提交的 `lib/` 构建产物尚未同步；安装前需在本地运行 `pnpm build` 并更新 `lib/`。详见[当前阶段与功能矩阵](#当前阶段与功能矩阵)、[Task 03B 设计稿](docs/task-03b-design.md)和[Task 03C 设计稿](docs/task-03c-design.md)。

## 为什么需要待办箱

- **想法与执行时机分离**：念头先落地成待办，不必为了「记一下」而开启对话、污染上下文。
- **待办不属于会话**：换会话、开新会话、Fork 分支都不会丢失待办；待办箱是一个独立的收件箱。
- **执行时再决策**：工作区与会话策略在真正执行时才确定，减少误操作与无关上下文的引入。
- **执行可追踪**：每次派发都关联工作区、来源 / 目标会话与状态；关键派发事件可持久化回溯。Agent Turn、完成状态与结果摘要属于 Task 04。

## 核心概念

| 概念 | 含义 |
| --- | --- |
| **待办（Todo）** | 一条独立收集的待执行事项，归属于插件而非任何会话；可新建、编辑、删除、排序（Task 02 已实现）。 |
| **工作区（Workspace）** | 执行待办时选择的文件上下文（工作目录），决定 Agent 在哪个项目里干活（规划于 Task 03）。 |
| **会话绑定（Session Binding）** | 待办实际执行时选择的会话策略（新建 / 复用 / Fork）以及绑定到的具体会话（规划于 Task 03）。 |
| **执行记录（Execution）** | 一次派发的状态、工作区、来源 / 目标会话和有证据的事件时间线；Agent Turn 与完成结果属于 Task 04。 |

## 当前阶段与功能矩阵

当前插件包版本仍为 **0.4.7**。Task 03B 派发链路已实现；Task 03C 主体实现位于 `feature/task-03c-modern-workbench`，最新 CI 的 build / typecheck / check / test 已通过。当前仍待 DSH GUI 人工验收；本分支提交的 `lib/` 尚未由最新 `src/` 重新生成。当前已具备：

- 独立插件包（包名 `dsh-task-inbox`，版本 `0.4.7`）：bundle patch + Host/Client 双层 TypeScript 源码，构建输出 JS；
- **Host 半区**：Todo 存储域 `task_inbox` 保持 v2 不变、**不迁移/不重写**；新增独立执行记录域 `task_inbox_executions`（v1、JSON 单文件），用于执行意图/关联/状态持久化。Host 通过受认证 HTTP 端点 `POST /plugins/dsh-task-inbox/api` 提供 Todo CRUD、只读 `execution-context`、`execution-intent` / `execution-session` / `execution-dispatching` / `execution-result` / `execution-status` / `execution-candidates` / `execution-bind` 等协调操作；派发前用 public Host 服务重新校验 Todo/Workspace/Session，并**只读扫描 Session 日志中的 requestId（user/message source.rpcId）独立核验接受结果**；
- **Client 半区**：侧边栏「Task Inbox」/「待办箱」入口 + 独立页面；Todo CRUD；Modern Workbench（概览、搜索、状态 / Workspace / 策略筛选、排序、待办列表、响应式详情视图）；详情展示最近执行摘要、来源 / 目标 Session、执行历史和事件时间线；执行配置改为参数区 + 摘要区双栏布局；「确认并派发」继续通过 `ctx.sessions.create/fork`（正常 Remote 授权链路）+ `ctx.sessions.retain` + `SessionFace.prompt(..., requestId)` 完成新建/复用/Fork 派发；派发中禁用、accepted/failed/unknown/session_ready 反馈、打开目标会话、候选会话人工核对/绑定与安全继续；中英文与 DSH 明暗主题 token 适配；
- 数据模型：Todo 字段不变；执行记录包含 `executionId`、稳定的 `requestId`、`clientRequestId`、Todo 快照、策略、Workspace 快照、来源/目标 Session、状态（prepared/session_ready/dispatching/accepted/failed/unknown）、错误码与时间戳；
- Node 测试覆盖 Todo / 存储 / 迁移 / HTTP、执行上下文、派发前置校验、Host 状态机并发 / 恢复 / 核验 / 放弃 / 候选绑定 / 执行权租约 / Prompt 重试授权、Execution 事件向后兼容、overview 只读字段与 Session 标题降级，以及 Client 派发编排异常路径；最新 CI 已通过全量测试。

| 能力 | 当前 | 后续 |
| --- | --- | --- |
| 作为独立 DSH 插件安装 / 卸载 | ✅ 已具备 | — |
| 侧边栏入口「Task Inbox」/「待办箱」 | ✅ 已具备 | — |
| 独立页面与空状态 | ✅ 已具备 | — |
| 待办创建 / 编辑 / 删除（二次确认） | ✅ 已具备 | — |
| 手动排序（上移 / 下移） | ✅ 已具备 | — |
| 待办持久化（跨刷新 / 会话切换 / 重启） | ✅ 已实现 | — |
| 中英文界面与明暗主题 | ✅ 已具备 | Task 05 完整验收 |
| 执行前配置预览（工作区 / 策略 / 来源会话 / 校验） | ✅ 已具备 | — |
| 工作区选择（真实绑定） | ✅ 派发时写入执行记录 | — |
| 会话策略：新建 / 复用 / Fork（真实创建/恢复） | ✅ Task 03B（Client 授权 Remote） | — |
| 执行派发与 Agent 执行 | ✅ 已实现（接受确认 + 独立核验；三轮审查修复完成；未真实测试） | — |
| 执行状态、历史与结果关联 | ✅ 派发状态机、恢复入口与历史已具备；Task 03C 增加持久化派发事件时间线 | Agent Turn / 完成状态属于 Task 04 |
| 历史未解决执行选择与恢复 | ✅ 最终 UI 收尾（按 Execution 各自的 ID/requestId/快照） | — |
| 历史空状态 / 派发能力门禁 | ✅ 0.4.5（加载失败不误显示为空；能力不可用禁用派发） | — |
| Session 标签区分（短 ID） | ✅ 0.4.5（标题/未命名/空白/状态未知均含可区分短 ID） | — |
| Modern Workbench 首页（概览 / 搜索 / 筛选 / 排序） | 🟡 已实现，待 GUI 验收 | Task 03C-05 |
| 任务详情与 Workspace / 策略 / 来源 / 目标 Session 摘要 | 🟡 已实现，待 GUI 验收 | Task 03C-05 |
| 双栏执行配置工作区 | 🟡 已实现，待 GUI 验收 | Task 03C-05 |
| Execution 持久化事件时间线 | 🟡 已实现，含来源 / 目标 Session、关联方式与错误码，待 GUI 验收 | Agent Turn 完成状态属于 Task 04 |
| 来源会话 / 目标会话区分展示 | ✅ 新建仅目标；复用可合并；Fork 分别展示 | — |
| 「标记完成」 | ❌（本阶段有意不做） | Task 04 随执行状态设计 |
| 自动化 UI 测试 | ❌ | Task 05 评估；当前由 Node / CI 回归 + 人工 GUI 验收 |

> 注：最新分支 CI 已通过 build / typecheck / check / 全量 Node 测试；这不替代 DSH GUI 验收。真实派发、刷新 / 重启恢复、浅色 / 深色 / system 主题、390px 窄屏与键盘 / 触屏仍需人工验收。开发 Agent 未对真实 Workspace / Session 发起测试执行。

## 使用

1. 在 Harness 左侧边栏的全局面板图标区点击 **Task Inbox**（中文界面为「待办箱」），打开独立页面；
2. 点击 **新增待办**，填写标题（必填，最多 200 字）与描述（可选，最多 2000 字）后保存；
3. 首页展示待办概览和列表；可按标题 / 描述搜索，并按执行状态、最近使用的 Workspace、策略筛选，或按手动顺序 / 最近更新 / 创建时间排序；
4. 选择待办后查看详情：完整描述、最近一次执行摘要、来源 / 目标 Session 和历史执行时间线；窄窗口下详情切换为独立视图，可返回列表；
6. 每条待办仍可手动上移 / 下移、编辑、删除；删除需要二次确认：点击删除后行内出现「确认删除 / 取消」，确认后才会删除；
6. 所有写操作成功后显示短暂成功提示；失败时显示错误提示，且不会把失败显示成成功；
7. 添加待办只保存数据，**不会自动执行 Agent**；
8. 点击待办行上的「执行」图标打开执行前配置：选择工作区、会话策略（新建 / 复用 / Fork）与来源会话，查看摘要与校验提示；
9. 点击「确认并派发」后：Host 先重新校验并保存执行意图（同一 Todo 若已有未解决执行会被服务端拒绝）；Client 通过 DSH 正常 Remote 授权链路创建/复用/Fork Session（新建使用实际返回的 Session ID；Fork 默认 `allowMigration:false`），先持久化目标 Session 再以同一 `requestId` 通过 `SessionFace.prompt(..., 'queue')` 发送任务；Host 再从 Session 日志独立核验是否被接受；
10. 结果未确认时（unknown / dispatching / session_ready / prepared）**不会直接允许重新创建/Fork**：界面优先提供「检查状态」「继续派发」「核对候选会话/绑定」「恢复已有执行」；若要发起全新执行，必须先显式「放弃此执行」（二次确认；已创建的会话不会被删除）；
11. 执行配置页的「历史未解决执行」区域会列出当前 Todo 的全部 prepared / session_ready / dispatching / unknown 执行（即使最新一条已 accepted 也不会隐藏较早的未解决记录）。选择一条只查看/恢复，不会自动创建、Fork 或发送；复用记录若 targetSessionId 缺失，可用「恢复绑定并继续派发」并在二次确认后恢复原来源 Session（不会创建新会话）；
12. 执行详情区分「来源会话」与「目标会话」：新建仅显示目标；复用时可合并展示来源/目标；Fork 分别显示来源与目标；未命名会话优先显示短 Session ID/创建时间；
13. 执行配置页始终显示历史区域状态：加载中、加载失败（可重试）或「暂无未解决执行」；Host 派发能力不可用时显示具体原因并禁用派发，重新检查成功后才可继续；
14. 来源会话下拉框每个选项都带可区分短 Session ID（默认 8 位，冲突时自动延长），并按完整 Session ID 去重；不会因名称相同合并不同会话；
15. Prompt 已被 DSH 接受但 Host 结果写入失败时，记录保持 `dispatching` 并保留 executionId/requestId/目标 Session，稍后可通过「检查状态」按日志核验，不会重新创建会话；
16. 开发 Agent 未对真实 Workspace/Session 发起过测试执行；首次真实派发及恢复验收需由你明确点击确认触发。

## 数据、备份与卸载

- **数据位置**：
  - Todo：`$DSH_HOME/storages/task_inbox.json`（域 `task_inbox`，v2，本阶段**不迁移、不重写**）。
  - 执行记录：`$DSH_HOME/storages/task_inbox_executions.json`（域 `task_inbox_executions`，v1，独立文件；仅在实际创建执行意图时写入）。执行记录包含不可变 Prompt 快照（Todo 标题/描述）、策略、Workspace/Session 关联、状态与错误码。
- **原子性与迁移**：v2 数据格式把整条有序列表保存在域 global 状态里，任何一次新建 / 编辑 / 删除 / 排序都通过**一次** `global.set` 落盘（底层为临时文件 + fsync + 原子 rename），因此排序不会出现“部分提交”。旧版 v1 的逐条记录会在插件启动时**一次性迁移**为 v2：迁移写入成功后才标记完成并清理旧记录，迁移写入失败会中止插件激活（不会用空列表覆盖旧数据）。
- **写入结果不确定时的处理**：若写入报错属于“确定未提交”（序列化/域层拒绝）则直接返回失败；若错误可能发生在文件 rename 之后（底层 I/O/`unknown-state`，磁盘可能已更新但 API 报错），插件会**关闭并重新打开存储域**，从磁盘重新加载数据后与本次尝试比对：确认已提交则按成功处理，确认未提交才返回失败；若重新加载失败或磁盘状态与预期都不一致，则进入“结果不确定”保护态——后续读写全部拒绝并提示重启/重载 DSH，**不会基于可能过期的内存继续写入，也不会声称数据未被修改**。
- **备份**：在 DSH 空闲或已停止时复制上述两个文件；恢复时停止 DSH、用备份覆盖后重新启动。执行记录是派发恢复的依据，建议与 Todo 一起备份。
- **卸载保留策略**：通过官方插件管理器 `remove_bundle` 卸载只移除插件代码与注册，**不会删除** `task_inbox.json` 与 `task_inbox_executions.json`；重新安装后数据仍在。若需彻底清除数据，请先停止 DSH，再手动删除这两个文件。
- 插件不会修改 Profile 配置，也不会读写其他插件的数据。

## 安装

本插件通过 **DSH 官方插件管理器**（`plugin_manager`）安装为本地 bundle，安装目标为插件包所在目录的**绝对路径**（Windows 下形如 `D:\Workspace\lxd\github\dsh-task-inbox`）。

前置条件：已按「[开发](#开发)」安装依赖并构建，插件包目录内的 `lib/`（构建产物）为最新。

步骤（具体界面文案因 DSH 版本而异，以下仅为操作要点）：

1. 在 DSH 中打开插件管理器，执行 bundle 安装（`install_bundle`），目标填写本插件包目录的绝对路径；
2. 当前阶段未发布到 npm，请勿填写 npm 包名；仓库虽已公开，但请勿使用未经说明的远程安装地址；
3. 安装完成后，在侧边栏确认出现「Task Inbox」入口，点击打开独立页面。

关于生效范围与重载：

- 安装 **profile 级生效**：同一 profile 下的会话共享同一套已安装插件，而不是只对某个会话生效；
- 安装或升级后如果入口 / 页面没有出现，按官方插件加载行为重载插件或重启 DSH 再试；
- 开发期间 Host/Client 产物变更后，是否自动热更新取决于当前 DSH 版本与运行方式；刷新页面或重启 DSH 是稳定的验证方式。

## 开发

环境：Node.js ≥ 20 + pnpm（见 `package.json` 的 `engines`）。

```bash
pnpm install        # 安装依赖（若公司 registry 对 tarball 返回 401，可加 --registry=https://registry.npmjs.org/）
pnpm build          # TypeScript 源码 → lib/，供 DSH 加载
pnpm typecheck      # 仅类型检查（tsc --noEmit），不产出文件
pnpm check          # node --check 校验 lib/ 下产物的 JS 语法
pnpm test           # node:test：Todo/存储/迁移/HTTP/执行上下文/派发协调/Client 编排
```

说明：

- `build` 由 `tsconfig.json` 驱动：源码在 `src/`，产物在 `lib/`（`rootDir` / `outDir`）；
- 运行时依赖 `zod@4.4.3`（与 DSH 存储域记录 schema 版本一致）；
- `lib/` 为安装所需产物，**有意提交到仓库**：这样直接检出仓库即可通过官方插件管理器安装；修改 `src/` 后请重新执行 `pnpm build` 并一同提交产物；
- 构建产物由构建过程生成，请勿手工修改。

## 项目结构

```text
dsh-task-inbox/
├── package.json          # 插件包清单与脚本（bundle patch / client / 依赖）
├── cordis.patch.yml      # Cordis bundle patch（插件挂载）
├── tsconfig.json         # TypeScript 构建配置
├── icon.svg              # 插件图标
├── locale/
│   ├── en.json           # 插件元信息（英文）
│   └── zh.json           # 插件元信息（中文）
├── src/
│   ├── host/
│   │   ├── index.ts      # 插件入口：开 Todo/执行记录域、组装服务、注册路由
│   │   ├── domain.ts     # Todo 存储域声明（v2，保持不变）
│   │   ├── model.ts      # Todo 模型、校验、排序 / 移动（纯函数）
│   │   ├── store.ts      # Todo storage domain 仓储与恢复
│   │   ├── service.ts    # Todo CRUD 服务
│   │   ├── api.ts        # HTTP 端点、参数校验、认证与响应封装
│   │   ├── execution-context.ts  # 执行前配置：Workspace / 会话候选与空白三态（只读）
│   │   ├── execution-model.ts    # 执行记录模型与状态
│   │   ├── execution-store.ts    # 独立执行记录域 + 串行化/恢复
│   │   ├── execution-service.ts  # 意图、重新校验、状态机、日志核验、候选
│   │   └── dispatch-plan.ts      # 派发前置校验与未命名会话显示（纯函数）
│   └── client/index.ts   # Client 半区：入口 + CRUD + 执行配置 + 派发编排/UI
├── test/                 # Host + Client 编排单元测试（node:test）
├── lib/                  # 构建产物（提交供直接安装）
├── docs/
│   ├── api-notes.md      # DSH 插件 API 调研笔记与实现确认
│   ├── task-03b-design.md # Task 03B 执行派发技术方案
│   └── roadmap.md        # 路线图与阶段验收标准
├── README.md
├── LICENSE
└── .gitignore
```

## 文档

- [docs/roadmap.md](docs/roadmap.md)：Task 01–05 的路线图、交付物、验收标准、风险、进度与开放问题；
- [docs/api-notes.md](docs/api-notes.md)：DSH 插件 API 调研笔记（存储、Host/Client 通信、UI 扩展点等）；
- [docs/task-03b-design.md](docs/task-03b-design.md)：Task 03B 执行派发技术方案（API 可行性、Session 产生/恢复/Fork、幂等与失败恢复）；
- [docs/task-03c-design.md](docs/task-03c-design.md)：Task 03C Modern Workbench UI 设计基线（主题继承、工作台、详情、执行配置、时间线与响应式验收）。

## 路线图

| 阶段 | 主题 | 状态 |
| --- | --- | --- |
| Task 01 | 最小可运行插件骨架（插件包、侧边栏入口、空状态页、文档） | 完成（已通过验收） |
| Task 02 | 待办数据模型与持久化 + CRUD 界面 | 完成（已通过验收） |
| Task 03A | 执行前配置与会话能力验证（仅预览，不派发） | 完成（已通过验收） |
| Task 03B | 执行派发（新建 / 复用 / Fork 接通） | 0.4.7 已提交，待本地构建与 GUI 复验 |
| Task 03C | Modern Workbench UI 重构 | 主体实现已完成，待 DSH GUI 验收 |
| Task 04 | Agent 执行追踪（Turn 状态、完成与结果关联） | 待开始；不把 Prompt accepted 当作完成 |
| Task 05 | 打磨（国际化、可访问性、打包与开源发布准备） | 待开始 |

各阶段的交付物、验收标准与风险见 [docs/roadmap.md](docs/roadmap.md)。

## 已知限制

- 本阶段不提供「标记完成」，待办状态固定为 `todo`；
- **派发可见性**：「accepted」仅表示 DSH 已接收 Prompt，不代表执行完成；完整执行状态机与历史属于 Task 04；
- **Client 契约风险**：派发依赖随版本发布的 Client `ctx.sessions.create/fork` 与 `SessionFace.prompt`（not Inspect 方法目录中的 `create/list`，但由 `ISessions` 类型与构建实现提供），非文档化第三方 API；升级 DSH 后需回归；
- **会话限制**：Host 使用的 public API 无法确认 archive 状态与「已完成轮次」，由真实 Remote prompt 的 Host 规则最终裁决；Fork 默认不迁移（`allowMigration:false`），需要迁移时必须由用户显式授权（当前 UI 未提供迁移选项）；
- **生命周期依赖**：`ExecutionService` 不再在插件 apply 阶段永久捕获 `workspaceRegistry/sessionPersistence/sessions/sessionTitle`，每次使用惰性解析；服务未就绪时返回 `execution_unavailable`，不会静默降级；
- **派发门禁**：`execution-status` 加载状态分 loading/loaded/error；`execution-capability` 按 Workspace/策略返回 `dispatchReady` 与原因；Client 在历史加载失败、能力不可用、存在未解决执行、Session API 缺失或派发进行中时禁止「确认并派发」以及继续/恢复/Prompt 重试入口；Host 写操作仍独立校验，不信任 Client 的 ready 标记；
- **Session 标签**：所有候选都有短 Session ID；同名前缀/未命名不再混淆；下拉框按完整 ID 去重；
- **幂等边界**：新建/Fork 没有 DSH 侧幂等键；Host 用 `execution-acquire` 在串行化 mutation 内切换 prepared→dispatching 并发放**执行权租约**（token + 过期时间）；只有 `acquired: true` 的 Client 才能调用 create/fork，其他并发/重试调用只能读取状态；租约不会重新发放，重启/超时后只能走 unknown/恢复。同一 `clientRequestId` 必须 todoId/workspaceId/strategy/sourceSessionId 完全一致才返回原记录，否则 `execution_conflict`；
- **Prompt 重试授权**：unknown + target 不会当作 session_ready 直接重发；Client 先刷新 Host 状态，Host 只读日志核验 accepted（已接受则不再发送）；日志不可读或扫描超限时不授权重试、保持 unknown；只有明确 not-found 才按同一 executionId/targetSessionId/requestId/不可变 Prompt 快照授权一次安全重试，且永不 create/fork；
- **会话复用**：一个 Session 可以关联多条 execution（每条独立 requestId）；不同 Todo、同一 Todo 在 accepted 后均可明确发起新的「复用」执行。新建/Fork 的目标 Session 仍受防冒领保护（不能被其他创建操作绑定）。
- **复用关联失败恢复**：若 reuse 的 targetSessionId 未保存但 sourceSessionId 已确定，Host `execution-reuse-recover` 会重新校验 Workspace/来源会话并用原始 executionId/requestId/Prompt 快照恢复绑定；不创建/Fork，先只读日志核验（日志不可读则保持 unknown，不自动派发）。
- **旧接口收紧**：`execution-dispatching` 只接受 `session_ready → dispatching` 的 Prompt 阶段转换；无 acquire 授权的 prepared execution 不能经旧接口进入创建/Fork 流程。
- **异常分类保守**：只有明确的 Host/Remote 业务拒绝码才视为确定失败；网络超时/连接中断即使带 `code` 也按 unknown 处理；
- **服务端防重与放弃**：同一 Todo 存在未解决执行时，Host 拒绝新的执行意图（`execution_unresolved`）；必须显式「放弃此执行」（二次确认）后才能发起新的独立执行；`dispatching` 在途时不允许放弃；
- **未确认结果恢复**：Prompt 已接受但 Host 结果更新失败时保持 `dispatching`，保留 executionId/requestId/目标 Session，通过只读日志核验恢复；不会因此创建新 Session；
- **绑定校验**：复用必须绑定原来源 Session；新建/Fork 目标必须晚于执行意图创建，且不能被其他执行占用；人工绑定候选按原策略复核，并标记 `bindingSource: manual`（Host 无法证明创建来源，需用户确认）；
- **中断判定宽限**：无目标的 `dispatching` 只有超过 120 秒仍无进展，状态查询才会标记 `dispatch_interrupted`，避免其他窗口轮询误判正在进行的创建/Fork；
- **页面刷新/关闭**：客户端无法完成结果上报时，Host 执行记录保留；重新打开页面会显示已有执行并允许检查/继续，不自动重派；
- 预览中的会话候选只基于 public Host API：空白状态三态（确认空白/确认非空白/无法确认），无法确认的会话保守排除；
- 冷会话无标题（显示占位标题 + 短 ID），归档状态在预览阶段不可确认；
- 没有跨标签页 / 多窗口实时同步；整表重写与多进程写同一存储域的限制沿用 Task 02；
- 写入结果不确定且自动重新加载存储域失败时进入保护态，需重启/重载 DSH（磁盘数据不会被删除或重置）；
- 暂无自动化 UI 测试；真实派发、历史未解决执行选择/恢复、刷新/重启恢复、明暗主题需人工验收。

## 贡献

- 仓库地址：<https://github.com/CoderL789/dsh-task-inbox>；
- 当前处于 Task 03B 阶段、等待人工验收，目录结构、脚本与内部接口可能随阶段推进调整，请以最新提交为准；
- 现阶段未发布到 npm，正式贡献流程（issue / PR 模板、分支策略）将在后续阶段补充；在此之前欢迎通过仓库反馈问题；
- 提交内容需与路线图阶段目标一致，并保持 `pnpm build` / `typecheck` / `check` / `test` 通过。

## 许可与声明

本项目采用 [MIT](LICENSE) 许可。

> **声明**：DSH Task Inbox 是一个独立的社区项目，与 DeepSeek 官方无隶属或背书关系；「DeepSeek Harness / DSH」相关名称与商标归其所有者。本项目仅以插件形式与 DSH 集成，不修改 DSH 本体。

当前阶段说明：本插件尚未发布到 npm；安装请使用本地插件包目录的绝对路径。
