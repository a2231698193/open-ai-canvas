# 影策页面范式

每个范式都来自已上线、已验收的页面。新页面先找最接近的范式照搬结构，再改内容。

## 1. 创作工作台（输入面板 + 结果区）

**用在**：任何「填参数 → 提交生成 → 看结果」的页面。
**现有实现**：`/toolbox/image`、`/toolbox/video`（`web/src/pages/workbench/`，类名前缀 `wb-`）；`/ecommerce`（`web/src/pages/ecommerce/index.tsx`、`composer.css`，类名前缀 `ecs-`；结果区 `output-gallery.tsx`）。

```
┌───────────────────────────────┬──────────────────────┐
│ 结果区（minmax(0, 1fr)）        │ 创作面板（380–420px） │
│ ┌ 标题 · 计数     筛选 · 导出 ┐ │ ┌ 类型切换     图标操作┐│
│ │ 流程区：已发送需求/方向/审阅 │ │ │ 当前项目一行         ││
│ │ 批次卡 → 作品网格            │ │ ├──── 内部滚动 ───────┤│
│ │ 空态：下一步要做什么          │ │ │ 区块：标题 + 一句说明 ││
│ └─────────────────────────────┘ │ │ 区块之间 1px 分隔线   ││
│                                 │ ├──── 固定底栏 ───────┤│
│                                 │ │ 报价 · 张数   次要 主 ││
│                                 │ └─────────────────────┘│
└───────────────────────────────┴──────────────────────┘
```

规则：
- 两栏左右顺序由页面定（工具箱面板在左，电商面板在右），同一页面内不变。
- 外层 `WorkspacePage fluid scroll={false}`；壳层 `display:grid; height:100%; gap: var(--space-4)`；面板 `border-radius: var(--r-2xl); background: var(--user-surface)`，满高，`overflow:hidden`。
- 面板分三段：头部（类型切换 `kind-switch` + 图标按钮）、滚动区（`scrollbar-gutter: stable`，左右 16px 内边距）、底栏（`border-top: 1px solid var(--user-border)`，左边报价两行、右边按钮）。
- 区块 = `<section>` + `<header><h3>标题</h3><span>一句说明</span></header>` + 内容；区块之间 `border-top: 1px solid color-mix(in srgb, var(--user-border) 70%, transparent)`，上下内边距 16px。区块不再包卡片。
- 选项 ≤ 6 个平铺为三列选择块（`ecs-scene`、`wb-chip`），选中用 `--control-selected-*`，`aria-pressed`。
- 描述输入：`--user-surface-muted` 底、无边、聚焦时变 `--user-surface` + 1px `--user-border-strong` 内描边；下方可点选短语分类 tab + 胶囊短语（点一下写入描述，再点移除，见 `web/src/lib/prompt-phrases.ts`）。
- 模型：`ModelPicker variant="creation" fullWidth`；比例 / 清晰度为等宽选择块；数量为步进器。
- 结果区：作品卡只有媒体底色一层（`--user-surface-muted`），标题与操作排在媒体下方；多选勾选框悬停出现；状态文字在卡片右下角用颜色区分（失败 `--status-error`）。
- 窄屏 ≤ 760px：顶部 `SegmentedControl` 切换「创作 / 作品」，两栏只显示一栏。

## 2. 内容库（项目 / 画布 / 素材 / 技能）

**现有实现**：`/projects`、`/canvas`、`/assets`、`/skills`。规则全文：`docs/ui-design-system.md` §2。

```
页头：标题  [计数徽章]  一句说明                主操作 · 次要 · …更多
工具栏：搜索（34px）  选择器  分段筛选                   视图切换
网格：创建卡（真实首项） 内容卡 内容卡 …
```

- 页头用 `PageHeader`，工具栏用 `ListToolbar`，网格用 `CollectionGrid`，分页用 `PaginationBar`（均在 `web/src/components/layout/workspace-page.tsx`）。
- 卡片同一表面 `--library-surface`，默认无边无影，hover 只换 `--library-surface-hover`，选中才有 1px `--library-selected-stroke`。
- 不同库只改列数、媒体比例、信息量，不改表面。
- 空态用 `WorkspaceState` 系列（首次使用 / 无结果 / 加载失败 / 无权限）。

## 3. 用户设置页 / 设置分区

- 一列分区，每区：标题 + 一句说明 →（可选）状态徽章 → 字段 → 底栏。
- 单行设置用 `SettingsRow`（`web/src/components/ui/product/settings-row/`）：左标签 + 说明、右控件。
- 开关即时生效的写明「切换即保存」；需要保存的分区底栏显示「有未保存的修改 / 已保存」与保存按钮。

## 4. 后台配置页

**现有实现**：`web/src/pages/admin/ecommerce-agent-config-page.tsx`（电商 Agent 配置）、`components/access-settings-panel.tsx`（登录与注册）、`components/feature-availability-panel.tsx`（功能开放）。

```
AdminPageFrame：分组 / 页面标题，一句说明                 （可选）页头操作
SettingsSectionCard（stacked）  开放状态      [1 / 3 已开放]
  列表：图标 · 名称 · 说明                         状态徽章
  底栏：数据来源说明                     刷新 · 去功能开放调整
SettingsSectionCard（stacked）  阶段模型
  …
SettingsSectionCard（stacked）  创作助手      [已停用]
  分组：开放与外观 / 对话模型与计费 / 回答知识与引导（组间分隔线）
  底栏：有未保存的修改               撤销修改 · 保存创作助手
```

- 外壳 `AdminPageFrame`，分区 `SettingsSectionCard`，状态 `AdminStatusBadge`，统计 `AdminStatTile`，表格 `AdminDataTable`，行操作 `AdminRowActions`，标签切换 `AdminSegmented`（均在 `web/src/pages/admin/components/` 与 `web/src/pages/admin/ui/`）。
- 分区内部不再套卡片；字段统一「标签 12px/600 → 控件 → 说明 11px muted」三段，两列网格，长文本占满一行。
- 多个相关页面合成一页时用页头右侧 `AdminSegmented` 做标签，每个标签的说明与操作放在标签内容头部（参考 `ecommerce-management-page.tsx` + `ecommerce-library-panel.tsx`），不要把子页面的 `AdminPageFrame` 嵌进来再用 CSS 隐藏。
- 旧路由改名后保留 `Navigate` 重定向。

## 5. 弹窗

- 产品弹窗用 `AppModal`（后台 `AdminModal`）。内容自带外壳时 `flush`。
- 结构：标题（16px）+ 一句副说明 → 单层内容（分组用小标题，不套卡片）→ 底栏（左：当前选择摘要；右：取消 / 主操作）。
- 大量选项的选择弹窗（平台、物料）：分组标题 + 等宽网格；每个选项固定尺寸的图标容器 + 名称，选中用 `--control-selected-*`。参考 `web/src/pages/ecommerce/market-picker.tsx` + `market-picker.css`。
- 规则、免责声明等长说明收进 `<details>`，默认折叠。
- 不要用 `Modal.confirm` 静态方法（lint 会拦）；确认用 `App.useApp().modal` 或原位确认。

## 6. 流程卡（Agent 推荐、方案审阅）

- 出现在结果区顶部，按时间顺序：已发送的需求 → 推荐方向（可选一个）→ 方案审阅（`<details>` 默认折叠，展开逐张可改）→ 生成按钮。
- 进度用一行 `role="status"`（转圈图标 + 文字），失败用 `role="alert"` 整块淡红底 + 原因 + 重试按钮。
- 不用聊天气泡模拟对话，除非页面本身是对话（`/create`、画布 Agent）。
