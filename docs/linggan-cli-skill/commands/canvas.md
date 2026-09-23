# 画布

`canvas create` 和 `canvas use` 会把画布记为当前画布。之后的 `state`、`apply` 和 `task create` 默认使用它。临时指定用 `--canvas <画布ID>`。

画布不存在或不属于当前账号时，画布相关命令（`state`、`apply`、`tool`、`quote`）都返回 404 `not_found`「画布不存在或无权访问」。这不是网络或服务端故障，不要对同一个画布 ID 反复重试：先用 `canvas list` 看当前账号有哪些画布，或 `canvas create` 新建一个，再 `canvas use <画布ID>` 切过去。`canvas list` 返回的 `projects` 数组里每一项就是一张画布，`id` 字段直接给 `canvas use` 用。

```bash
linggan canvas list
linggan canvas create --title "产品广告"
linggan canvas use <画布ID>
linggan canvas state --offset 0
```

`state` 返回节点摘要、连线和 `snapshotHash`。节点很多时看 `hasMore` 和 `nextOffset`，用 `--offset` 继续读：**每页长度不等长**（按字节预算切分，实测 14 → 6 → 3），必须原样跟着 `nextOffset` 走，不要按固定步长自增，否则会漏掉最后一页。不要猜节点 ID。

摘要里的正文每个字段最多 2000 字符，被截断的节点列在 `truncatedNodeIds`（字段上也有 `contentTruncated` / `composerContentTruncated` 这类标记）。要全文就按节点精读，最多 16000 字符；不要把截断的摘要当全文照抄。

连线单独分页：看 `hasMoreConnections` 和 `nextConnectionOffset`，继续读时传 `--connection-offset`。**连线不会因为节点分页而少返回**——某条边的两端即使不在这一页节点里，它也会出现在 `connections` 里。`totalConnections` 是这张画布的真实连线总数，可以用它对账。不要因为某一页没看到某条连线就判定它不存在并重复建边，那会撞上「连线重复」。

## 修改

先读 `state`，把返回的 `snapshotHash` 原样放进操作文件。

```bash
linggan canvas apply --file ops.json
```

`ops.json`：

```json
{
  "snapshotHash": "<canvas state 返回的 snapshotHash>",
  "ops": [
    {"type": "add_node", "id": "note-1", "nodeType": "text", "title": "广告文案", "content": "一段说明", "x": 80, "y": 80},
    {"type": "connect_nodes", "id": "edge-1", "fromNodeId": "note-1", "toNodeId": "image-1"}
  ]
}
```

允许的 `type` 只有 `add_node`、`update_node`、`connect_nodes`、`delete_node`。一次最多 20 项。

`delete_node` 只能撤销自己刚建的空节点：`canvas state` 返回 `agentCreated: true`，且该节点没有正文、没有提示词草稿、没有生成任务、没有产物、没有连线、也没有被分镜或批量表引用时才能删。被拒绝时会说明是哪个字段挡住了（例如 `composerContent 非空`），清掉那个字段就能删。媒体节点如果没有任务，新建时顺手写入的 `prompt` 不算内容（这个字段不能 patch，否则节点会永远删不掉）。普通节点、用户手工建的节点仍然只能在网页上手动删除。

`nodeType` 可以是 `text`、`markdown`、`image`、`video`、`audio`、`frame`、`batch-table`、`script`。

文本节点更新正文用：

```json
{"type": "update_node", "id": "note-1", "patch": {"content": "修改后的正文"}}
```

图片、视频、音频节点更新下次生成用的提示词草稿也用 `content`（服务端写进 `metadata.composerContent`，不覆盖已经提交的提示词和生成结果）。**patch 的键只能是 `title`、`content`、`x`、`y`**，写 `metadata.composerContent` 这类路径会被拒绝。

只改生成规格时不必再编一个无害的 `title`：`patch` 和 `generation` 至少给一个就行。

```json
{"type": "update_node", "id": "video-1", "generation": {"size": "9:16", "seconds": 5}}
```

### 挂载已上传的素材

`add_node` 和 `update_node` 都接受 `resourceId`（`linggan asset upload` 返回的 `resource.id`，可带 `resource:` 前缀）：只有图片、视频、音频节点能挂，服务端校验归属、就绪状态与媒体类型，已关联生成任务的节点不接受覆盖。

```json
{
  "snapshotHash": "<canvas state 返回的 snapshotHash>",
  "ops": [
    {"type": "add_node", "id": "ref-1", "nodeType": "image", "title": "首帧参考", "resourceId": "<资源ID>"}
  ]
}
```

