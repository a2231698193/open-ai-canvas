# 灵感（影策二开）

本仓库是[影策](https://github.com/ddcat-ai/open-ai-canvas)的二次开发版本，对外品牌为「灵感」，只用于自有部署。

影策提供自由画布、短剧工作流、任务与素材库、云端 Agent 等基础能力；本仓库保留这些能力，并按「灵感」的品牌、渠道与使用习惯做增量修改。上游的在线演示、发布镜像、赞助商与交流群不适用于本仓库。

> 项目仍在快速开发，数据结构和外部接口可能调整。默认适合个人、本地或可信环境部署；未经安全配置，不要直接作为公网多人服务使用。

## 本仓库相对上游的差异

- 品牌与入口：默认品牌为「灵感」，站点根路径展示公开欢迎页，创作台固定在 `/create`；站点名、Logo 和皮肤在后台「系统配置 → 站点及外观」调整。
- 插件协议：新增问鼎 LK888（图片 / 视频 / Seedance）与 APIMart（图片 / 视频）声明式协议，并支持视频计费批量导入。
- 计费展示：用户可见价格按计费倍率折算为最终扣费，后台模型编辑仍显示配置单价。
- 产品更新：账户菜单的「产品更新」读取本仓库的用户侧更新日志。
- 短剧分镜：恢复章节与画布分镜的结构化镜头行解析。
- 工程约定：按最小范围合并官方 `upstream/main`，不接入第三方埋点或日志外发；协作约定见 [`AGENTS.md`](AGENTS.md)。
- 外部命令行：[`linggan` 安装、Skill 包和登录说明](docs/plans/linggan-cli.md)。

上游能力细节以[功能清单](docs/content/docs/overview/features.mdx)为准。

## 快速开始

环境要求：[Bun](https://bun.sh/)、[Go 1.25](https://go.dev/)；容器开发或部署时需要 Docker Compose。

```bash
git clone https://github.com/a2231698193/open-ai-canvas.git
cd open-ai-canvas

# 本地开发数据与缓存放在 Git 忽略的目录
mkdir -p .local/project-workbench-debug .local/cache/go-build .local/cache/go-mod

# 终端一：后端
cd backend
CANVAS_BACKEND_ADDR=127.0.0.1:8080 \
CANVAS_BACKEND_DATA_DIR=../.local/project-workbench-debug \
GOCACHE=../.local/cache/go-build \
GOMODCACHE=../.local/cache/go-mod \
go run ./cmd/server

# 终端二：前端
cd ../web
bun install --frozen-lockfile
bun run dev
```

打开 <http://localhost:3000>，首次使用时注册管理员账号，并在设置中配置模型渠道。前端默认把 `/api` 代理到 `http://127.0.0.1:8080`，需要改目标时设置 `VITE_API_PROXY_TARGET`。

容器方式：

```bash
# 本地构建并运行
docker compose -f docker-compose.local.yml up -d --build

# 源码热更新
LOCAL_UID=$(id -u) LOCAL_GID=$(id -g) docker compose -f docker-compose.dev.yml up --build
```

本地开发说明（含时间线字幕转写）见[本地开发文档](docs/content/docs/backend/local-development.mdx)。

## 部署与安全

生产使用 `docker-compose.deploy.yml`（PostgreSQL + Redis + backend + web），公网只暴露 web 的 `3000`；升级、迁移、备份与回退见[系统更新文档](docs/content/docs/backend/system-update.mdx)。

- 首次管理员注册应在受控网络完成，公网部署保持 `CANVAS_REGISTRATION_ENABLED=false`。
- 设置准确的 `CANVAS_CORS_ORIGINS`，使用 HTTPS，不要把后端 `8080` 暴露到公网。
- 模型上游默认拒绝本机、私网和链路本地地址；开发时只通过 `CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS` 精确放行可信主机。
- 限制 `.env`、数据库、数据目录、备份与 `.settings-key` 的权限；密钥和 Cookie 不进 URL、日志或错误上报。

安全问题按 [`SECURITY.md`](SECURITY.md) 反馈，不要在公开 Issue 中粘贴密钥、Cookie 或生产日志。

## 文档

- [快速开始](docs/content/docs/overview/quick-start.mdx) · [功能清单](docs/content/docs/overview/features.mdx) · [代码功能地图](docs/content/docs/backend/code-map.mdx)
- [本地开发](docs/content/docs/backend/local-development.mdx) · [数据库结构](docs/content/docs/backend/backend-database.mdx) · [系统更新](docs/content/docs/backend/system-update.mdx)
- [画布操作手册](docs/content/docs/canvas/canvas-node-manual.mdx) · [插件系统](docs/content/docs/plugins/plugin-system.mdx)
- [待办](docs/content/docs/progress/todo.mdx) · [待测试清单](docs/content/docs/progress/pending-test.mdx)
- [产品更新](USER_CHANGELOG.md) · [变更记录](CHANGELOG.md) · [贡献者](CONTRIBUTORS.md) · [上游声明](NOTICE)

按改动范围做最小验证：

```bash
cd web && bun run lint && bun run build   # 前端
cd backend && go test ./...               # 后端
```

## 许可证与上游

本仓库采用 [MIT](LICENSE) 协议。代码来自[影策](https://github.com/ddcat-ai/open-ai-canvas)（MIT），影策基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 的早期版本二次开发；上游作者与贡献者保留对应代码的权利与署名，清单见 [`CONTRIBUTORS.md`](CONTRIBUTORS.md) 与 [`NOTICE`](NOTICE)。
