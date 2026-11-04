# 影策可用组件清单

写控件前先在这里找。导入一律用深路径（无全局 barrel）。新组件进库门槛：≥ 2 处真实重复，或隔离一个明确的交互协议（见 `web/src/components/ui/README.md`）。

## 页面布局

| 组件 | 路径 | 用途 | 注意 |
| --- | --- | --- | --- |
| `WorkspacePage` | `@/components/layout/workspace-page` | 用户端页面外壳 | 工作台两栏用 `fluid scroll={false}` |
| `PageHeader` | 同上 | 内容库页头：标题 + meta + 说明 + 右侧命令组 | 命令顺序：主操作 → 次要 → 更多 |
| `ListToolbar` | 同上 | 搜索 + 筛选 + 已选筛选 chip + 重置 + 右侧操作 | 筛选多时自动收进「筛选」按钮 |
| `CollectionGrid` | 同上 | 内容卡网格 | 默认 `minmax(248px,1fr)` |
| `TableSurface` | 同上 | 用户端表格外壳 | |
| `PaginationBar` | 同上 | 分页（总数 + 页码 + 跳页 + 每页条数） | 用户端与后台共用 |

## 状态与空态

| 组件 | 路径 | 用途 |
| --- | --- | --- |
| `WorkspaceState` | `@/components/layout/workspace-state` | 首次使用空态（说明 + 一个主按钮） |
| `WorkspaceNoResultsState` | 同上 | 搜索 / 筛选无结果，回显关键词 + 清除筛选 |
| `WorkspaceErrorState` | 同上 | 加载失败 + 重试 |
| `WorkspaceForbiddenState` | 同上 | 无权限 |
| `WorkspaceLoadingState` | 同上 | 页面级加载 |
| `EmptyState` | `@/components/ui/product/empty-state` | 面板内小空态 |
| `MediaPlaceholder` | `@/components/ui/product/media-placeholder` | 媒体加载失败 / 缺失占位，不要露出破图 alt |
| `Callout` | `@/components/ui/product/callout` | 页面内提示条（不是 toast） |

antd `Empty` 被 lint 禁用，不要用。

## 浮层

| 组件 | 路径 | 用途 | 注意 |
| --- | --- | --- | --- |
| `AppModal` | `@/components/ui/product/app-modal/app-modal` | 产品弹窗 | 内容自带外壳时 `flush`；不要复制 `padding: 0` 的 styles |
| `AppDrawer` | `@/components/ui/product/app-drawer` | 侧栏抽屉 | |
| `AntTooltip` | `@/components/ui/base/tooltip/ant-tooltip` | 需要 antd 能力的 Tooltip | 已设 500ms 延迟；不要直接用 antd `Tooltip` |
| `Tooltip` | `@/components/ui/base/tooltip` | react-aria Tooltip | 自带预热窗口 |
| `App.useApp()` | `antd` | `message` / `modal` / `notification` | 不要用静态 `message.xxx()`、`Modal.confirm()` |

## 基础控件

| 组件 | 路径 | 用途 |
| --- | --- | --- |
| `SegmentedControl` | `@/components/ui/base/segmented-control/segmented-control` | 分段单选（视图切换、移动端「创作 / 作品」） |
| `Switch` | `@/components/ui/base/switch` | 开关（也可用 antd `Switch`） |
| `Select` | `@/components/ui/base/select` | 轻量单选下拉 |
| `Checkbox` / `CheckboxGroup` | `@/components/ui/base/checkbox` | 勾选 |
| `IconButton` / `ToolButton` / `DeleteButton` | `@/components/ui/base/buttons` | 图标按钮、工具按钮、原位确认删除 |
| `StatusBadge` | `@/components/ui/base/badges` | 状态点徽章 |
| `Kbd` | `@/components/ui/base/kbd` | 快捷键键帽 |
| `SettingsRow` | `@/components/ui/product/settings-row` | 设置项单行：标签 + 说明 + 控件 |
| antd `Button` / `Input` / `Select` / `Form` | `antd` | 已由 `AppProviders` 统一主题，直接用；面板内输入用 `variant="filled"` |

## 业务组件

| 组件 | 路径 | 用途 |
| --- | --- | --- |
| `ModelPicker` | `@/components/model-picker` | 选模型（带价格、健康度、能力过滤）。创作面板用 `variant="creation" fullWidth` |
| `ModelIcon` / `ModelLabel` | 同上 | 模型 Logo 与名称 |
| `ImageSizePicker` | `@/components/image-size-picker` | 图片尺寸 / 比例选择 |
| `CachedResourceImage` | `@/components/cached-resource-image` | 按 storageKey 显示资源图（带缓存、失败占位） |
| `RelativeTime` | `@/components/ui/product/relative-time` | 时间显示：7 天内相对时间 |
| `CreditStar` / `RollingCreditAmount` | `@/components/ui/credit-star`、`@/components/rolling-credit-text` | 积分图标与滚动金额 |
| `CanvasResourceMentionTextarea` | `@/components/canvas/canvas-resource-mention-textarea` | 支持 `@` 引用素材的提示词输入 |

## 后台专用（`web/src/pages/admin/`）

| 组件 | 路径 | 用途 |
| --- | --- | --- |
| `AdminPageFrame` | `./components/admin-shell` | 后台页面外壳 |
| `SettingsSectionCard` | `./components/admin-ui` | 设置分区（标题 / 说明 / 状态 / 内容 / 底栏） |
| `AdminStatusBadge` | 同上 | 状态徽章（success / warning / error / info / neutral） |
| `AdminStatTile` | 同上 | 统计数字卡 |
| `AdminDataTable` / `AdminTableEmpty` / `AdminTableSkeleton` | 同上 | 表格与空 / 骨架 |
| `AdminRowActions` | 同上 | 行操作（主操作 + 更多） |
| `AdminBatchBar` | 同上 | 批量操作条 |
| `AdminFilterChip` / `AdminEmpty` / `AdminExportButton` | 同上 | 筛选 chip、空态、导出 |
| `ListToolbar` / `PaginationBar`（后台版） | 同上 | 后台列表工具栏与分页 |
| `AdminSegmented` / `AdminSwitch` / `AdminSelect` / `AdminCheckbox` / `AdminTooltip` / `AdminIconButton` / `AdminCallout` | `./ui/controls` | 后台控件 |
| `AdminModal` / `AdminDrawer` | `./ui/overlays` | 后台浮层 |

## 可以照抄结构的样式文件

| 场景 | 文件 |
| --- | --- |
| 创作面板 + 结果区 | `web/src/pages/workbench/workbench.css`、`web/src/pages/ecommerce/composer.css`、`output-gallery.css` |
| 选择弹窗（分组网格） | `web/src/pages/ecommerce/market-picker.css` |
| 后台配置页 | `web/src/pages/admin/ecommerce-agent-config.css` |
| 后台标签页内容头 | `web/src/pages/admin/ecommerce-management.css` |
