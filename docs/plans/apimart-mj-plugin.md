# APIMart Midjourney 插件规划（P0：imagine）

> 状态：P0（imagine）已实现，待真实验收；P1/P2 未开始。实现前先过一遍第 9 节「待验证项」。
> 本文只覆盖 P0；P1/P2 见第 10 节 backlog。

## 1. 目标与范围

**P0 交付**：新增 APIMart Midjourney 插件，支持文生图与垫图，界面上可调 `version`（含 8.2）/`speed`/`niji`/画面比例，一次生成返回 **4 张单图**。

**P0 不做**：二次操作（upscale / variation / reroll / zoom / pan / inpaint / modal / remix）、blend / describe / edits / video 路由、按 version 与 speed 分档定价、MODAL 状态语义。

## 2. 已确认决策

| # | 决策 | 依据 |
| --- | --- | --- |
| 1 | 首期只做 `imagine`（含垫图、8.2、niji、speed） | 单 provider 即可落地，先把 8.1 上限补齐到 8.2 |
| 2 | 产出 4 张单图，四宫格只作二次操作依据 | 画布图片节点是单图；`image_urls` 直接可用 |
| 3 | 计费按 `operation` 分档，P0 只有一档 | 价格档选择器白名单复用即可，不动后端 |
| 4 | 二次操作入口将来放图片节点工具栏 | 与现有 upscale / 去背景工具栏一致（仅影响 P1） |
| 5 | 参数只暴露 version / speed / niji / 画面比例 | 覆盖 8.2 与价格差异主因，其余走 `providerOptions` 逃生口 |

## 3. 上游契约（文档 + 实测）

实测方式：借助 `mart.mhuanet.com` 中转，用无效 key 探测路由（401 = 路由存在）。

| 项 | 结论 |
| --- | --- |
| 创建 | `POST /v1/midjourney/generations`（与 `/imagine` 等价，实测两条都存在） |
| 鉴权 | `Authorization: Bearer <token>` |
| `model` | **不写入请求体**，上游按路由自动注入 `model=midjourney` |
| 必填 | `prompt` |
| 可选 | `image_urls`（垫图，URL 或 base64）、`speed`(relax/fast/turbo)、`nsfw_check`、`metadata` |
| 结构化参数 | `size`(=`--ar`)、`quality`、`style`、`version`、`seed`、`negative_prompt`、`stylize`、`chaos`、`weird`、`tile`、`niji`、`iw`、`cw`、`sw`、`cref`、`sref`、`dref`、`dw`、`repeat`、`raw`、`draft`、`hd`、`stop`、`extra` |
| 创建响应 | `{"code":200,"data":[{"status":"submitted","task_id":"task_01JW..."}]}` |
| 查询（MJ 风格） | `GET /v1/midjourney/{task_id}` → `status` / `action` / `progress` / `grid_image_url` / `image_urls[4]` / `buttons[]` / `prompt` |
| 查询（统一） | `GET /v1/tasks/{task_id}` → `pending|processing|completed|failed` + `result.images[].url` |
| 状态取值 | `NOT_START` / `SUBMITTED` / `IN_PROGRESS` / `MODAL` / `SUCCESS` / `FAILURE` |
| 失败 | 自动全额退款，`fail_reason`（如 `Banned prompt detected`、`Task timeout`、`No available upstream`） |
| 版本清单 | `8.2`、`8.1`、`7`、`6.1`、`5.2`、`5.1`；Niji 用 `niji:true` + `version:"7"/"6"` |
| 计费 key | `midjourney@imagine[-version][-speed]`；`speed=relax` 或缺省不加后缀 |

### 3.1 实测补充（真实 key 验证，2 次 imagine 调用）

