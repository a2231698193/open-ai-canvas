# 查询任务

图片、视频、音频和图层拆分不要用 `task create`。那些操作使用 `linggan canvas tool generate_media` 或 `linggan canvas tool image_layer_split`，它们会创建画布节点并把结果绑定到节点。

`task create` 只保留给已经手写完整任务协议、且不需要回写画布节点的情况。它同样必须在终端输入 `y`。

```bash
linggan task create --file task.json
linggan task get <任务ID>
```

`task.json` 使用网站提交生成时的任务对象。命令会把 `projectId` 设成当前画布；文件里已有的 `projectId` 必须和当前画布相同。

提交前，命令在当前终端显示 `type`、`operation`、`model`、`logicalModelId` 和 `prompt`。用户输入 `y` 后才请求服务器。没有终端，或输入的不是 `y`，都不会创建任务，也不会扣积分。

Agent 不能添加确认参数，不能把 `y` 写入命令，也不能在没有终端的环境运行 `task create`。

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
