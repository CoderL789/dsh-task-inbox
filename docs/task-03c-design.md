# Task 03C 设计方案：Modern Workbench UI

> 状态：**主体实现完成，待 DSH GUI 人工验收**。实现已提交至 `feature/task-03c-modern-workbench`；最新 CI 的 build / typecheck / check / 175 项 Node 测试全部通过。当前分支 `lib/` 尚未由最新 `src/` 重新生成；真实主题、窄屏、键盘 / 触屏和运行时行为仍需 GUI 验收。实现继续以 Task 03B Host 执行安全边界为准。

## 1. 背景与目标

当前 Client 页面把待办列表、编辑表单、执行配置、历史恢复都放在一个页面组件中，主要依赖单一文件中的内联 style 对象。随着 Task 03B 增加真实派发、并发保护、异常恢复和人工绑定，界面已经承担了较多复杂状态，但信息层级、空间组织和操作路径仍偏向早期 CRUD 原型。

Task 03C 将其升级为现代工作台：让用户能快速浏览和筛选待办，在不离开列表的情况下查看任务详情、Workspace 与执行历史，并在专门的执行配置界面中完成派发决策。

**目标：**

- 视觉与交互融入 DSH Web UI，不呈现为独立的第三方小工具。
- 完整继承 DSH 当前的浅色 / 深色 / 跟随系统主题。
- 以列表 + 详情的工作台布局管理待办。
- 提供搜索、状态筛选、Workspace 筛选、策略筛选和排序。
- 以最近执行记录展示 Workspace、策略和 Session 关联，不破坏 Todo 与 Session 解耦。
- 将执行配置升级为有实时摘要和校验反馈的双栏工作区。
- 将历史执行、状态变化和恢复操作组织成统一时间线。
- 保持中文 / 英文、键盘可用性、窄窗口适配和清晰的加载 / 错误 / 空状态。
- 不削弱 Task 03B 已有的 Host 权威校验、幂等、租约、并发保护和异常恢复。

**非目标：**

- 不把 Todo 永久绑定到某个 Workspace 或 Session。
- 不在 Task 03C 声称 Agent 已完成工作；**accepted** 只表示 DSH 已接受 Prompt。
- 不在本阶段实现 Agent 运行中进度、Turn 完成判定、结果摘要和取消能力；这些属于 Task 04。
- 不新增插件自有的主题偏好或另一套全局调色板。
- 不修改 Todo 域 task_inbox v2 的 schema，不重置或重写用户真实 Todo 数据。
- 不自动创建、Fork、恢复 Session 或发送 Prompt 作为 UI 验收的一部分。

## 2. 设计原则与 DSH 约束

### 2.1 DSH 原生主题继承

主题唯一权威是 DSH 的 dsh-client-ui-theme。插件不保存主题设置、不提供自己的 Light / Dark 开关，也不自行解析 prefers-color-scheme。

页面和组件只消费 DSH 主题语义变量；主题切换由宿主负责，插件不需要刷新或重新挂载：

| 用途 | Token |
| --- | --- |
| 页面基础背景 | --dsw-alias-bg-base |
| 一级表面 / 主卡片 | --dsw-alias-bg-layer-1 |
| 二级表面 / 嵌套区域 | --dsw-alias-bg-layer-2 |
| 浮层背景 | --dsw-alias-bg-overlay |
| 主文字 | --dsw-alias-label-primary |
| 次级文字 | --dsw-alias-label-secondary |
| 细边框 | --dsw-alias-border-l1 |
| 强边框 | --dsw-alias-border-l2 |
| 品牌强调 | --dsw-alias-brand-primary |
| 成功 / 警告 / 错误 / 空闲 | 对应 --dsw-alias-state-* |

约束：

- 不写固定浅色 / 深色颜色值，不写 body[data-ds-dark-theme] 等主题分支。
- 不用半透明白色 / 黑色模拟主题表面；优先使用语义 token。
- 中性边框遵循 DSH hairline 规则；高层级表面使用 DSH elevation token，不把中性 border 与 elevation shadow 叠加成双描边。
- 字号与行高成对设置，使用 DSH 已有排版尺度；功能 UI 字重不超过 500，主要依靠字号、颜色和空间层级表达强调。
- 主题切换、系统外观变化、DSH 通用设置同步均由 DSH 原生机制处理。

### 2.2 第三方插件的 UI 运行边界

本仓库是独立安装的第三方 bundle，不是 DSH monorepo 内的 Client feature package。按 DSH 插件开发约定：

