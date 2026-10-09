# 确认

生成命令在 Agent 运行时不提交，只挂起（`needs_confirmation`）。用户在对话里明确同意后，由 Agent 执行确认命令。

```bash
linggan confirm <确认编号>                       # 提交一条
linggan confirm --all [--max-credits N] [--canvas <画布ID>]   # 整批提交
linggan confirm --list                          # 列出仍有效的挂起项
linggan confirm --cancel <确认编号>              # 取消一条（没有创建任务、没有扣费）
```

## 整批提交

`confirm --all` 把挂起列表按创建顺序累计预估积分：

- 传了 `--max-credits N`：放得进预算的逐笔提交，放不进的**保留在挂起列表**，等下一批或修正预算后再确认；
- 没传 `--max-credits`：全量提交——`--all` 本身已经是明确动作，但 Agent 在对话里仍要先征得用户同意；
- 算不出报价的挂起项永远不会被 `--all` 提交，它们单独出现在 `remaining` 里（`estimatedCredits` 为 `null`），先弄清金额再处理；
- 单笔提交失败不影响其他笔，失败项留在 `failed` 里并带原因，挂起不删除（服务端拒绝通常是参数过期或已失效，可 `--cancel` 掉重跑）。

返回示例：

```json
{
  "status": "submitted",
  "submittedCount": 10,
  "confirmedCredits": 30,
  "confirmed": [{"confirmationId": "…", "response": {"taskId": "…"}}],
  "failed": [],
  "remaining": [{"confirmationId": "…", "estimatedCredits": 8}],
  "remainingCount": 1,
  "budgetCredits": 30
}
```

批量生成怎么产生挂起项见 `batch.md`。待确认内容只是本地草稿，30 分钟过期，过期后必须重新执行生成命令重新报价。
