---
name: yingce-color
description: 影策配色规范。选颜色、加状态色、做明暗适配、给分类上色、写后台颜色时使用：颜色按角色取 token，列出亮暗两套真实取值、使用比例与禁忌。
---

# 影策配色

影策的配色是**中性墨色为主、颜色只表达意义**。界面本身几乎是黑白灰（带一点冷调，hue 286），颜色留给三件事：主操作、状态、分类。用户的作品是画面上最鲜艳的东西。

## 1. 取色规则

1. **只按角色取 token，不按样子取色**。先问“这个颜色表示什么”，再去下表找对应 token。找不到角色就说明不该上色。
2. **不写十六进制、rgb 字面值**。唯一例外：媒体上的浮层（在任何图片上都要可读，固定深底白字），已经定义为 `--wb-glass`、`--wb-on-media` 等，直接引用。
3. **主操作色 ≠ 选中色**。主操作（「生成」「保存」）用 `--workspace-accent` / 主按钮；普通选中（选了某个场景、某个比例）用 `--control-selected-*`。两者不能混用。
4. **一屏颜色面积 ≤ 10%**。大面积底色只能是中性表面；状态色只用于文字、小图标、细描边或 8–10% 透明度的淡底。
5. **成对定义**：任何新的颜色语义都要同时给出亮色和暗色值，放在 token 层（`globals.css` 的 `:root` 与 `.dark`），组件只引用。

## 2. 中性色（占画面 90%）

### 用户工作台（`.app-user-workspace` / `.app-user-overlays` 作用域）

| token | 亮色 | 暗色 | 角色 |
| --- | --- | --- | --- |
| `--user-page-bg` | `#f8f8fa` | `#151517` | 页面底 |
| `--user-surface` | `#ffffff` | `#1c1c1f` | 面板、卡片 |
| `--user-surface-raised` | `#ffffff` | `#222226` | 浮起的小表面 |
| `--user-surface-muted` | `#f1f1f3` | `#26262a` | 内凹：输入框、选择块、媒体占位、分段轨道 |
| `--user-surface-hover` | `#eaeaec` | `#303036` | 悬停 |
| `--user-control-pressed` | `#e1e1e5` | `#3a3a40` | 按下 |
| `--user-border` | `rgba(25,25,30,.10)` | `rgba(255,255,255,.09)` | 分隔线 |
| `--user-border-strong` | `rgba(25,25,30,.17)` | `rgba(255,255,255,.16)` | 聚焦描边、虚线框 |
| `--user-ink` | `#1d1d21` | `#f3f3f5` | 主文字 |
| `--user-ink-muted` | ink 66% | ink 72% | 次要文字、未选中选项、表单标签 |
| `--user-ink-soft` | ink 52% | ink 56% | 说明、元信息、占位符、计数 |

### 全站基础（非工作台作用域、组件库内部）

| token | 亮色 | 暗色 |
| --- | --- | --- |
| `--background` | `oklch(0.993 0.002 286)` | `#0f0f11` |
| `--foreground` | `oklch(0.17 0.006 286)` | `#f4f4f6` |
| `--text-primary / -secondary / -tertiary` | fg / 64% / 46% | fg / 68% / 50% |
| `--border` | `oklch(0.2 0.01 286 / .1)` | `rgba(255,255,255,.09)` |

### 后台（`[data-admin-root]` 作用域，`web/src/pages/admin/theme/admin-tokens.css`）

用 `--admin-layer-0/1/2/3`（画布 → 卡片 → 内凹 → 更深）、`--admin-text-primary / -secondary / -muted`（muted 亮 `#737373`、暗 `#8a8a8a`）、`--admin-divider`（亮 `rgba(17,17,17,.08)`、暗 `rgba(245,245,245,.08)`）、`--admin-card-border`。后台页面不要用 `--user-*`。

**文字三级用法**：标题与正文用 ink；表单标签、未选中选项、次要说明用 muted；元信息、占位符、提示用 soft。不要再造第四级灰。

## 3. 主操作色

| token | 经典皮肤亮 | 经典皮肤暗 | 用途 |
| --- | --- | --- | --- |
| `--workspace-accent` | `#171717` | `#f5f5f5` | 主按钮实底、焦点环来源、`::selection`、`caret-color` |
| `--ring` | accent 55% | accent 60% | 键盘焦点环 |

- 经典皮肤的主操作就是**墨色实底**，不是蓝色。皮肤可以替换 `--workspace-accent`，所以代码里不能假设它是黑色或蓝色。
- 主操作色只出现在每组命令唯一的主按钮上，以及焦点环。不要拿它画选中、标签、图标、链接。

## 4. 选中色

