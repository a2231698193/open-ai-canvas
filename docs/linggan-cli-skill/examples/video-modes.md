# 四种视频模式各怎么提交

网页上的四个视频模式在命令行里不是开关，而是由「参考素材 + `videoEditOperation`」决定的。

| 模式 | 参考素材 | `videoEditOperation` |
|---|---|---|
| 文生视频 | 不传 | 省略（推导为 `text_to_video`） |
| 图生视频 | `referenceNodeIds` 放一张图 | 省略（推导为 `image_to_video`） |
| 首尾帧参考 | `references`：一条 `first_frame` + 一条 `last_frame` | 省略即可 |
| 全能参考 | 多张图放 `referenceNodeIds` | **必须 `reference_to_video`** |

先看画布上有哪些图能当参考，再按这两张图问模型目录：

```bash
linggan canvas state
linggan canvas tool model_list --file model.json
```

`model.json`（首尾帧就传这两张图）：

```json
{"mode": "video", "referenceNodeIds": ["img-scn-nursery-master", "img-scn-nursery-cam"]}
```

**模式与图片数量是绑死的**：给了 `first_frame` 就是图生视频，只能有 1 张图；给了 `first_frame` + `last_frame` 就是首尾帧，只能有 2 张图（多一张就会收到「首尾帧参考只收两张图片（首帧 + 尾帧），不能额外带参考图」）。想在首尾帧之外再带风格/角色参考图，当前不支持——那种需求要用「全能参考」（多图 + `reference_to_video`），但那条路上不表达首尾帧。

选模型时看每项的 `options.video.references.imageRoles`：要 `last_frame` 才能做首尾帧，要放三张以上图就得选支持 `reference_to_video` 的模型。

首尾帧的 `generate.json`：

```json
{
  "mode": "video",
  "prompt": "婴儿房夜景，镜头从安抚毯特写缓缓推近到窗外月光（首帧见 @图片1，尾帧见 @图片2）",
  "nodeId": "vid-seg2",
  "title": "EP01 段2 · 首尾帧",
  "channelId": "<selection.channelId>",
  "channelModelKey": "<selection.channelModelKey>",
  "size": "9:16",
  "durationSeconds": 5,
  "references": [
    {"nodeId": "img-scn-nursery-master", "role": "first_frame"},
    {"nodeId": "img-scn-nursery-cam", "role": "last_frame"}
  ]
}
```

```bash
linggan canvas tool generate_media --file generate.json
```

命令返回 `needs_confirmation`，此时还没有创建任务：

- `summary.references` 会带回每条素材的角色和顺序，先跟用户的意图核对；
- `summary.estimatedCredits` 是这次生成的预估积分，询问用户时一起说出来；
- `summary.estimateError` 说明参数算不出报价（例如「填了 last_frame 就必须同时指定 first_frame」），先改参数，不要拿去让用户确认。

用户明确同意后，执行返回的 `nextCommand`（`linggan confirm <确认编号>`）。待确认只在本机保留 30 分钟，过期要重新执行生成命令。确认后用 `linggan task get <任务ID>` 查结果，用 `linggan canvas tool canvas_inspect_media` 核对时长和分辨率。
