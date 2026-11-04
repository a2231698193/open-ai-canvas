# 问鼎 LK888 可灵视频

该目录是独立官方协议插件源码。后端从生成的 `lk888-kling-video.yingce-plugin` 包加载，不依赖系统内置 `host:` 适配器。

覆盖问鼎数据的可灵动作控制 V3（`kling-motion-control-v3`）与可灵 V4（`kling-v4-video`）：

- 动作控制 V3：参考图片 + 参考视频驱动，必填 `character_orientation`、`mode`，可选保留原声。
- 可灵 V4：文生视频或多模态参考生，支持 1～10 张参考图、1～5 段参考视频、3～30 秒与 720p/1080p。

两者共用问鼎 `POST /v1/media/generate` + `GET /v1/media/status` 异步任务协议。完整接口见 [docs/interface.md](docs/interface.md)。
