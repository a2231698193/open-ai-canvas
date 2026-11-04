---
name: yingce-ui-system
description: 影策 UI 系统规范与可执行规则。写任何前端样式、组件、页面布局时使用：字号/间距/圆角/层级 token、表面与明度分层、按钮与控件合同、组件清单（必须优先复用）、状态与动效、暗色适配、后台样式、CSS 写法与禁止项。
---

# 影策 UI 系统

一句话：**安静、专业、靠表面明度和字号分层，不靠边框、阴影、渐变和颜色堆砌。** 用户的作品是主角，界面是工作台。

开始写样式前先读：`web/src/styles/globals.css`（token）、`docs/ui-design-system.md`（全文规范）、本目录 `references/components.md`（能直接用的组件）。

## 1. 硬性尺度（只能用这些值）

| 维度 | 允许值 | token |
| --- | --- | --- |
| 间距 | 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48 | `--space-1` 4、`--space-2` 8、`--space-3` 12、`--space-4` 16、`--space-5` 20、`--space-6` 24、`--space-8` 32、`--space-12` 48 |
| 字号 | 11 / 12 / 13 / 14 / 16 / 22（营销与 hero 数字 32） | `--fs-label` 11、`--fs-caption` 12、`--fs-ui` 13、`--fs-body` 14、`--fs-heading` 16、`--fs-title` 22、`--fs-display` 32 |
| 字重 | 400 / 500 / 600 | 不用 700+；hover、选中、展开不改字重 |
| 行高 | 正文 1.65、标题 1.3 | `--lh-body`、`--lh-heading` |
| 字距 | 标题 -0.015em、全大写小字 0.04em | `--ls-title`、`--ls-caps` |
| 圆角 | 4 / 8 / 12 / 16 / 全圆 | `--r-xs` 4（徽章、勾选框）、`--r-md` 8（按钮、输入、菜单项、媒体）、`--r-lg` 12（下拉、Popover、小卡）、`--r-2xl` 16（面板、内容卡、弹窗）、`--r-full` |
| 控件高 | 28 / 34 / 40（后台 28 / 32 / 36） | 不是间距，按密度选 |
| 动效 | 150–250ms | `--motion-dur-fast` 150、`--motion-dur-base` 200、`--motion-dur-slow` 250；进入 `--motion-ease-out`，退出 `--motion-ease-in` |
| 层级 | `--z-page` < `--z-sticky` < `--z-dropdown` < `--z-drawer` < `--z-dialog` < `--z-toast` < antd Modal < `--z-dialog-popover` < `--z-tooltip` | 页面级浮层必须用 token |

嵌套圆角：内圆角 = 外圆角 − 内边距（16px 卡片 + 8px 内边距 → 内部媒体 8px）。

### 字号怎么分配

| 用途 | 字号 | 颜色 |
| --- | --- | --- |
| 页面标题 | 22 / 600 | `--user-ink` |
| 面板 / 区块 / 弹窗标题 | 16 / 600（面板内区块可 13 / 600） | `--user-ink` |
| 正文、输入框文字 | 14 / 400 | `--user-ink` |
| 控件、导航、按钮、选项 | 13 / 500 | `--user-ink`，未选中 `--user-ink-muted` |
| 说明、元信息、表单标签 | 12 / 400–500 | `--user-ink-muted` / `--user-ink-soft` |
| 徽章、角标、计数 | 11 / 500 | `--user-ink-soft`，等宽数字 |

一个视图里出现的字号不应超过 4 档。

## 2. 表面与层级（最重要的一条）

层级用**表面明度**表达：亮色逐级变深、暗色逐级变亮。

用户工作台（`.app-user-workspace` 作用域）：

| 层 | token | 亮 | 暗 | 用途 |
| --- | --- | --- | --- | --- |
| 页面 | `--user-page-bg` | `#f8f8fa` | `#151517` | 整页底色 |
| 面板 / 卡片 | `--user-surface` | `#ffffff` | `#1c1c1f` | 创作面板、批次卡、内容卡 |
| 内凹 / 控件底 | `--user-surface-muted` | `#f1f1f3` | `#26262a` | 输入框底、选择块、媒体占位、分段轨道 |
| 悬停 | `--user-surface-hover` | `#eaeaec` | `#303036` | 可交互元素 hover |
| 细线 | `--user-border` | `rgba(25,25,30,.10)` | `rgba(255,255,255,.09)` | 分区分隔线、底栏顶线 |
| 强线 | `--user-border-strong` | `rgba(25,25,30,.17)` | `rgba(255,255,255,.16)` | 聚焦描边、虚线上传框 |

