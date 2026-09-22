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

命令停在终端确认时，把显示的模型、提示词和画布告诉用户，然后等待用户自己输入 `y` 或取消。不要代为确认。

确认并返回任务 ID 后：

```bash
linggan task get <任务ID>
```