- 页面继续作为 React 组件注册到 DSH main slot；不改成 Host HTML / iframe。
- 继续通过 ctx.slots.inject('sidebar.panellist', ...) 和 ctx.slots.inject('main', ...) 注册入口与主页面。
- **不通过 require('@deepseek-ai/dsh-client-ui-primitives') 或其他 DSH Client 包加载运行时组件。** dsh.client.inject 只负责激活顺序，不代表可把其他 Client 包当作稳定运行时 API。
- 需要的按钮、菜单、徽标、弹层和提示在本插件内实现，使用 React 原生元素、可访问性语义和 DSH token；借鉴官方控件的交互行为时，保留键盘、焦点、Escape、禁用原因和触屏行为。
- 不增加第三方 UI 框架或 Tailwind。
- 样式交付必须适配当前独立插件的实际构建与动态模块加载方式。先验证 CSS 资源路径和 CSP / 热重载行为，再决定是否引入额外构建步骤；不得为了样式重构破坏当前 tsc 构建、Host/Client bundle 入口或 window.__ModuleLoader__ 契约。
- 不在组件外直接操作 DOM，不向 document.body 追加 UI。样式和交互资源必须由插件组件 / 生命周期拥有并正确清理。

### 2.3 安全优先

UI 只展示 Host 的事实和授权结果，不成为安全决策的权威：

- Client 的按钮禁用和提示是用户体验门禁；Host 每次写操作仍独立复核。
- dispatchReady、Workspace 可用性、Session 适用性和历史状态未确认时，不允许触发 create / fork / prompt。
- prepared、dispatching、unknown 不提供“重新创建 / Fork”捷径。
- accepted 不显示为“已完成”。
- unknown 恢复必须沿用原 executionId、requestId、targetSessionId 和不可变 Prompt 快照，并遵守 Host 授权。
- 放弃操作继续二次确认；已创建 Session 永不因放弃而删除。
- 恢复、候选绑定和手动绑定继续展示来源不确定性警告。

## 3. 信息架构

主页面分成三个主要工作区：

1. **待办工作台**：概览、搜索、筛选、排序和待办列表。
2. **任务详情**：选中待办的完整内容、最近执行上下文和执行历史。
3. **执行配置**：从待办详情进入的专注式双栏配置界面。

导航不新增独立的 DSH 侧栏入口；仍使用原有 Task Inbox 面板入口。

## 4. 工作台首页

### 4.1 页面头部

- 标题：Task Inbox / 待办箱。
- 一句简短说明，强调先收集、执行时再选择上下文。
- 主操作：新增待办。
- 页面头部在窄窗口允许自然换行；标题不为给操作按钮让位而强制截断。

### 4.2 概览指标

建议展示四个有明确定义的数字：

| 指标 | 口径 |
| --- | --- |
| 全部待办 | 当前 Todo 总数 |
| 未派发 | 没有任何 Execution 记录的 Todo 数 |
| 待恢复 | 至少存在一条未解决 Execution 的 Todo 数 |
| 已派发 | 最近一条 Execution 状态为 accepted 的 Todo 数 |

注意：

- 不显示“已完成”或“Agent 已完成”指标。
- accepted 的准确文案是“已接受 / 已派发”，不能等同 Agent 完成。
- 同一 Todo 可能有多条 Execution；概览按 Todo 去重计数，详情和时间线仍保留每条独立 Execution。

### 4.3 搜索、筛选和排序

- 搜索范围：Todo 标题和描述；输入更新不触发 Host 写操作。
- 状态筛选：全部、未派发、待恢复、已派发。
- Workspace 筛选：全部、未分配、指定 Workspace。
- 策略筛选：全部、新建、复用、Fork。
- 排序：手动顺序、最近更新、创建时间。
- 筛选和排序只影响当前视图，不改变 Todo 持久化 order。
- 默认排序保留用户手动顺序；筛选清空后回到原有顺序。

### 4.4 Todo 列表行

每行按阅读优先级展示：

1. 标题；
2. 一至两行描述摘要；
3. 最近执行元信息：Workspace、策略、Session 短 ID（存在时）；
4. 执行状态；
5. 行级操作：查看详情、执行、编辑、删除，以及必要的更多菜单。

列表行不把所有元数据都做成高强调 Badge。状态、Workspace 和策略使用不同视觉角色；图标操作必须有可访问名称，桌面 hover 提示不能成为触屏唯一入口。

### 4.5 Workspace 语义

Todo 仍是全局待办，不新增 workspaceId 字段。