| token | 亮色 | 暗色 |
| --- | --- | --- |
| `--control-selected-bg` | `rgba(17,17,17,.09)` | `rgba(255,255,255,.12)` |
| `--control-selected-hover-bg` | `rgba(17,17,17,.13)` | `rgba(255,255,255,.16)` |
| `--control-selected-fg` | `#171717` | `#f5f5f5` |
| `--control-selected-border` | `rgba(17,17,17,.18)` | `rgba(255,255,255,.18)` |

用法：`background: var(--control-selected-bg); box-shadow: inset 0 0 0 1px var(--control-selected-border); color: var(--control-selected-fg);`，并加 `aria-pressed="true"`。内容库卡片的持久选中用 `--library-selected-stroke`。

## 5. 状态色

| 语义 | token | 亮色 | 暗色 | 用在 |
| --- | --- | --- | --- | --- |
| 成功 | `--status-success` | `#16a34a` | `#33d17a` | 完成状态文字、成功图标 |
| 警告 | `--status-warning` | `#d97706` | `#fbbf24` | 需检查、未开放提示、配额接近 |
| 错误 | `--status-error` | `#dc2626` | `#ff4d4d` | 失败原因、错误图标、表单报错 |
| 进行中 | `--status-loading` | `#2563eb` | `#60a5fa` | 运行中标记（少用，多数场景用中性转圈） |
| 危险操作 | `--destructive` | `#dc2626` | `#ff4d4d` | 删除按钮、不可逆确认 |

后台另有 `--admin-status-success / -warning / -error / -info`，通过 `AdminStatusBadge tone` 使用。

用法：
- **文字或图标**直接用状态色。
- **底色**只用淡底：`color-mix(in srgb, var(--status-error) 8%, var(--user-surface))`，文字保持 `--user-ink`，图标用状态色。不要整块饱和红底配白字。
- 「进行中」优先用中性转圈 + `--user-ink-muted` 文字，不要把整个界面染蓝。
- 不用颜色作为唯一信号：失败要有文字「生成失败」，成功要有文字或勾。

## 6. 分类色（产品强调色）

用于区分**类别**（场景类型、节点类型、技能分类），不表示状态、不表示可点击。

| token | 亮色 | 暗色 |
| --- | --- | --- |
| `--product-accent-blue` | `#4167bf` | `#96b4ff` |
| `--product-accent-cyan` | `#2f6f8f` | `#7ec4e0` |
| `--product-accent-green` | `#287f65` | `#79cfb1` |
| `--product-accent-orange` | `#a46524` | `#edb77c` |
| `--product-accent-pink` | `#ae4c77` | `#efa2c3` |
| `--product-accent-violet` | `#6b4fc2` | `#c4b5fd` |

- 只用在小面积：分类图标、图标底块（12–16% 透明度淡底 + 同色图标）、分类小标签。
- 同一个类别全站用同一个颜色（例如工作台 `SceneGlyph` 的 tone 映射，见 `web/src/pages/workbench/workbench-composer.tsx`）。
- 画布节点类型色另有 `--cn-type-*` / `--palette-node-*`，只在画布内使用。

## 7. 媒体上的颜色

图片和视频上的控件不随主题反相，始终深底白字，保证在任何画面上可读（`web/src/pages/workbench/workbench.css` 顶部）：

- `--wb-glass`（`rgba(16,16,20,.58)`）/ `--wb-glass-strong`（`.78`）：浮层底
- `--wb-glass-line`（`rgba(255,255,255,.16)`）：浮层边线
- `--wb-on-media`（`#fff`）/ `--wb-on-media-muted`（白 68%）：文字
- `--wb-media-scrim`：底部渐暗遮罩

## 8. 禁止

- 渐变底、彩色光晕、发光阴影（登录页品牌舞台和首页灵感画廊除外）。
- 蓝色主按钮、蓝色选中、蓝色链接满屏（经典皮肤主色是墨色）。
- 纯黑 `#000` / 纯白大块对比（暗色页面底用 `#151517`，不用 `#000`）。
- 实心灰边框（用低透明度前景色）。
- 用饱和红、绿大块作为提示条背景。
- 在组件里写 `.dark .xxx { color: #... }` 手调颜色。
- 给装饰元素上分类色（分隔线、卡片边框、背景块）。

## 9. 自检

- 亮 / 暗两种主题各截一张图：页面 → 面板 → 内凹 → hover 是否逐级可辨。
- 只看颜色：画面上有颜色的地方是否都能说出它代表什么。
- 灰度预览（截图去色）：主操作、选中、失败是否仍能分辨（靠文字、描边、明度而非只靠色相）。
- muted / soft 文字在暗色下对比度是否足够阅读。
