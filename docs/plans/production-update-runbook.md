# 影策生产环境更新步骤

本文记录当前生产环境从官方仓库同步更新到 Fork，再部署到服务器的操作流程。

## 当前环境

- 官方仓库：`https://github.com/ddcat-ai/open-ai-canvas.git`
- Fork 仓库：`https://github.com/a2231698193/open-ai-canvas.git`
- 生产目录：`/data/open-ai-canvas`
- 生产域名：`https://linggan.mhuanet.com`
- 生产更新脚本：`/usr/local/sbin/update-yingce`

## 1. 将官方更新同步到 Fork

没有二开提交或确认不会冲突时，在 Fork 的 GitHub 页面点击：

```text
Sync fork → Update branch
```

有二开提交时，在开发电脑合并，不要在生产服务器解决冲突：

```bash
cd /path/to/open-ai-canvas
git checkout main
git status
git fetch origin --prune
git fetch upstream --prune
git pull --ff-only origin main
git log --oneline --decorate HEAD..upstream/main
git merge upstream/main
```

处理冲突并完成必要验证后推送：

```bash
git push origin main
```

按改动范围选择验证：

```bash
cd web && bun run build
cd ../backend && go test ./...
```

## 2. 在生产服务器预览待部署提交

```bash
cd /data/open-ai-canvas
sudo git fetch origin --prune

echo "=== 当前生产版本 ==="
git log -1 --oneline

echo "=== 等待部署的提交 ==="
git log --oneline --decorate HEAD..origin/main
```

确认待部署提交正确后再继续。

## 3. 执行生产更新

```bash
sudo /usr/local/sbin/update-yingce
```

更新脚本会自动：

1. 拒绝覆盖生产目录中的未提交修改；
2. 更新前备份 PostgreSQL、后端数据和 `.env`；
3. 保存旧版前后端镜像；
4. 仅以 fast-forward 更新到 `origin/main`；
5. 串行构建后端和前端，降低小内存服务器 OOM 风险；
6. 执行数据库迁移并重启服务；
7. 等待容器健康并检查本机健康接口。

## 4. 更新后验证

```bash
cd /data/open-ai-canvas

echo "=== 当前版本 ==="
git log -1 --oneline --decorate

echo "=== 工作区 ==="
git status --short

echo "=== 容器状态 ==="
sudo docker compose --env-file .env \
  -f docker-compose.deploy.yml \
  -f docker-compose.build.yml \
  ps -a

echo "=== 本机健康 ==="
curl -fsS http://127.0.0.1:3001/api/health/ready
echo

echo "=== 公网健康 ==="
curl -fsS https://linggan.mhuanet.com/api/health/ready
echo
```

随后在浏览器检查：

- 管理员登录和刷新后的登录态；
- 管理后台；
- 模型渠道及逻辑模型；
- 上传和生成任务；
- 积分冻结、结算或退款。

## 5. 更新失败时

不要连续重建或清理 Docker。先收集状态和日志：

```bash
cd /data/open-ai-canvas
sudo docker compose --env-file .env \
  -f docker-compose.deploy.yml \
  -f docker-compose.build.yml \
  ps -a
sudo docker compose --env-file .env \
  -f docker-compose.deploy.yml \
  -f docker-compose.build.yml \
  logs --tail=200
```

更新前备份位于：

```text
/data/open-ai-canvas-backups/
```

旧镜像标签格式为：

```text
open-ai-canvas-backend:rollback-<旧提交前12位>
open-ai-canvas-web:rollback-<旧提交前12位>
```

数据库迁移可能不可逆，不要只回退代码或镜像后直接启动。发生迁移相关故障时，应根据该版本迁移内容决定是否恢复更新前数据库和后端数据备份。

## 注意事项

- 生产服务器只拉取 Fork 的 `origin/main`。
- 官方 `upstream/main` 先在 GitHub 或开发电脑合并并验证。
- 不在生产服务器修改代码或解决 Git 冲突。
- 不执行 `git reset --hard`、`docker system prune` 或强制推送。
- 不提交 `.env`、数据库、备份、Token 或 API Key。
