# 画布

`canvas create` 和 `canvas use` 会把画布记为当前画布。之后的 `state`、`apply` 和 `task create` 默认使用它。临时指定用 `--canvas <画布ID>`。

```bash
linggan canvas list
linggan canvas create --title "产品广告"
linggan canvas use <画布ID>
linggan canvas state --offset 0
```

`state` 返回节点摘要、连线和 `snapshotHash`。节点很多时看 `hasMore` 和 `nextOffset`，用 `--offset` 继续读。不要猜节点 ID。

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

允许的 `type` 只有 `add_node`、`update_node`、`connect_nodes`。一次最多 20 项。

`nodeType` 可以是 `text`、`markdown`、`image`、`video`、`audio`、`frame`、`batch-table`、`script`。

文本节点更新正文用：

```json
{"type": "update_node", "id": "note-1", "patch": {"metadata.content": "修改后的正文"}}
```

图片、视频、音频节点更新下次生成用的提示词草稿用 `metadata.composerContent`。这不会覆盖已经提交的生成结果。

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
| `canvas_inspect_image` | 返回图片节点的短时查看链接，供外部模型看图 |
| `image_annotation_render` | 生成标注参考图 |
| `generate_media` | 创建图片、视频或音频节点并提交生成 |
| `image_layer_split` | 拆分图片图层并提交生成 |

图片、视频和音频生成优先用 `generate_media`，不要用 `task create`。`task create` 只提交任务，不会创建结果节点，也不会把结果写回画布。

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

分镜：

```bash
linggan canvas tool canvas_create_storyboard --file storyboard.json
linggan canvas tool canvas_read_storyboard --file read.json
linggan canvas tool canvas_edit_storyboard --file edit.json
```

创建时提交 `snapshotHash`、`nodeId`、`title` 和结构化 `rows`。之后的修改必须先读取，使用返回的真实 `rowId` 和新的 `snapshotHash`。`action` 只能是 `append`、`update` 或 `remove`。

批量创作表使用 `canvas_read_batch_table` 和 `canvas_edit_batch_table`。它可以改任务行、并发和参考图列，但不会提交收费生成。

Agent 执行 `generate_media` 或 `image_layer_split` 时，stdout 返回 `needs_confirmation`，此时还没有创建任务。把 `summary` 告诉用户并询问。用户明确同意后，执行同一输出里的 `nextCommand`。不要让用户自己打开终端，也不要在用户同意前执行确认。