- 列表中的 Workspace 指**最近一次 Execution 使用的 Workspace**。
- 从未执行过的 Todo 显示“未分配工作区”。
- 同一 Todo 在不同 Workspace 执行过多次时，列表只显示最近一次；详情时间线显示每次执行各自的 Workspace。
- Workspace 筛选默认按最近一次 Execution 匹配；详情中仍可查看更早的其他 Workspace 记录。
- 若 Workspace 已从 DSH 移除，使用 Execution 中保存的 workspacePath 作为历史回退标签，不把它伪装成当前可用 Workspace。
- Workspace 名称优先使用当前执行上下文可确认的名称；无法确认时使用保存路径的末级目录名或路径文本。

策略和 Session 元信息同样来自最近一条 Execution，不在 Todo 上重复保存。

## 5. 右侧任务详情面板

### 5.1 内容结构

- Todo 标题与完整描述；
- 创建 / 更新时间；
- 最近执行摘要；
- 历史执行时间线；
- 主要操作：执行；
- 次要操作：编辑、删除。

### 5.2 最近执行摘要

展示：

- 当前记录状态及准确语义；
- Workspace 名称 / 历史路径；
- 策略（new / reuse / fork）；
- 来源 Session 与目标 Session；
- Session 标题 + 可区分短 ID；无标题时至少显示短 ID；
- 执行时间和必要的错误说明。

### 5.3 面板行为

- 宽屏下固定为列表旁的详情列；选择其他 Todo 时只更新详情。
- 详情面板内部可滚动，不能让整个应用出现第二条横向滚动条。
- 中等窗口与窄窗口下切换为单列独立详情视图；提供「返回待办列表」操作，不要求叠加浮层或引入第二套导航。
- 返回列表后保留搜索、筛选和列表顺序；详情关闭前的选中项不会被错误地绑定到其他 Todo。
- 删除仍需二次确认；删除失败时保留详情与原数据。

## 6. 执行配置工作区

### 6.1 桌面布局

左侧为参数配置，右侧为固定 / sticky 执行摘要：

**参数区：**

- Workspace 选择；
- Session 策略：新建 / 复用 / Fork；
- 来源 Session（reuse / fork 必填，new 不要求）；
- 候选适用性和状态说明；
- 执行前校验；
- 历史未解决执行的恢复入口。

**摘要区：**

- Todo 标题与 Prompt 快照摘要；
- Workspace；
- Session 策略；
- 来源 / 目标 Session；
- Host 能力检查结果；
- 当前执行状态；
- 确认并派发按钮及禁用原因。

摘要必须来自当前表单和 Host 已确认状态；参数改变后重新计算并触发能力检查，不展示过期的“校验通过”。

### 6.2 响应式布局

- 宽屏：配置与摘要左右并列。
- 中等宽度：两列按可用空间压缩；无法保持可读性时改为上下排列。
- 窄窗口：单列；摘要放在主要参数之后、确认操作之前。
- 目标最小验收宽度为 390 CSS px；不得通过隐藏主要操作、全局缩小字体或裁掉错误信息解决拥挤。
- 页面缩窄时保留草稿和焦点；如果当前控件被移除，焦点移到语义上合适的可见控件。

### 6.3 安全状态

所有原有门禁继续生效：

- 历史加载未完成 / 失败：禁止派发；
- Host dispatch capability 未 ready：禁止派发；
- Workspace 不可用：禁止派发；
- reuse / fork 来源 Session 未选择或不适用：禁止派发；
- 有未解决 Execution：优先恢复或明确放弃；
- 当前派发 busy：阻止重复触发；
- acquire 未成功：Client 不得调用 sessions.create / fork；
- unknown Prompt 重试：必须经 Host 授权；
- execution_unavailable：先重新检查 Host 状态，不允许直接再次点击派发。

## 7. 统一执行时间线

### 7.1 展示目标

在 Todo 详情中按时间倒序展示多条 Execution；展开一条 Execution 后，按发生时间正序展示该次派发的关键事件，并提供与该事件状态匹配的恢复操作。

时间线内容包括：

- 执行意图创建；
- Session 关联（新建 / 复用 / Fork / 人工绑定）；
- Prompt 派发开始；
- Host 核验 accepted；
- 明确失败；
- 结果 unknown；
- 恢复 / 候选绑定；
- 用户放弃（已创建 Session 保留）。

只记录有持久化证据的事实；只读轮询和重复检查不产生事件。

### 7.2 Execution 事件模型

在独立执行记录域 task_inbox_executions 中，为 ExecutionRecord 增加可选的事件数组（例如 events?: ExecutionEvent）。事件字段保持精简：

- eventId：单条执行内稳定唯一；
- kind：受限的事件类型；
- at：ISO 时间；
- fromStatus / toStatus：发生状态转换时记录；
- errorCode：确有错误码时记录；
- bindingSource：仅关联事件需要时记录 client / manual。

