# 查询任务

图片、视频、音频和图层拆分不要用 `task create`。那些操作使用 `linggan canvas tool generate_media` 或 `linggan canvas tool image_layer_split`，它们会创建画布节点并把结果绑定到节点。

`task create` 只保留给已经手写完整任务协议、且不需要回写画布节点的情况。它同样必须在终端输入 `y`。

```bash
linggan task create --file task.json
linggan task get <任务ID>
```

`task.json` 使用网站提交生成时的任务对象。命令会把 `projectId` 设成当前画布；文件里已有的 `projectId` 必须和当前画布相同。

Agent 执行时不会直接创建任务，而是返回 `needs_confirmation`。把摘要发到对话里询问。用户明确同意后，执行返回的 `nextCommand`。不要要求用户自己打开终端。

```json
{
  "type": "canvas_image",
  "operation": "image",
  "prompt": "一张产品海报",
  "logicalModelId": "<用户选择的模型 ID>",
  "model": "<模型名>",
  "input": {
    "mode": "image",
    "prompt": "一张产品海报"
  }
}
```

`input` 不完整时，服务器会在用户确认后拒绝任务。确认之前可以修改文件再重新执行。

`task get` 返回任务状态和安全错误。用它判断结果，不要根据一段自然语言猜测失败原因。

任务进入 `succeeded`、`failed` 或 `cancelled` 后，服务端会把终态写回它绑定的画布节点，不需要打开网页刷新：`canvas state` 会看到 `status` 从 `loading` 变成 `success`，失败则变成 `error` 并带上安全原因。拿到成功状态后用 `canvas_inspect_media`（图片用 `canvas_inspect_image`）取短时链接去下载作品。节点已经绑定任务时不要重复提交同一笔生成。

## 列出与等待

```bash
linggan task list [--canvas <画布ID>] [--active] [--limit 50]
linggan task wait <任务ID> [--timeout 900] [--interval 5]
```

- `task list` 默认列当前画布的任务；`--all` 列全部画布，`--active` 只看进行中的。批量出片后先用它对账：多少笔在跑、多少笔已终态。
- `task wait` 轮询单个任务直到 `succeeded`/`failed`/`cancelled`，输出最终任务 JSON；超时报错并给出最后的任务状态。等一批任务时对每笔并发调用（或逐个 wait），收完果再用 `canvas_inspect_media` 拉取作品。
- 等待期间任务失败是正常结果，不要重试提交同一笔生成；先看失败原因。