规则：
1. **一个面板只有一层表面**。面板里的分区用分隔线和间距分开，**不要再套带底色或边框的卡片**。真正需要内凹的只有输入框、选择块、媒体占位，用 `--user-surface-muted`。
2. **默认无边**。卡片、面板、列表行默认没有 border；hover 也不能临时加边。
3. **选中才有描边**：持久选中 = `--control-selected-bg` 底 + `inset 0 0 0 1px var(--control-selected-border)`；配 `aria-pressed="true"`。
4. **暗色不靠阴影**：卡片在暗色下默认与 hover 都不要投影。阴影只给真正浮起的层（Modal、Dropdown、Popover、Tooltip），用 `--elevation-overlay` 或 `--cm-pop-shadow`。
5. **毛玻璃**只用于浮在媒体上的控件，必须配 1px 低透明度边线。
6. **左侧不画竖条**：卡片、行、提示条、激活项都不能用 `border-left` 强调色、`inset Npx 0 0` 阴影或 `::before` 竖线。

## 3. 按钮与控件合同

全站一套按钮（`web/src/lib/app-theme.ts` + `web/src/styles/button-tokens.css` + `primary-buttons.css` + `unified-buttons.css`）。**不要在页面里改按钮的高度、圆角、颜色、边框、阴影**，页面 CSS 只管布局宽度和间距。

| 类型 | 用法 | 写法 |
| --- | --- | --- |
| 主按钮 | 每组命令最多一个，主路径终点 | `<Button type="primary">` |
| 次要按钮 | 其余命令 | `<Button>` |
| 浅底按钮 | 放在输入区 / 工具条里的触发器 | 自绘时用 `--button-tonal-bg`，无边 |
| 文字按钮 | 行内轻操作、卡片底部操作 | `<Button type="text">` |
| 图标按钮 | 头部工具、卡片操作 | 30px 方块、透明底、hover `--user-surface-muted`；必须有 `aria-label` 或 sr-only 文字；自绘时加 `data-icon-only` |
| 危险 | 删除 | `danger` 描边；实心红只用于确认不可逆 |

- 高度 34（紧凑 28、大 40），圆角 8，文字 13/500，图标 16px stroke 1.75，图标与文字间距 6。
- 加载时宽度不变（全局已处理）；禁用 0.42 透明度并用 Tooltip 说明原因。
- 按下缩放 0.97 是全局规则，组件不要再写 `:active { transform }`。
- **禁止**：渐变、发光、彩色投影、扫光、hover 上浮、胶囊形文字按钮（筛选 chip 除外）。

其它控件：
- **选择块 / 分段**（自绘）：高 34、圆角 8、`--user-surface-muted` 底、文字 12–13 `--user-ink-muted`；hover `--user-surface-hover`；选中 `--control-selected-bg` + 1px `--control-selected-border` 内描边 + `--control-selected-fg` 文字，`aria-pressed`。
- **分段切换**：用 `SegmentedControl`（`web/src/components/ui/base/segmented-control/`）；后台用 `AdminSegmented`。轨道 `--user-surface-muted` + 4px 内衬，选中块 `--user-surface` + 极轻投影。
- **输入框 / 选择器**：在面板内用 antd `variant="filled"`（muted 底、无边、聚焦才出描边）；在页面工具栏用默认细线样式。不要全局覆盖 `.ant-input`。
- **步进器**：`[−] N 张 [+]` 一体，34–36px 高，muted 底；不用滑块表示数量。
- **胶囊短语 / chip**：28px 高、全圆角、muted 底、12px；选中同选择块。
- **Switch**：用 antd `Switch` 或 base `Switch`；左边一行标题 + 一行说明，整行可读。

## 4. 版面与布局

- 页面外壳统一 `WorkspacePage`（`web/src/components/layout/workspace-page.tsx`）：内容库用默认（带内边距、可滚动），工作台用 `fluid scroll={false}` 自己管理满高两栏。
- 网格用 `repeat(auto-fill, minmax(min(Npx, 100%), 1fr))` 或 `repeat(N, minmax(0, 1fr))`，子元素 `min-width: 0`。
- 媒体容器先定 `aspect-ratio`，避免加载时跳动。
- 主滚动区加 `scrollbar-gutter: stable` 和细滚动条（`scrollbar-width: thin`）。
- 响应式断点：1180（面板收窄）、760（两栏改切换）、560（弹窗内单列）。640 以下网格单列。
- 首屏优先给主内容；不要用大面积留白或横幅制造层级。

## 5. 状态

| 状态 | 表现 |
| --- | --- |
| 默认 | 当前表面 |
| hover / focus-within | 换到下一档表面，不加边、不位移 |
| 选中（持久） | `--control-selected-*`，`aria-pressed` 或 `aria-selected` |
| 键盘焦点 | `outline: var(--focus-ring-width, 2px) solid var(--ring); outline-offset: 2px;` 只在 `:focus-visible` |
| 禁用 | 0.42 透明度 + `cursor: not-allowed` + 原因提示 |
| 加载 | 转圈图标 `LoaderCircle` + `commerce-planning-spin`/对应 spin 类；骨架与真实结构一致 |
| 进行中（作品） | 占位动画（`CommerceGeneratingArtwork`、工作台 tile 进度），文字「排队中 / 生成中」 |
| 失败 | 就地显示原因（`--status-error` 文字或淡红底块）+ 单项重试 |
| 空态 | `WorkspaceState` 系列；面板内用一个 44px muted 图标块 + 一行标题 + 一行下一步说明 |

## 6. 动效