事件只能在现有 ExecutionStore 串行化 mutation 内，与对应状态或绑定变更**同一次原子写入**。不得先写状态再单独写事件，也不得在 Client 侧推测补写。详情时间线显示事件时间、事件类型；存在时显示 Session 短 ID、client / manual 关联来源和错误码。

### 7.3 旧记录兼容

- 旧 ExecutionRecord 没有 events 时按空数组读取。
- 不升级或重写 Todo 域。
- 不为旧记录伪造状态转换；旧记录仅展示已有 createdAt、updatedAt、当前状态和关联信息，并提示“该记录没有可用的事件明细”。
- 新事件字段必须可选，现有 0.4.7 记录无需人工迁移即可读取。
- 若实现中发现当前 Storage Domain schema 无法安全接受可选字段，则先补独立迁移设计与测试，不得直接改变 domain version 或重写真实文件。

### 7.4 事件语义边界

- accepted 表示 Host 从 Session 日志独立核验 DSH 已接收 Prompt。
- 不能由 accepted 推断 Agent 已开始、仍在运行或已完成。
- Task 04 可在不改变本时间线阅读方式的前提下，增加 Agent Turn 开始 / 结束、失败、取消和结果摘要；这些事件需要有可靠 DSH 数据源后才可展示。

## 8. 视觉语言

- 风格：克制、清晰、精致的现代工作台；强调内容层级与操作效率，不堆叠装饰性渐变、重阴影或大量彩色徽标。
- 页面背景使用 DSH base token；内容表面使用 layer token；层级通过间距、边界、标题和表面区分。
- 卡片只在确有独立分组 / 操作上下文时使用；列表主体优先用清晰的行和分区，不把每个字段都包成卡片。
- 状态颜色只表达语义状态；普通分类标签使用中性视觉。
- 图标保持统一线重和尺寸；图标按钮有可访问名称和必要 tooltip。
- 动效只服务于面板切换、选择反馈和轻量加载；遵循减少动态效果偏好，不让动效影响操作时序。
- 高层级浮层需遵循 DSH 顶部安全区、遮罩、焦点恢复和 Escape 规则。
- 不以纯色字面量建立插件品牌色；Task Inbox 的品牌强调使用 DSH brand token。

## 9. 响应式与可访问性

- 390 CSS px 为主要窄屏验收宽度。
- 不出现意外横向滚动、重叠、裁切或无法访问的主操作。
- 先重新分配空间 / 换行，再考虑截断或把次要操作放入更多菜单。
- 标题优先完整显示；长描述自然换行。
- 图标按钮必须有 accessible name；仅在有 hover 能力时启用 hover-only 效果。
- 表单字段有可见 label；错误提示关联到字段或对应操作。
- 禁用操作同时提供简短原因，不能只靠灰色表达。
- 键盘可完成新增、搜索、选择待办、打开详情、进入执行配置、取消弹层和恢复操作。
- Modal / Drawer 打开时管理初始焦点、Tab 范围、Escape 和关闭后的焦点恢复。
- 触屏设备不自动弹出键盘，不依赖 hover 才能看到行操作。

## 10. 数据与 API 方案

### 10.1 新增只读概览

首页需要一次性取得跨 Todo 的 Execution 元信息，不能为每条 Todo 在客户端串行请求历史。

新增只读 API 操作（暂定 execution-overview），由 Host 从 ExecutionStore 读取记录并返回用于首页的最小摘要集合：

- executionId / todoId；
- strategy；
- workspaceId / workspacePath；
- sourceSessionId / targetSessionId；
- status / errorCode；
- createdAt / updatedAt / createdAtMs。

不返回首页不需要的完整 Prompt 文本。具体字段和排序在 API 实现时以当前类型为准。该操作只读，不触发 Session 操作，也不依赖 Client 提交的状态。

### 10.2 Execution 历史与事件

现有按 Todo / Execution 查询能力继续作为详情的权威来源；若当前 API 不能一次返回指定 Todo 的完整 Execution 列表和事件，则扩展只读响应，不另造并行状态源。

### 10.3 Todo 数据保持不变

- task_inbox v2 schema 不变；
- Todo.status 仍为 todo；
- Workspace / 策略 / Session 信息只来自 Execution；
- 删除 Todo 时的执行历史保留策略需在实现前明确：默认不级联删除 Execution 记录，避免删除 Todo 意外抹去安全恢复证据；详情入口可在 Todo 不存在时保留记录可追溯性，或明确限制为不可再从 Todo 列表访问。