| 验证项 | 结论 |
| --- | --- |
| 8.2 是否可用 | ✅ `version:"8.2"` + `speed:"fast"` + `size:"1:1"` 提交成功，约 84s 到 SUCCESS |
| 提交响应 | `{"code":200,"data":[{"status":"submitted","task_id":"task_01..."}]}` |
| 结果字段 | `id` / `status` / `action` / `progress` / `grid_image_url` / `image_urls[4]` / `buttons[15]` / `prompt_en` / `created_at` / `finished_at`（**没有 `prompt`，只有 `prompt_en`**） |
| 四宫格阶段按钮 | U1–U4、V1–V4、`reroll`、`pan_left/right/up/down`、`MJ::Outpaint::1`（Zoom Out 1.5×）、`MJ::Inpaint::1`（Vary Region）；**没有 remix / Vary Strong**（那些出现在 upscale 后的单图任务上） |
| 产物可下载性 | 单图 ~1.29MB、四宫格 ~5.6MB，`image/png`，`nginx/1.18.0 (Ubuntu)` |
| 产物域名 | 实测是 **`getapib.org`**，与文档示例里的 `cdn.apimart.ai` 不一致 → 后端出站下载与资源转存必须放行该域名 |
| body 是否容忍 `model` | ✅ 容忍（传 `{"model":"midjourney"}` 只报 `prompt is required for imagine`）；但仍建议不传 |
| `version` 是否被校验 | ❌ **不校验**：`version:"9.9"` 照样 200 建任务，随后任务 FAILURE：`upstream code=4: --v 必须是 ['5','5.1','5.2','6','6.1','7','8','8.1','8.2'] 之一` |
| MJ 引擎真实版本集 | `5 / 5.1 / 5.2 / 6 / 6.1 / 7 / 8 / 8.1 / 8.2`（比文档列的 6 档多出 `5`、`6`、`8`），Niji 走 `niji:true` + version |
| 用量对账端点 | `GET /v1/dashboard/billing/subscription`、`GET /v1/dashboard/billing/usage` 均可用（one-api 风格），可做成本核对 |

> 版本枚举必须在插件参数与前端面板自校验：上游不拦，非法版本会留下一条 FAILURE 任务（虽按文档自动退款）。

## 4. 插件设计

### 4.1 包与 provider

- 包目录：`plugin-packages/apimart-mj/`，**生成物**，源在 `plugin-packages/generate-catalog.mjs`（现有 `apimart-image` / `apimart-video` 同款 `add({...})` 写法，注意 `generate-catalog.mjs:711` 已注明「Midjourney 等独立路由必须使用独立协议」）。
- 单个 provider：`apimart-mj`，`capabilities: ["image"]`，`baseUrl: https://api.apimart.ai`，`auth: bearer`，`requiresPublicMediaUrls: true`，`scopes` 沿用 `admin.system-channel / user.custom-channel / canvas / creation / agent`。
- 路由：`create = POST /v1/midjourney/generations`，`poll = GET /v1/midjourney/{{taskId}}`。

> 为什么 poll 选 MJ 风格而不是统一任务接口：MJ 风格一次就能拿到 `image_urls`，同时保留 `grid_image_url` / `buttons`，P1 做二次操作时不用换协议。

### 4.2 参数声明（`parameters`）

`model`、`prompt`、`images`、`aspectRatio`、`providerOptions`，与 `apimart-image` 保持同名同义，便于画布统一处理。

### 4.3 请求映射

| APIMart body | 来源 |
| --- | --- |
| `prompt` | `$omitEmpty(request.prompt)` |
| `image_urls` | `request.images` → 排序 + 过滤 `role != mask` + 取 `value`（直接复用 `apimart-image` 的表达式写法） |
| `size` | `request.aspectRatio`（命中 MJ 比例枚举才提交，否则省略） |
| `version` | `providerOptions["apimart-mj"].version`；枚举 `8.2 / 8.1 / 8 / 7 / 6.1 / 6 / 5.2 / 5.1 / 5`，**必须在插件参数与面板自校验**（上游不拦，非法值会导致任务 FAILURE） |
| `niji` | `providerOptions["apimart-mj"].niji`（bool） |
| `speed` | `providerOptions["apimart-mj"].speed`，枚举 relax / fast / turbo；空值不提交（上游默认 relax） |
| `model` | **不提交** |

`generationMetadata` 已按 `providerOptions[protocol]` 命名空间注入（`web/src/services/api/generation-task.ts:331-337`），无需新增通道。

### 4.4 状态映射

`normalizeStatus`（`backend/internal/protocol/builtin.go:944-959`）小写匹配，MJ 取值可直接命中：