挂载后的节点就是普通画布素材，可以直接用 `references`（如 `first_frame`）当参考图提交生成。完整流程见 `commands/asset.md`；`resourceId` 只认账号资源库，不接受本地路径或任意 URL。

### 准备生成规格

媒体节点可以用 `generation` 一次写好模型和生成参数，不必让用户事后在网页上补。`add_node` 和 `update_node` 都接受它：

```json
{
  "type": "add_node", "id": "video-1", "nodeType": "video",
  "title": "第 1 段", "content": "镜头提示词",
  "generation": {
    "model": "CHANNEL_000011::MiniMax-H3",
    "size": "16:9",
    "seconds": 15,
    "vquality": "768p",
    "generateAudio": true
  }
}
```

模型选择填 `model`（渠道模型，形如 `渠道ID::模型键`）或 `logicalModelId`，二者只能填一个。其余键用**节点字段名**，按节点类型区分：

| 节点类型 | 可用字段 |
|---|---|
| 视频 | `size`、`seconds`、`vquality`、`generateAudio`、`watermark` |
| 图片 | `size`、`quality`、`count`、`transparentBackground` |
| 音频 | `audioVoice`、`audioFormat`、`audioSpeed`、`audioInstructions` |

字段拼错或跨类型（例如给图片节点传 `seconds`）会被直接拒绝，并在错误里列出可用字段——不会静默丢弃。非媒体节点（`text`、`script` 等）不接受 `generation`。

写进去的规格能读回来：`canvas state` 和 `canvas_get_state` 会在该节点上返回 `model`、`size`、`seconds`、`vquality`、`generateAudio` 等字段，审批摘要也会逐项列出这次改了哪些规格。节点已经绑定了生成任务时，`generation.spec` 还会回显任务实际保存的规格（如 `size`/`videoSeconds`/`vquality`/`videoGenerateAudio`），可以拿它核对提交时用的是不是你要的那一套。

写入成功后使用返回的新 `snapshotHash`。旧哈希会被拒绝。

## 画布 Agent 的其余操作

`linggan canvas tool <工具名> --file <参数.json>` 使用和网页画布 Agent 相同的工具参数，不调用系统语言模型。

| 工具 | 作用 |
|---|---|
| `canvas_list_node_types` | 列出可创建的节点类型 |
| `canvas_get_state` | 按节点 ID 或分页读取 |
| `canvas_read_storyboard` | 分页读取分镜行 |
| `canvas_create_storyboard` | 创建带镜头行的分镜 |
| `canvas_edit_storyboard` | 追加、修改或删除一个镜头 |
| `canvas_read_batch_table` | 读取批量创作表 |
| `canvas_edit_batch_table` | 编辑批量创作表，不提交生成 |
| `model_list` | 按生成模式和参考节点列出模型 |
| `image_text_detect` | 读取图片节点，准备文字识别 |
| `canvas_arrange_nodes` | 只整理节点坐标，不改内容和连线 |
| `canvas_inspect_image` | 返回图片节点的短时查看链接，供外部模型看图；`nodeId` 或 `nodeIds`（一次最多 6 张）二选一 |
| `canvas_inspect_media` | 读图片/视频/音频节点的素材事实（是否就绪、时长、分辨率、字节、格式）并给出短时 `resourceUrl`；不带画面 |
| `image_annotation_render` | 生成标注参考图 |
| `generate_media` | 创建图片、视频或音频节点并提交生成 |
| `image_layer_split` | 拆分图片图层并提交生成 |

图片、视频和音频生成优先用 `generate_media`，不要用 `task create`。`task create` 只提交任务，不会创建结果节点，也不会把结果写回画布。

生成完想确认结果时用 `canvas_inspect_media`：`ready` 为真时带 `durationMs`、`width`、`height`、`mimeType`、`bytes`，**以及 `resourceUrl`（图片、视频、音频都有，短时签名链接，由你自己的模型或脚本去取）**；还没就绪或素材不属于当前账号时 `ready` 为假并带 `issue`，照 `issue` 说明处理，不要自己编造时长和分辨率。签不出链接时多一个 `urlIssue`，事实仍然可用。本地原件会在读取时解析一次视频容器头，这种情况下多一个 `factsSource: "container"`；远端存储不下载，拿不到就带 `factsIncomplete` 并如实留 0，不要把它当成“视频是 0 秒”。

要看画面：图片用 `canvas_inspect_image`（短时链接，`nodeIds` 一次最多 6 张）；视频和音频用 `canvas_inspect_media` 的 `resourceUrl` 自己下载后再处理（抽帧、送视频模型等）。

