# 上传素材

```bash
linggan asset upload --file ./poster.png --kind image
```

`--kind` 可以是 `image`、`video` 或 `audio`。不写时由服务器识别。

stdout 返回资源 JSON。后续生成任务引用这里返回的资源，不把本地路径或任意 URL 写进画布操作。