| MJ status | 归一化 | 说明 |
| --- | --- | --- |
| `SUBMITTED` / `NOT_START` | pending | |
| `IN_PROGRESS` | processing | |
| `SUCCESS` | succeeded | |
| `FAILURE` | failed | 失败原因取 `fail_reason`（`messagePaths`） |
| `MODAL` | pending（兜底，`manifest.go:597-599`） | P0 不会出现；P1 做 inpaint 时必须显式处理，否则会一直轮询 |

### 4.5 结果映射

- `images` ← `image_urls`（4 张单图，全部落库）。
- `grid_image_url` 与 `buttons` **P0 不落库**：`protocol.Result` 只有 images/videos/audios/text/reasoning/usage（`types.go:147-154`），没有放元数据的位置。P1 需要时再定承载（候选：`PollContext.Metadata`，见 `types.go:106-112`）。
- 失败路径沿用 `asyncResponse` 的 `errorPaths` / `messagePaths` 写法。

### 4.6 生成器改动

在 `generate-catalog.mjs` 的 apimart 段落附近新增一个 `add({...})`，产出 `manifest.json` / `README.md` / `docs/interface.md`（`generate-catalog.mjs:1351-1353`）。

## 5. 能力配置

| 位置 | 改动 |
| --- | --- |
| `backend/internal/model/models.go:75` | 新增常量 `ChannelInterfaceAPIMartMJ ChannelInterfaceType = "apimart-mj"` |
| `backend/internal/app/model_capability.go:141` | `DefaultImageCapabilityConfig` 增加 `apimart-mj` 分支：size = MJ 比例枚举、`MaxOutputs = 4`、垫图 `MaxImages = 4`、`MaskSupported = false` |
| `web/src/lib/model-capabilities.ts`（参照 `:269` 的 apimart-image 段） | 同步同名分支 |
| `web/src/stores/use-config-store.ts:925` | 默认 baseUrl 加入 `apimart-mj`（`https://api.apimart.ai`） |

## 6. 前端改动点

| 文件 | 改动 |
| --- | --- |
| `web/src/lib/apimart-mj-options.ts`（新增） | version / speed / niji 选项定义 + `providerPayload` + `summary` |
| `web/src/stores/use-apimart-mj-options-store.ts`（新增） | 持久化选项 |
| `web/src/components/apimart-mj-options-panel.tsx`（新增） | 面板，视觉沿用 `lk888-mj-options-panel.tsx`，字段换成 version / speed / niji |
| `web/src/components/image-settings-panel.tsx:114` | 接入点由「仅 lk888」扩展为按协议选择面板 |
| `web/src/services/api/generation-task.ts:328` | 按协议注入 `providerOptions["apimart-mj"]` |

**不动** `lk888-mj` 三件套（`lib/lk888-mj-options.ts`、`stores/use-lk888-mj-options-store.ts`、`components/lk888-mj-options-panel.tsx`）——两边字段不同（lk888 是 `botType`，APIMart 是 `niji` + `version`），复用会引入回归。

## 7. 计费配置（管理员操作，不改代码）

- 渠道模型 key 建议 `midjourney`（与 APIMart 控制台一致）；协议选 `apimart-mj`。
- `billingMode = fixed_request`，一次 imagine（4 张单图）计一次费。
- **价格档怎么配**：图片能力下 `skuSelectorForIntent` 会**覆盖** `operation`——有参考图取 `image_to_image`，没有取 `text_to_image`（`backend/internal/app/model_router.go:872-877`），后台的「生成方式」选项正好是这两个值加「任意生成方式」。因此：
  - 最省事：价格档用**「默认价格」**模式（不写匹配条件，selector 为空 → 匹配所有请求，`channel-model-price-tier-form.ts:108-117` 只在值非 `*` 时才写入 selector）。
  - 要区分文生图/图生图：用「按规格定价」，生成方式选具体值，「质量/分辨率」**必须选「任意质量」**，「画幅/尺寸」留空。
  - **不要**按 1K/2K/4K 配价格档：协议的画布质量档是关闭的，请求侧不会带 `quality`，写了就永不命中，报「当前模型尚未配置所选规格的价格」。`operation` 也不能填 `image`——它在图片分支会被覆盖成 `text_to_image`/`image_to_image`。
