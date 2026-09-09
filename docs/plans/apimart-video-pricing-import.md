# APIMart 视频价格批量导入

批量导入器只处理目标系统渠道中**已经存在**的模型，不会自动创建模型。对于价格快照中能精确匹配、且能力和协议均为空的待配置模型，导入器会同时初始化 APIMart 视频能力、绑定 `apimart-video` 协议并启用模型。

## 规则

- 渠道默认按名称 `apimart` 精确匹配；同名渠道超过一个时必须使用渠道 ID。
- 模型按 `modelKey` 或 `providerModelKey` 匹配 APIMart JSON 中的视频模型 ID。
- 使用 JSON 中 `fixed_prices.items[].after_discount`。APIMart `1 Credit = 0.10 USD ≈ 0.70 元`，灵感 `1 元 = 10 积分`。
- 价格档只保存成本：`1 APIMart Credit = 7 灵感积分`，即 `灵感成本积分 = APIMart 折后 USD × 70`。
- 30% 目标毛利率由系统“默认模型倍率”统一实现：`倍率 = 1 ÷ (1 - 30%) = 1.4286`。
- 例如 `2.16 APIMart Credits/秒` 导入为 `15.12` 成本积分/秒；应用 `1.4286` 倍率后约扣 `21.6004` 积分，即约 `2.16 元/秒`。
- 未匹配模型不会创建，也不会修改。
- 已配置为其他能力或其他协议的模型不会被覆盖。
- 当前自动初始化范围由价格快照精确匹配决定；本次生产数据预计匹配 7 个模型：`MiniMax-H3`、`kling-3.0-turbo`、`kling-v3`、`seedance-1-5-pro`、`seedance-2.0`、`seedance-2.0-mini`、`seedance-2.5`。
- dry-run 会额外输出 `initialize capability=video protocol=apimart-video ...`，但不会写入数据库。
- 价格档会原子替换该模型的当前活动价格档；已有结算记录引用的旧价格档会按仓库逻辑保留软删除历史。

## 生产服务器操作

进入生产代码目录：

```bash
cd /data/open-ai-canvas
```

先备份：

```bash
sudo /usr/local/sbin/backup-yingce
```

把本文件对应的原始价格快照放在服务器：

```text
/data/open-ai-canvas/docs/plans/apimart-pricing.json
```

重新构建后端镜像：

```bash
sudo docker compose --env-file .env \
  -f docker-compose.deploy.yml \
  -f docker-compose.build.yml \
  build backend
```

先执行 dry-run，只显示将要更新的模型和价格档：

```bash
sudo docker compose --env-file .env \
  -f docker-compose.deploy.yml \
  -f docker-compose.build.yml \
  run --rm \
  -v /data/open-ai-canvas/docs/plans/apimart-pricing.json:/app/apimart-pricing.json:ro \
  --entrypoint import-apimart-video-pricing \
  backend \
  --pricing /app/apimart-pricing.json \
  --channel-name apimart
```

确认 dry-run 的匹配模型、价格档和数量无误后，执行写入：

```bash
sudo docker compose --env-file .env \
  -f docker-compose.deploy.yml \
  -f docker-compose.build.yml \
  run --rm \
  -v /data/open-ai-canvas/docs/plans/apimart-pricing.json:/app/apimart-pricing.json:ro \
  --entrypoint import-apimart-video-pricing \
  backend \
  --pricing /app/apimart-pricing.json \
  --channel-name apimart \
  --apply
```

如果渠道名称不是唯一的，先用数据库中确定的 ID：

```bash
... --channel-id CHANNEL_000004
```

## 检查结果

在管理后台重新打开目标渠道的模型价格，或执行：

```bash
sudo docker compose --env-file .env \
  -f docker-compose.deploy.yml \
  -f docker-compose.build.yml \
  run --rm \
  -v /data/open-ai-canvas/docs/plans/apimart-pricing.json:/app/apimart-pricing.json:ro \
  --entrypoint import-apimart-video-pricing \
  backend \
  --pricing /app/apimart-pricing.json \
  --channel-name apimart
```

再次 dry-run 应显示相同价格。导入后建议用一个低成本视频模型做一次小额测试。

不要把 API Key、`.env` 或数据库内容放入价格 JSON。