## 11. 实施拆分

### 03C-01：设计与技术边界

- 本文档；
- 确认主题继承、工作台信息架构、Workspace 语义、时间线事件边界；
- 记录第三方 bundle 不 runtime-import DSH Client 包的限制。

### 03C-02：只读数据模型与测试（已实现）

- 增加 Execution overview 纯读 API；
- 为 ExecutionRecord 增加向后兼容的可选事件数组；
- 在 Host 串行化 mutation 中记录事件；
- 覆盖旧记录兼容、事件追加、概览只读字段与标题降级。

### 03C-03：工作台页面结构（已实现，待 GUI）

- 实现头部、指标、搜索 / 筛选 / 排序、Todo 列表；
- 实现详情面板与 Workspace / 策略 / 来源 / 目标 Session 摘要；
- 宽屏双栏；1080px 以下切换为独立详情视图；
- 保留现有 CRUD 行为与 Todo 顺序语义。

### 03C-04：执行工作区与时间线（已实现，待 GUI）

- 双栏执行配置与实时摘要；
- 统一 Execution 列表、事件时间线和恢复入口；
- 将所有按钮继续接到现有 Host 门禁与安全编排；
- 处理关闭执行配置后的数据刷新与过期响应竞态。

### 03C-05：视觉、响应式和 GUI 验收（待人工验收）

- 浅色 / 深色 / system 三种宿主设置组合；
- 宽屏、窄窗口、390px 宽度；
- 加载、空、错误、禁用、busy、unknown、accepted、failed、manual binding；
- 键盘 / 触屏、焦点、菜单 / 弹层；
- 用户在 DSH GUI 中验收；真实 Session 派发仍由用户明确触发。

## 12. 验收标准

| # | 验收项 | 通过条件 |
| --- | --- | --- |
| 1 | DSH 主题继承 | 修改 DSH 通用外观设置后，插件无刷新同步；system 跟随操作系统 |
| 2 | 工作台概览 | 数字口径准确，不把 accepted 计为完成 |
| 3 | 搜索与筛选 | 标题 / 描述、Workspace、策略、状态筛选正确；不改写 Todo 顺序 |
| 4 | Workspace 语义 | 未执行 Todo 显示未分配；多 Workspace 历史按最近执行展示，详情保留全部记录 |
| 5 | 右侧详情 | 选择任务不丢失列表滚动 / 筛选；完整内容和执行关联准确 |
| 6 | 执行配置 | 参数、摘要和能力状态同步；所有原有 Host 安全门禁仍有效 |
| 7 | 时间线 | 新记录只展示有证据的事件；旧记录不伪造历史 |
| 8 | 恢复安全 | unknown / dispatching / prepared 不会误触发重复 create / fork / prompt |
| 9 | 响应式 | 390px 无主要操作裁切、页面横向滚动或控件重叠 |
| 10 | 可访问性 | 键盘、焦点、表单 label、错误和禁用原因可用 |
| 11 | 国际化 | zh / en 全部新增文案覆盖，无新增硬编码可见文本 |
| 12 | 回归 | build / typecheck / check / 全部测试通过；Todo 真实存储无重置 / 迁移 |

## 13. 风险与待验证项

1. **当前 Client 是动态模块加载入口**：样式模块化方案需先验证独立插件 bundle 的资源解析 / CSP / 热重载能力；不得照搬 DSH monorepo 内部构建假设。
2. **Execution 事件兼容**：旧记录 schema 和 Storage Domain 读取必须通过真实旧格式 fixture 测试；未验证前不触碰真实存储。
3. **概览性能**：Execution 记录量增长后需避免每次渲染重复扫描；Host 提供排序后的轻量摘要，Client 只做必要派生。
4. **Workspace 生命周期**：已删除 / 不可用 Workspace 必须能以历史快照展示，不得把旧记录误判为当前可派发。
5. **真实 GUI 仍需人工验收**：自动化测试不能代替 DSH 主题切换、布局和真实派发验证。
6. **Task 04 边界**：Agent 运行状态和完成语义必须有可靠数据源；没有证据时只能展示 Prompt accepted，不得推测完成。

## 14. 参考资料

- DSH 插件开发：[第一个 Harness 插件](https://deepseek-harness.github.io/deepseek-harness/develop/basic/)
- DSH 插件打包：[打包与安装插件](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish)
- DSH 官方主题实现：[ui-theme README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-theme/README.zh.md)
- DSH Web 样式规范：[web-styling.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/web-styling.zh.md)
- DSH 第三方插件 UI 约定：[Harness plugin practices](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md)