- 只做反馈与空间连续性：颜色、背景、透明度过渡 150–200ms。
- 卡片、行、按钮 hover 不位移、不缩放、不旋转。
- 浮层进入用淡入 + 轻微位移，退出更短。
- 所有新样式块都要有 `@media (prefers-reduced-motion: reduce)` 去掉过渡与位移。
- 循环动画（转圈、骨架脉冲）不受时长限制，但在 reduced-motion 下停止脉冲。

## 7. 暗色

- 只用 token，不写 `.dark` 下的手调颜色；需要明暗不同的值，先找已有语义 token，没有再在 token 层成对定义。
- 平台 Logo 等黑色单色图在亮色下可读、暗色下不可读时，用 `data-monochrome` 属性统一处理（见 `commerce-platform-logo`）。
- 暗色下检查：分隔线是否可见、选中态是否可辨、muted 文字对比度是否够、媒体上的浮层控件是否始终深底白字（`--wb-glass`、`--wb-on-media`）。

## 8. 组件：先找现成的

**写任何控件前，先在 `references/components.md` 里找。** 找到了就用，不要自己画按钮、开关、下拉、分段、弹窗、空态、提示框、Tooltip。

最常用的几个：
- 布局：`WorkspacePage`、`PageHeader`、`ListToolbar`、`CollectionGrid`、`PaginationBar`
- 状态：`WorkspaceState`、`WorkspaceNoResultsState`、`WorkspaceErrorState`、`WorkspaceLoadingState`
- 浮层：`AppModal`（`flush`）、`AppDrawer`、`AntTooltip`（500ms 延迟；不要直接用 antd `Tooltip`）
- 控件：`SegmentedControl`、`Switch`、`Select`、`Checkbox`、`IconButton`、`StatusBadge`、`Kbd`
- 业务：`ModelPicker`、`ImageSizePicker`、`CachedResourceImage`、`MediaPlaceholder`、`RelativeTime`、`CreditStar`
- 反馈：`App.useApp().message` / `modal`（不要用静态 `message.xxx`、`Modal.confirm`）

## 9. 后台（/admin）

后台有独立的 token 前缀 `--admin-*`（`web/src/pages/admin/theme/admin-tokens.css`）和独立的 antd 主题（`admin-ant-theme.ts`），密度更紧凑。

- 页面外壳：`AdminPageFrame`（标题、说明、右侧 actions、`scroll`）。不要嵌套两个 `AdminPageFrame`。
- 分区：`SettingsSectionCard`（`layout="stacked"` 用于长表单），`status` 放 `AdminStatusBadge`，`footer` 放保存状态与按钮。
- 统计：`AdminStatTile`；表格：`AdminDataTable` + `AdminRowActions` + `AdminTableEmpty`；批量：`AdminBatchBar`；提示：`AdminCallout`；切换：`AdminSegmented`。
- 后台样式写在页面 CSS 中，用 `[data-admin-root] .xxx` 作用域；颜色只用 `--admin-text-primary / -secondary / -muted`、`--admin-layer-1/2`、`--admin-divider`、`--admin-card-border`、`--admin-status-*`。
- 字段排版：标签 12/600 `--admin-text-secondary`，控件，说明 11 `--admin-text-muted`；两列网格，`.is-wide` 占满。

## 10. CSS 写法

- 每个页面 / 大组件一个 CSS 文件，类名用短前缀（`ecs-`、`wb-`、`eac-`），新样式不要堆进已有的超大旧文件。
- 新增选择器前先 `rg` 同名选择器，回到唯一源头修改；不要在文件末尾再写一段覆盖。
- 必须覆盖旧样式时用**更具体的作用域**（`.ecs-composer .xxx`），不要用 `!important`（除非对抗第三方内联样式且写了注释）。
- 不写全局 `.ant-*` 覆盖；第三方覆盖限定在组件作用域内。
- 不用裸 Tailwind 任意值（`text-[13px]`、`rounded-[10px]`、`#hex`），用 token 或注册过的工具类。
- inline style 只用于动态值（比例预览尺寸、进度），颜色仍引用 `var(--token)`。
- 文件头写一段注释：这个文件管哪个页面、遵循哪些规则、与哪些旧样式的关系。

## 11. 禁止项速查

- 卡片套卡片、边框套边框；默认卡片带边框；hover 出现边框。
- 渐变、发光、彩色投影、扫光（登录页品牌舞台与首页灵感画廊除外）。
- 左侧竖向强调条。
- hover 位移 / 缩放；组件自写按压缩放。
- 字号、圆角、间距、颜色写死字面值。
- 一个视图多个主按钮。
- emoji 当图标；图标只用 lucide（品牌与模型 Logo 除外）。
- 自绘已有组件；直接用 antd `Tooltip`、`Empty`、静态 `Modal.confirm`、静态 `message`。
- 为验收另做独立 HTML 页面；必须在真实路由上改和验证。

## 12. 交付前

按 `skills/yingce-page-review/SKILL.md` 截图自检，并运行 `cd web && bun run typecheck && bun run lint`，改动的文件用 Prettier 格式化。
