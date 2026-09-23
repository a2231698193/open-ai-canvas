# 上传素材

```bash
linggan asset upload --file ./poster.png --kind image
```

`--kind` 可以是 `image`、`video` 或 `audio`。不写时由服务器识别。

stdout 返回资源 JSON，其中 `resource.id` 是后续要用的资源 ID。

## 把上传的素材放到画布上

上传只进账号资源库；要让它出现在画布上（并成为可用的参考素材），用 `canvas apply` 给媒体节点带上 `resourceId`：

```bash
linggan canvas state                       # 取 snapshotHash
```

```json
{
  "snapshotHash": "<canvas state 返回的 snapshotHash>",
  "ops": [
    {"type": "add_node", "id": "ref-1", "nodeType": "image", "title": "参考图", "resourceId": "<asset upload 返回的 resource.id>"}
  ]
}
```

```bash
linggan canvas apply --file ops.json
```

- 只有图片、视频、音频节点能挂素材，且资源类型要与节点类型一致。
- 服务端校验资源归属、就绪状态和媒体类型：别人的资源、还没就绪的资源、类型不匹配都会被拒绝并说明原因。
- 已关联生成任务的节点是生成结果，不接受素材覆盖；要换素材请新建节点。
- 挂载成功后该节点就是普通画布素材，可以直接用 `references`（如 `first_frame`）当参考图提交生成，人也能在网页上看到它。

不要把本地路径或任意 URL 写进画布操作：`resourceId` 只认账号资源库里的资源。