```bash
linggan canvas tool canvas_inspect_media --file media.json
```

```json
{"nodeIds": ["video-1", "video-2"]}
```

要看图片画面用 `canvas_inspect_image`：命令行返回素材的 `nodeId`、尺寸和短时 `imageUrl`，由你自己的模型去取图（网页画布 Agent 那边是服务端直接把真实图片字节交给模型，不看这个链接）；`nodeIds` 一次最多 6 张。看不到图（取图失败）时如实说明，不要凭标题猜画面。

```bash
linggan canvas tool model_list --file model.json
linggan canvas tool generate_media --file generate.json
```

`model.json`：

```json
{"mode": "video", "referenceNodeIds": ["image-1"]}
```

`generate.json`：

```json
{
  "mode": "video",
  "prompt": "产品从画面左侧缓缓转向镜头",
  "nodeId": "video-1",
  "title": "产品视频",
  "logicalModelId": "<model_list 返回的 selection.logicalModelId>",
  "referenceNodeIds": ["image-1"],
  "durationSeconds": 5,
  "size": "9:16"
}
```

`mode` 可以是 `image`、`video` 或 `audio`。`logicalModelId` 与 `channelId`、`channelModelKey` 互斥，后两个必须成对使用。`referenceNodeIds` 只放媒体节点；文本来源放在 `sourceNodeId`。

图片和视频都要给 `size`（如 `16:9`、`9:16`）；视频还要给正数 `durationSeconds`，画幅和时长都必须落在 `model_list` 返回的取值范围内，否则准入会拒绝。

### 参考素材的角色

需要区分首帧、尾帧和普通参考图时，用 `references` 代替 `referenceNodeIds`（两者只能填一个）。它自带顺序，`@图片N` 的编号按这个顺序：

```json
{
  "mode": "video",
  "references": [
    {"nodeId": "seam-1", "role": "first_frame"},
    {"nodeId": "chr-1", "role": "reference_image"}
  ]
}
```

`role` 取值 `first_frame`、`last_frame`、`reference_image`（省略即 `reference_image`；`reference` 是它的同义写法）。规则：

- `first_frame` 和 `last_frame` 各自最多一个；填了 `last_frame` 就必须同时有 `first_frame`。
- 首尾帧只能指向图片节点，指向视频或音频会被拒绝。
- 只填 `reference_image` 时服务端按 `reference` 模式处理。

服务端会据此写入与网页端相同的视频元数据（`videoMode`、`videoStartFrameNodeId`、`videoEndFrameNodeId`），**并且写进节点本身**：路由和供应商适配与网页生成一致，用户打开画布时模式下拉和「参考帧」也和你提交的一致，不需要额外参数。没有显式角色时按最终 operation 回填模式（`reference_to_video` → 全能参考），所以两图全能参考不会在界面上显示成首尾帧参考。

### 四种视频模式怎么填

网页上的四个视频模式在命令行里不是开关，而是由「参考素材 + `videoEditOperation`」决定的。对号入座：

| 模式 | 参考素材怎么传 | `videoEditOperation` | 说明 |
|---|---|---|---|
| 文生视频 | 什么都不传 | 省略（推导为 `text_to_video`） | 只有提示词 |
| 图生视频 | `referenceNodeIds: ["<图片节点>"]` | 省略（推导为 `image_to_video`） | 一张图当首帧 |
| 首尾帧参考 | `references` 里一条 `first_frame` + 一条 `last_frame` | 省略即可 | 两张都必须是画布里的图片节点 |
| 全能参考 | 多张图放 `referenceNodeIds` 或都标 `reference_image` | **必须显式 `reference_to_video`** | 省略会被推导成单首帧的 `image_to_video`，多图会被上游按「输入媒体数量超过限制」拒掉 |

首尾帧的完整写法（首帧、尾帧都取自画布上已有的图片节点）：

```json
{
  "mode": "video",
  "prompt": "婴儿房夜景，镜头从安抚毯特写缓缓推近到窗外月光（首帧见 @图片1，尾帧见 @图片2）",
  "nodeId": "vid-seg2",
  "title": "EP01 段2 · 首尾帧",
  "channelId": "<model_list 返回的 selection.channelId>",
  "channelModelKey": "<model_list 返回的 selection.channelModelKey>",
  "size": "9:16",
  "durationSeconds": 5,
  "references": [
    {"nodeId": "img-scn-nursery-master", "role": "first_frame"},
    {"nodeId": "img-scn-nursery-cam", "role": "last_frame"}
  ]
}
```

提交前先拿这两张图问一次模型目录，确认候选里有支持首尾帧的模型：

