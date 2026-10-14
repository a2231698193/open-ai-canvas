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

Windows PowerShell 用户可在仓库根目录执行：

```powershell
.\scripts\start-local.ps1
```

### Docker 开发与本地构建

以下命令用于本地开发或试运行。部署服务器并使用后台在线更新，请使用下文的官方 Release 镜像部署。

源码热更新：

```bash
LOCAL_UID=$(id -u) LOCAL_GID=$(id -g) \
  docker compose -f docker-compose.dev.yml up --build
```

本地构建并运行 release 镜像：

```bash
# 本地构建并运行
docker compose -f docker-compose.local.yml up -d --build

# 源码热更新
LOCAL_UID=$(id -u) LOCAL_GID=$(id -g) docker compose -f docker-compose.dev.yml up --build
```

本地开发说明（含时间线字幕转写）见[本地开发文档](docs/content/docs/backend/local-development.mdx)。

热更新开发默认前端端口为 `3000`、后端端口为 `8080`；端口冲突时可通过 `CANVAS_WEB_HOST_PORT` 和 `CANVAS_BACKEND_HOST_PORT` 覆盖。本地构建编排只暴露 web 的 `3000`，后端留在容器网络内，不安装 Host Updater。

## 部署与安全

## 架构概览

```text
浏览器（web/）
  ├─ React 工作区、画布、任务中心和素材库
  ├─ Zustand / localForage 本地状态与降级缓存
  └─ 登录态 API、资源请求和 SSE
          │
          ▼
后端（backend/）
  ├─ Gin handler -> service -> repository/model
  ├─ SQLite（本地）或 PostgreSQL + Redis（部署）
  ├─ 异步任务 worker、权限、资源存储和模型中转
  └─ provider / outbound -> 外部模型渠道
```

前端业务 API 统一经 `web/src/services/api/request.ts` 调用。生产环境由 Nginx 托管前端并代理后端，公网只需暴露 web 入口；SSE 仅在明确的流式路径关闭代理缓冲。

## 服务器部署

### 官方 Release 镜像（推荐，支持后台在线更新）

适用于使用 systemd 的 Linux 服务器。先从 [GitHub Releases](https://github.com/ddcat-ai/open-ai-canvas/releases) 选择包含镜像、Host Updater 二进制和 `SHA256SUMS` 的已发布版本，将下方 `vX.Y.Z` 替换为该版本：

```bash
CANVAS_RELEASE=vX.Y.Z
curl -fsSL "https://raw.githubusercontent.com/ddcat-ai/open-ai-canvas/${CANVAS_RELEASE}/scripts/install-server-image.sh" \
  | sudo env CANVAS_IMAGE_TAG="${CANVAS_RELEASE}" REPOSITORY_REF="${CANVAS_RELEASE}" bash
```

脚本使用 `docker-compose.deploy.yml`，启动 PostgreSQL、Redis、独立 `yingce-agent`、backend 和 web，由一次性 `migrate` 服务迁移数据库，并安装宿主机 Host Updater。backend、web、Agent 镜像会固定为对应 GHCR digest。默认访问 `http://服务器IP:3000`，安装完成后在“系统配置 → 系统更新”检查后续版本。

查看状态和日志：

```bash
cd /opt/open-ai-canvas
sudo docker compose --env-file .env -f docker-compose.deploy.yml ps
sudo docker compose --env-file .env -f docker-compose.deploy.yml logs -f --tail=200
```

### 源码构建与已有部署

需要运行自行修改的源码时，可以使用源码安装脚本：

```bash
curl -fsSL https://raw.githubusercontent.com/ddcat-ai/open-ai-canvas/main/scripts/install-server.sh | sudo bash
```

脚本使用 PostgreSQL、Redis、独立 Agent 和源码构建叠加层，但不安装 Host Updater；该部署不属于后台在线更新管理范围，需自行构建、备份和升级。根目录的 `docker-compose.yml`、`docker-compose.local.yml` 和自行编写的两容器 SQLite 编排用于本地试运行，不作为默认服务器部署方案。

已有 SQLite 或自定义 Compose 部署，不能只替换 Compose 文件或补装更新器就获得在线更新；应先核对原数据卷、完成备份和数据迁移。方案选择见 [Docker 部署](docs/content/docs/overview/docker.mdx)，更新约束、备份和回退见[系统更新文档](docs/content/docs/backend/system-update.mdx)。

## 安全边界

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
