# DSH Task Inbox（待办箱）

> 一个与「会话」解耦的智能待办插件，为 DeepSeek Harness（DSH）而写：先收集，后执行。

仓库地址：<https://github.com/CoderL789/dsh-task-inbox>（本阶段不发布到 npm）

DSH Task Inbox 让你把想做的事先记下来，而不是立刻塞进某个对话。待办归属于插件而不是某个会话；真正要执行时，再选择一个工作区，并决定以哪种方式交给 Agent：

- **新建会话**：为这条待办开一个新会话；
- **复用已有会话**：把待办放进一个正在进行的会话；
- **从已有会话 Fork**：基于某个会话的上下文分出一条新会话。

执行后由插件记录执行结果。待办因此可以跨会话、跨上下文、跨重启地存活。

> 当前处于 **Task 02：待办管理与持久化**（实现完成，待用户验收）。侧边栏入口与独立页面已可用，支持待办的新建、编辑、删除（二次确认）、列表展示与上移 / 下移；数据由 Host 持久化到插件独立存储域。**尚未**实现 Agent 执行、工作区选择与会话绑定（Task 03），也**不做**「标记完成」（避免与后续执行验收状态混淆）。详见[当前阶段与功能矩阵](#当前阶段与功能矩阵)。

## 为什么需要待办箱

- **想法与执行时机分离**：念头先落地成待办，不必为了「记一下」而开启对话、污染上下文。
- **待办不属于会话**：换会话、开新会话、Fork 分支都不会丢失待办；待办箱是一个独立的收件箱。
- **执行时再决策**：工作区与会话策略在真正执行时才确定，减少误操作与无关上下文的引入。
- **执行可追踪**：每次执行都关联工作区、会话与结果，历史可回溯（规划于 Task 04）。

## 核心概念

| 概念 | 含义 |
| --- | --- |
| **待办（Todo）** | 一条独立收集的待执行事项，归属于插件而非任何会话；可新建、编辑、删除、排序（Task 02 已实现）。 |
| **工作区（Workspace）** | 执行待办时选择的文件上下文（工作目录），决定 Agent 在哪个项目里干活（规划于 Task 03）。 |
| **会话绑定（Session Binding）** | 待办实际执行时选择的会话策略（新建 / 复用 / Fork）以及绑定到的具体会话（规划于 Task 03）。 |
| **执行记录（Execution）** | 一次执行的状态、绑定的会话与工作区、时间与结果摘要，用于追踪与回溯（规划于 Task 04）。 |

## 当前阶段与功能矩阵

当前为 **Task 02：待办管理与持久化**。已具备：

- 独立插件包（包名 `dsh-task-inbox`，版本 `0.2.0`）：bundle patch + Host/Client 双层 TypeScript 源码，构建输出 JS；
- **Host 半区**：通过 `ctx.storageDomain` 打开插件独立存储域 `task_inbox`（JSON 后端、单文件布局），经 `DomainTodoRepository` → `TodoService` 提供校验、CRUD、排序与幂等创建；通过一个受认证的同源 HTTP 端点 `POST /plugins/dsh-task-inbox/api` 暴露给 Client；
- **Client 半区**：侧边栏「Task Inbox」/「待办箱」入口 + 独立页面；新建 / 编辑表单、列表（标题、描述、创建时间）、删除二次确认、上移 / 下移、加载中 / 成功 / 失败反馈；中文与英文文案；明暗主题适配；
- 数据模型：`id`、`title`、`description`、`status`（本阶段仅 `todo`）、`createdAt`、`updatedAt`、`order`；
- 25 个 Node 单元测试覆盖校验、排序、CRUD、幂等、存储失败映射与 API 处理器。

| 能力 | Task 02 | 后续 |
| --- | --- | --- |
| 作为独立 DSH 插件安装 / 卸载 | ✅ 已具备 | — |
| 侧边栏入口「Task Inbox」/「待办箱」 | ✅ 已具备 | — |
| 独立页面与空状态 | ✅ 已具备 | — |
| 待办创建 / 编辑 / 删除（二次确认） | ✅ 已具备 | — |
| 手动排序（上移 / 下移） | ✅ 已具备 | — |
| 待办持久化（跨刷新 / 会话切换 / 重启） | ✅ 已实现，重启持久化待用户验收 | — |
| 中英文界面与明暗主题 | ✅ 已具备 | Task 05 完整验收 |
| 工作区选择 | ❌ | Task 03 |
| 会话策略：新建 / 复用 / Fork | ❌ | Task 03 |
| 执行派发与 Agent 执行 | ❌ | Task 03 |
| 执行状态、历史与结果关联 | ❌ | Task 04 |
| 「标记完成」 | ❌（本阶段有意不做） | Task 04 随执行状态设计 |
| 自动化 UI 测试 | ❌ | Task 05 评估 |

> 注：Host 层构建、类型、单元测试与安装后的路由 / 注册校验已通过；浏览器中的实际交互、刷新与重启后的数据保留需要人工验收（本环境无浏览器控制能力）。

## 使用

1. 在 Harness 左侧边栏的全局面板图标区点击 **Task Inbox**（中文界面为「待办箱」），打开独立页面；
2. 点击 **新增待办**，填写标题（必填，最多 200 字）与描述（可选，最多 2000 字）后保存；
3. 列表展示标题、描述与本地化创建时间；每行提供上移 / 下移 / 编辑 / 删除；
4. 删除需要二次确认：点击删除后行内出现「确认删除 / 取消」，确认后才会删除；
5. 所有写操作成功后显示短暂成功提示；失败时显示错误提示，且不会把失败显示成成功；
6. 添加待办只保存数据，**不会自动执行 Agent**。

## 数据、备份与卸载

- **数据位置**：`$DSH_HOME/storages/task_inbox.json`（JSON 后端 root 为 `$DSH_HOME/storages`，插件存储域名为 `task_inbox`、布局为 `single`）。Windows 测试环境为 `C:\Users\<user>\.dsh\storages\task_inbox.json`。文件在第一次写入待办时创建，内容为可读的格式化 JSON，每次写入通过原子替换落盘。
- **备份**：在 DSH 空闲或已停止时复制上述文件即可；恢复时停止 DSH、用备份覆盖该文件，再启动 DSH。
- **卸载保留策略**：通过官方插件管理器 `remove_bundle` 卸载只移除插件代码与注册，**不会删除** `task_inbox.json`；重新安装后待办仍在。若需彻底清除数据，请先停止 DSH，再手动删除该文件。
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
pnpm test           # node:test 运行 Host 单元测试（校验 / 排序 / CRUD / API）
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
│   │   ├── index.ts      # 插件入口：开存储域、组装服务、注册受认证 HTTP 路由
│   │   ├── domain.ts     # 存储域声明（domain `task_inbox`、table `todos`、zod schema）
│   │   ├── model.ts      # 记录模型、校验、排序 / 移动（纯函数）
│   │   ├── store.ts      # storage domain 之上的仓储适配
│   │   ├── service.ts    # CRUD 服务（时间戳、排序、幂等、错误映射）
│   │   └── api.ts        # HTTP 端点、请求解析、认证与响应封装
│   └── client/index.ts   # Client 半区：侧边栏入口 + CRUD 页面 + 中英文案
├── test/                 # Host 单元测试（node:test）
├── lib/                  # 构建产物（提交供直接安装）
├── docs/
│   ├── api-notes.md      # DSH 插件 API 调研笔记与 Task 02 实现确认
│   └── roadmap.md        # 路线图与阶段验收标准
├── README.md
├── LICENSE
└── .gitignore
```

## 文档

- [docs/roadmap.md](docs/roadmap.md)：Task 01–05 的路线图、交付物、验收标准、风险、进度与开放问题；
- [docs/api-notes.md](docs/api-notes.md)：DSH 插件 API 调研笔记（存储、Host/Client 通信、UI 扩展点等）。

## 路线图

| 阶段 | 主题 | 状态 |
| --- | --- | --- |
| Task 01 | 最小可运行插件骨架（插件包、侧边栏入口、空状态页、文档） | 完成（已通过验收） |
| Task 02 | 待办数据模型与持久化 + CRUD 界面 | 实现完成（待用户验收） |
| Task 03 | 工作区 / 会话选择与执行派发（新建 / 复用 / Fork） | 待开始 |
| Task 04 | 执行追踪（状态、历史、结果关联） | 待开始 |
| Task 05 | 打磨（国际化、可访问性、打包与开源发布准备） | 待开始 |

各阶段的交付物、验收标准与风险见 [docs/roadmap.md](docs/roadmap.md)。

## 已知限制

- 本阶段不提供「标记完成」，待办状态固定为 `todo`；
- 不提供 Agent 执行、工作区选择、会话创建 / 复用 / Fork（Task 03）；
- 没有跨标签页 / 多窗口实时同步：列表在页面挂载时加载，其他窗口的修改需刷新后可见；
- 上移 / 下移按记录逐条落盘，若存储中途失败可能留下部分已更新的顺序（顺序值仍合法，可重试）；
- 创建去重（`requestId`）仅在内存中保留 10 分钟，用于抵御快速重复提交，DSH 重启后失效；
- 暂无自动化 UI 测试；视觉与完整交互需人工验收。

## 贡献

- 仓库地址：<https://github.com/CoderL789/dsh-task-inbox>；
- 当前处于 Task 02 阶段、等待人工验收，目录结构、脚本与内部接口可能随阶段推进调整，请以最新提交为准；
- 现阶段未发布到 npm，正式贡献流程（issue / PR 模板、分支策略）将在后续阶段补充；在此之前欢迎通过仓库反馈问题；
- 提交内容需与路线图阶段目标一致，并保持 `pnpm build` / `typecheck` / `check` / `test` 通过。

## 许可与声明

本项目采用 [MIT](LICENSE) 许可。

> **声明**：DSH Task Inbox 是一个独立的社区项目，与 DeepSeek 官方无隶属或背书关系；「DeepSeek Harness / DSH」相关名称与商标归其所有者。本项目仅以插件形式与 DSH 集成，不修改 DSH 本体。

当前阶段说明：本插件尚未发布到 npm；安装请使用本地插件包目录的绝对路径。