- 已知口径偏差：`turbo` 的实扣约为 `relax` 的 2.2 倍（`docs/plans/apimart-pricing.json` 中 `imagine` 0.0563 / `imagine-turbo` 0.125），P0 用统一价，需要在模型描述里向用户说明。
- 对账手段：`GET /v1/dashboard/billing/usage`（实测可用）取调用前后 `total_usage` 差值，即可核对单次 imagine 的真实成本。

## 8. 验证清单

1. 生成与打包含包：`cd plugin-packages && node generate-catalog.mjs apimart-mj`（同进程会连带只对该包执行 `embed-documentation.mjs`），再按 `build-packages.sh` 的方式打 zip：
   `cd apimart-mj && find manifest.json README.md docs -type f | LC_ALL=C sort | zip -X -q ../apimart-mj.yingce-plugin -@`
   （`build-packages.sh` 全量执行会重建 6 个平台的支付插件，日常只需打目标包。）
2. `cd backend && go test ./internal/protocol/ -run 'TestOfficialProtocolPackagesAreSelfContainedDeclarativePlugins|TestAPIMartMJProfile' -count=1`：官方包契约 + 请求体/轮询/失败逐字段断言。
3. `cd backend && go build ./... && go test ./internal/app/ ./internal/protocol/ ./internal/handler/ ./internal/generation/ -count=1`：回归同渠道其它协议。
4. 真实上游（opt-in，付费）：`CANVAS_APIMART_MJ_LIVE_KEY=sk-... go test ./internal/protocol/ -run TestAPIMartMJLiveImagine -count=1 -v -timeout 400s`，断言 imagine → 轮询 → 4 张单图。
5. `cd web && bun run typecheck && bun run build && bun run lint`。
6. 真机验收（见 `pending-test.mdx` 的「APIMart Midjourney 协议插件」）：垫图、版本矩阵、`getapib.org` 转存、价格档与实扣对账。

## 9. 风险与待验证项

| 项 | 验证方法 |
| --- | --- |
| 4 张图是否都被落库（`provider_protocol.go:868` 存在「只留 1 张」的分支，需确认不作用于本协议） | 端到端数产物数量（上游侧已确认返回 4 张；协议层已断言解析出 4 张） |
| 画布「生成数量」UI 选 1 张时，4 张结果是否被前端丢弃 | 前端实测 |
| base64 垫图（单图 ≤12MiB）是否可用 | 真实 key 试 base64；默认走公网 URL |
| 后端出站下载是否放行 `getapib.org` | 跑一次真实任务看媒体是否转存成功（SSRF 策略见 `backend/internal/outbound`） |
| 价格口径偏差（turbo ≈ relax×2.2） | 用 `/v1/dashboard/billing/usage` 前后差值对账 |
| `MODAL` 归一化为 pending | P0 不触发；P1 前必须补 |
| `version` 非法值 | 已确认会 FAILURE（虽退款）；靠插件自校验拦截，不依赖上游 |

## 10. Backlog

- **P1 二次操作**（upscale / variation / reroll，入口 = 图片节点工具栏）。前置改造：请求侧支持自定义 `operation`（现在图片任务恒为 `image`）、把任务的上游 `task_id`（`Task.ProviderRequestID`，`models_task.go:36`）暴露给前端、`buttons[]` 持久化承载、工具栏入口与参数弹窗。
- **P2 其余路由**：blend / describe / edits / high-variation / low-variation / zoom / pan / inpaint / modal / remix-strong / remix-subtle，以及 `apimart-mj-video`（video capability，图生视频）。describe 若要可用，需接画布的「反推提示词」并处理文本结果。
- **P3 定价对齐**：价格档选择器白名单扩展 `version` / `speed`，并补一个 MJ 价格导入器（现有 `import-apimart-video-pricing` 只认视频，不认 `action_version_speed`）。

## 11. 实现时需同步的文档

- `docs/content/docs/progress/todo.mdx`、`pending-test.mdx`（未确认前先记待测）
- `USER_CHANGELOG.md`（用户可感知的新模型能力）
- 插件协议字段变化同步 `plugin-packages/apimart-mj/docs/interface.md`（生成物）
