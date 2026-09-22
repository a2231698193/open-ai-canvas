# 创建并修改分镜

先读取当前画布，把 `snapshotHash` 写入分镜文件。

```bash
linggan canvas state
linggan canvas tool canvas_create_storyboard --file storyboard.json
```

`storyboard.json`：

```json
{
  "snapshotHash": "<canvas state 返回的 snapshotHash>",
  "nodeId": "storyboard-1",
  "title": "追逐戏",
  "rows": [
    {"durationSeconds": 4, "plotDescription": "主角冲出巷口", "camera": "低机位跟拍"}
  ]
}
```

创建后再读取真实镜头 ID：

```bash
linggan canvas tool canvas_read_storyboard --file read.json
```

```json
{"nodeId": "storyboard-1", "offset": 0}
```

修改或删除时使用这次返回的 `snapshotHash` 和 `rowId`，不要沿用创建前的哈希。
