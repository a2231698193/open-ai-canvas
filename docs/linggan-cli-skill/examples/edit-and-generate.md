# 修改节点后提交生成

先读取摘要，再写入操作文件。

```bash
linggan canvas state
linggan canvas apply --file ops.json
```

先按本次参考素材列出模型，再提交生成。生成会创建画布节点并在终端等待确认：

```bash
linggan canvas tool model_list --file model.json
linggan canvas tool generate_media --file generate.json
```

命令返回 `needs_confirmation` 时，把 `summary` 发到对话里询问用户。用户同意后执行返回的 `nextCommand`。不要要求用户自己打开终端。

确认并返回任务 ID 后：

```bash
linggan task get <任务ID>
```

任务进入终态后结果已经写回节点，不用等网页刷新：`canvas state` 看节点 `status` 变成 `success`，再用 `canvas_inspect_media` 取短时链接下载视频。
