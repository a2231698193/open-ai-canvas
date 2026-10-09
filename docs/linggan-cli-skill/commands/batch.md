# 批量生成

`linggan batch generate` 把 N 笔生成一次性挂起，配合 `linggan confirm --all --max-credits <预算>` 整批提交。每笔仍然独立走服务端报价与准入链路，单批上限 50 笔。

两种来源，二选一：

## 从请求文件

```bash
linggan batch generate --file requests.json
```

`requests.json` 是 generate_media 参数的数组（字段与 `canvas tool generate_media` 完全一致），或包一层 `{"requests": [...]}`：

```json
{
  "requests": [
    {
      "mode": "video",
      "prompt": "第 1 段：雨夜巷口，镜头推向门缝（见 @图片1）",
      "nodeId": "vid-seg1",
      "channelId": "<渠道ID>",
      "channelModelKey": "<模型键>",
      "videoEditOperation": "reference_to_video",
      "referenceNodeIds": ["img-hero", "img-scene", "voice-1"],
      "durationSeconds": 15,
      "size": "9:16"
    },
    {
      "mode": "image",
      "prompt": "角色三视图参考",
      "nodeId": "img-turnaround",
      "logicalModelId": "<逻辑模型ID>",
      "size": "1:1"
    }
  ]
}
```

## 从批量创作表

```bash
linggan batch generate --from-batch-table <批量表节点ID> --model "渠道ID::模型键" --size 1:1 [--row-ids row-1,row-2]
```

映射口径与网页端一致：

- `globalPrompt` 非空时**覆盖**每行提示词；为空时用各行 `prompt`，空提示词行跳过；
- `try_on` 每行至少 2 张参考图，`creative` 至少 1 张，不够的行跳过；
- 停用（`enabled: false`）的行跳过；`--row-ids` 可以只提交指定行；
- 行上已有 `outputNodeId` 时复用输出节点，不会另建新节点；
- 模型写 `渠道ID::模型键`，或直接给逻辑模型 ID。

## 挂起结果

stdout 返回一个批量摘要：

```json
{
  "status": "needs_confirmation",
  "items": [{"confirmationId": "…", "estimatedCredits": 3, "summary": {"…": "…"}}],
  "invalid": [{"index": 2, "error": "…"}],
  "count": 12,
  "totalEstimatedCredits": 36,
  "nextCommand": "linggan confirm --all --max-credits 37",
  "instruction": "…"
}
```

- `items` 里每笔都有独立的 `confirmationId`，也可以逐条 `confirm`；
- `invalid` 里的请求报价失败（参数不合法），没有挂起，修正后重新执行批量生成；
- `nextCommand` 的预算取整批总额向上取整，也可以自己定一个更小的数——超出预算的挂起项会留下来。
