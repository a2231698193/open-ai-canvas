# 影策生产环境更新步骤

本文记录当前生产环境从官方仓库同步更新到 Fork，再部署到服务器的操作流程。

## 当前环境

- 官方仓库：`https://github.com/ddcat-ai/open-ai-canvas.git`
- Fork 仓库：`https://github.com/a2231698193/open-ai-canvas.git`
- 生产目录：`/data/open-ai-canvas`
- 生产域名：`https://linggan.mhuanet.com`
- 生产更新脚本：`/usr/local/sbin/update-yingce`
- PostgreSQL 在宿主机，不走 Compose 容器。`.env` 的 `DATABASE_URL` 不能使用主机名 `postgres`；容器内可用 `host.docker.internal` 或宿主机内网 IP。更新脚本检测到后会跳过 Docker Postgres。

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

首次安装或脚本丢失时，在服务器执行：

```bash
cd /data/open-ai-canvas
git fetch origin --prune
git show origin/main:scripts/update-yingce.sh | sudo tee /usr/local/sbin/update-yingce >/dev/null
sudo chmod 755 /usr/local/sbin/update-yingce
```

仓库里已有该文件时，也可以：

```bash
sudo install -m 0755 /data/open-ai-canvas/scripts/update-yingce.sh /usr/local/sbin/update-yingce
```

然后更新：

```bash
sudo /usr/local/sbin/update-yingce
```

更新脚本会自动：

1. 拒绝覆盖生产目录中的未提交修改；
2. 更新前备份 PostgreSQL、后端数据和 `.env`；
3. 保存旧版前后端镜像；
4. 仅以 fast-forward 更新到 `origin/main`；
5. 可用内存低于 1024MB 时拒绝更新，不切换线上容器；
6. 调低正在运行的 backend、web、redis 被 OOM 杀掉的优先级，再串行构建。编译默认用满所有核心；
7. 执行数据库迁移并重启服务；
8. 等待容器健康并检查本机健康接口。构建失败不切换容器；启动或健康检查失败时自动切回更新前的前后端镜像，不恢复数据库；
9. 只有新版本健康检查通过后，才保留最近 2 份完整备份和当前回退镜像。磁盘可用空间高于 5GB 时**不动** BuildKit 缓存。

默认保留策略可在执行命令时覆盖：

```bash
sudo BACKUP_KEEP_COUNT=3 BUILD_CACHE_MAX_SIZE=6GB MIN_FREE_MEMORY_MB=1536 /usr/local/sbin/update-yingce
```

`MIN_FREE_MEMORY_MB` 默认 1024。内存长期紧张时再临时调低，不要让构建把线上容器挤掉。

`BUILD_GOMAXPROCS` 和 `BUILD_GOGC` 只作用于这次后端编译，默认不设置，让 Go 用满所有核心。只有构建确实把内存打满、需要压低编译峰值时才临时设置，例如 `BUILD_GOMAXPROCS=2 BUILD_GOGC=50`；压得越低构建越慢。

BuildKit 缓存里带着 Go 的编译缓存和前端的依赖，`docker buildx prune --all` 会把它们一起删除，之后每次更新都变成冷构建，后端编译和前端安装各要多花好几分钟。所以脚本默认保留缓存：磁盘可用空间低于 `BUILD_CACHE_MIN_FREE_MB`（默认 5120MB）时才清理一次。需要立刻清理时执行：

```bash
sudo FORCE_BUILD_CACHE_PRUNE=1 /usr/local/sbin/update-yingce
```

确认缓存有没有被清掉，可以在更新前后各跑一次 `docker buildx du`，比较输出的总量。

清理只在新版本健康检查通过后执行。构建失败、启动失败或自动回退时，当前备份和回退镜像都不会被轮转。

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

构建失败时，线上容器仍是旧版本，不要接着手工重建。

启动或健康检查失败时，脚本会把 `rollback-<旧提交>` 重新标成正在使用的镜像，并只重建 backend 和 web。自动回退不恢复数据库。迁移已经开始时，需要按该版本的迁移内容决定是否手工恢复备份。

回退容器也起不来时，脚本会停住。不要连续重建或清理 Docker。先收集状态和日志：

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