```bash
linggan canvas tool model_list --file model.json
```

```json
{"mode": "video", "referenceNodeIds": ["img-scn-nursery-master", "img-scn-nursery-cam"]}
```

返回的 `intent.imageRoles` 会列出 `first_frame` / `last_frame`，每项的 `options.video.references.imageRoles` 才是这个模型真正支持的帧角色；没有 `last_frame` 的模型不要用来做首尾帧。

### 画布上哪张图能当首尾帧

先用 `linggan canvas state` 找到图片节点，再按事实挑，不要靠标题猜：

- `type` 是 `image`；
- `outputReference.ready` 为 `true`（素材已就绪、归属当前账号）；
- 需要知道尺寸时看 `asset.width` / `asset.height`，需要核对画面内容时用 `canvas_inspect_image` 真的看一眼。

不满足就绪条件的节点会在生成准入阶段被拒绝，摘要里的 `estimateError` 会说明原因（例如「参考资产尚未保存到账号资源库」）。首尾帧指向视频或音频节点会直接报错，`last_frame` 单独出现也会报「填了 last_frame 就必须同时指定 first_frame」。

提交后 `needs_confirmation` 的 `summary.references` 会原样带回每条素材的角色和顺序，拿它跟用户的意图核一遍再询问，不要凭记忆确认。

### 提示词里的素材引用

素材按类型独立编号（图片、视频、音频各从 1 开始），顺序就是你传的 `referenceNodeIds` / `references` 顺序。写提示词时：

- 推荐直接用 `@图片1`、`@视频1`、`@音频1`；这些标签会被校验，写了一个没有对应素材的编号会被拒绝。
- 供应商的原生写法同样认：中文裸写 `图片1`，以及 MiniMax-H3 的 `<Picture 1>`、`<Video 1>`、`<Audio 1>`（`<Subject N>` 是主体编号，不算素材引用）。
- 你没写到的素材，服务端会补一段 `【资产参考】`（“素材名称：@标签”）。提示词里已经有 `【资产参考】` 段落时，缺的素材并入那一段，不会出现两段。
- 因此提示词已经用 `<Picture N>` 写全时不会再补段落；补不补都不影响编号顺序，`@图片N` 始终对应你传进去的第 N 张图。

### 视频生成操作

视频还有一个 `videoEditOperation`，取值 `text_to_video`、`image_to_video`、`reference_to_video`、`audio_to_video`。

**多图全能参考必须显式填 `videoEditOperation: "reference_to_video"`**：省略时服务端按参考素材推导，而只挂参考图会推导成单首帧的 `image_to_video`，多张图会被上游按「输入媒体数量超过限制」拒绝。模型是否支持某个操作，以 `model_list` 返回的能力为准。

```json
{
  "mode": "video",
  "videoEditOperation": "reference_to_video",
  "prompt": "…",
  "nodeId": "video-1",
  "title": "第 1 段",
  "referenceNodeIds": ["img-1", "img-2", "img-3"]
}
```

分镜：

```bash
linggan canvas tool canvas_create_storyboard --file storyboard.json
linggan canvas tool canvas_read_storyboard --file read.json
linggan canvas tool canvas_edit_storyboard --file edit.json
```

创建时提交 `snapshotHash`、`nodeId`、`title` 和结构化 `rows`。之后的修改必须先读取，使用返回的真实 `rowId` 和新的 `snapshotHash`。`action` 只能是 `append`、`update` 或 `remove`。

批量创作表使用 `canvas_read_batch_table` 和 `canvas_edit_batch_table`。它可以改任务行、并发和参考图列，但不会提交收费生成。

Agent 执行 `generate_media` 或 `image_layer_split` 时，stdout 返回 `needs_confirmation`，此时还没有创建任务。把 `summary` 告诉用户并询问。用户明确同意后，执行同一输出里的 `nextCommand`。不要让用户自己打开终端，也不要在用户同意前执行确认。

`summary` 里的 `estimatedCredits` 是这次生成的预估积分，`amountMicrocredits` 是同一金额的微积分整数形式，两者都由服务端按真实计费规则算出，不是本地估算。询问用户时把预估积分一起说出来，让用户在花钱前看到价格。`summary.estimateError` 表示这次参数算不出报价（通常是模型或参考素材不合法），提交同样会被拒绝：先按提示改参数，不要把这种调用拿去让用户确认。挂起阶段只做报价和参数体检，`videoEditOperation` 这类取值的硬校验发生在 `linggan confirm` 那一步——所以别用“挂起没报错”当成参数一定合法的证明。
