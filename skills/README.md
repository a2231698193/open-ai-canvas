# 影策设计 Skills

这里是影策（`ddcat-ai/open-ai-canvas`）的产品设计、UI 设计与配色规范，写给**任何 AI 编码助手**和协作者使用（Claude、Kiro、Cursor、Codex、GPT、DeepSeek 等）。目标是：不管谁来写页面，产出的都是同一个产品，而不是「把一堆功能平铺在页面上」。

每个 Skill 是一个目录，入口是 `SKILL.md`，文件头的 `name` / `description` 采用通用 Skill 格式，可以直接被支持 Skills 的工具加载；不支持的工具把对应 `SKILL.md` 当成提示词读入即可。

## 什么时候读哪一个

| 你要做的事 | 必读 | 选读 |
| --- | --- | --- |
| 新建一个页面或大改一个页面 | `yingce-product-design` → `yingce-ui-system` → `yingce-page-review` | `yingce-color`、`yingce-ui-copy` |
| 改一个现有组件、弹窗、面板的样子 | `yingce-ui-system` | `yingce-color` |
| 后台（`/admin`）页面 | `yingce-product-design`（§6 后台模式）→ `yingce-ui-system`（§9 后台） | `yingce-page-review` |
| 写或改界面上的文字（标题、说明、按钮、空态、报错） | `yingce-ui-copy` | — |
| 选颜色、加状态色、做暗色适配 | `yingce-color` | `yingce-ui-system` |
| 交付前自检 | `yingce-page-review` | — |

## 目录

```
skills/
├── README.md                     本文件：索引与使用方式
├── yingce-product-design/        产品设计：页面为谁、解决什么、怎么组织，而不是放哪些功能
│   ├── SKILL.md
│   └── references/patterns.md    已验证的页面范式（创作工作台、内容库、设置页、后台配置页、弹窗）
├── yingce-ui-system/             UI 系统：token、版式、表面、组件清单、状态、动效、禁止项
│   ├── SKILL.md
│   └── references/components.md  可用组件清单（路径、用途、什么时候不该用）
├── yingce-color/                 配色：颜色角色、明暗两套真实取值、使用规则
│   └── SKILL.md
├── yingce-ui-copy/               界面文案：怎么写标题、说明、按钮、空态、报错
│   └── SKILL.md
└── yingce-page-review/           交付自检：截图验收流程与逐条检查清单
    └── SKILL.md
```

## 权威来源与优先级

1. 代码里的真实实现永远优先：token 在 `web/src/styles/globals.css`、`web/src/styles/button-tokens.css`、`web/src/lib/app-theme.ts`，后台在 `web/src/pages/admin/theme/`。规范与代码不一致时以代码为准，并顺手修正规范。
2. 规范全文：`docs/ui-design-system.md`（UI 系统硬规则）、`docs/plans/ui-design-system.mdx`（组件编写规范）、`web/src/components/ui/README.md`（组件层速查）。
3. 本目录是上述内容的**可执行版**：加入了产品设计方法、文案规则、反例与验收流程，并把散落在各处的规则收在一起。

## 给工具配置的方式

- **Claude Code / Kiro / 其他支持 Skills 的工具**：把 `skills/` 下的目录链接到该工具的 skills 目录（例如 `ln -s ../../skills/yingce-ui-system .claude/skills/yingce-ui-system`），或在会话开头让它读取对应 `SKILL.md`。
- **Cursor / Copilot / 通用聊天模型**：在任务开头附上「先读 `skills/README.md`，再按表格读取对应 SKILL.md」。
- 根目录 `AGENTS.md` 已指向本目录；改 UI 的任务默认要先读这里。

## 维护

- 改了 token、组件或页面范式，同一个提交里更新对应 Skill。
- Skill 里写的路径、类名、token 名必须真实存在；写不出真实例子的规则不要写。
- 新增反例时写清楚「错在哪、应该怎么做」，不要只写「不要这样」。
