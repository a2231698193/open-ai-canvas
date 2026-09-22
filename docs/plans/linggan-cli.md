# 灵感命令行

`linggan` 给外部 Agent 使用。Agent 用自己的模型决定怎么做，命令只负责登录、画布、素材和生成。

## 安装命令

macOS 和 Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/a2231698193/open-ai-canvas/main/scripts/install-linggan.sh | bash
```

安装包发布在 [GitHub Releases](https://github.com/a2231698193/open-ai-canvas/releases)。每次推送 `v*` 版本标签时，流水线先跑质量检查和前后端镜像构建，通过后才编译四个系统的命令行压缩包并挂到这个 Release 上。

安装脚本会在 Release 列表里挑**最新的、同时带目标平台压缩包和 `SHA256SUMS`** 的那一个，不读 `/releases/latest`。四段版本号（如 `v1.5.7.3`）会被 GitHub 判为预发布，`latest` 因此返回 404，而这正是本仓库当前的发布形态。

最新的 `linggan` 需要服务端也部署对应版本，命令行才能连上画布和生成接口。临时想用源码版本：

```bash
cd backend
go build -o "$HOME/.linggan/bin/linggan" ./cmd/linggan
```

## 安装 Skill

把下面的压缩包交给 Agent，或解压后放到它的 skills 目录：

[linggan-cli-skill.zip](https://github.com/a2231698193/open-ai-canvas/raw/main/scripts/linggan-cli-skill.zip)

压缩包里包含 `SKILL.md`、命令说明和示例。Agent 只能按其中的命令操作，不要调用系统语言模型。

## 登录

```bash
linggan login --server https://你的站点
```

生成图片或视频时，Agent 会先在对话里给出摘要。你同意后，它再自己提交，不需要你另外打开终端。
