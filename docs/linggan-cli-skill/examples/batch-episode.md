# 示例：一集漫剧的批量出片

前提：剧本与分镜已经完成（比如用 short-drama-director 产出七段式投喂稿），角色 4 View、场景、段缝参考图都已上传并挂到画布节点上。目标：把一集 15 组 × ≤15s 的视频一次性挂起、按预算提交、等收果。

## 1. 查额度

```bash
linggan wallet
```

看 `availableCredits` 够不够整集（每组预估积分 × 组数，粗估后再留 20% 余量）。不够就先只提交前几组。

## 2. 组请求文件

把每组的投喂稿写进一个 `requests.json`（字段与 `generate_media` 一致）。Seedance 2.5 全能参考模式示例：

```json
{
  "requests": [
    {
      "mode": "video",
      "prompt": "<第 1 组七段式投喂稿正文，含 @图片1… 引用>",
      "nodeId": "vid-ep1-seg01",
      "channelId": "<渠道ID>",
      "channelModelKey": "<模型键>",
      "videoEditOperation": "reference_to_video",
      "referenceNodeIds": ["img-chr-a-4view", "img-chr-b-4view", "img-scn-alley", "img-seam-ep0", "voice-chr-a"],
      "durationSeconds": 15,
      "size": "9:16"
    }
  ]
}
```

段缝用末态双保险时，上一段的 `canvas_inspect_media` 取末帧上传为段缝参考图，作为下一组的 `reference_image`。

## 3. 挂起整批

```bash
linggan batch generate --file requests.json
```

把返回里的笔数、`totalEstimatedCredits`、`invalid` 摘要告诉用户。用户同意后执行 `nextCommand`。

## 4. 预算内整批提交

```bash
linggan confirm --all --max-credits <用户同意的预算>
```

- `remaining` 里的组（超预算或没报价）下轮再提交；
- `failed` 里的组看原因修正后重新生成草稿。

## 5. 等收果

```bash
linggan task wait <任务ID>          # 逐笔等，或用 task list --active 对账
linggan canvas tool canvas_inspect_media --file {"nodeIds":["vid-ep1-seg01"]}
```

用 `resourceUrl` 下载成片抽帧拉片；废镜组改稿后重跑第 3 步（先 `confirm --cancel` 掉不需要的旧草稿）。
