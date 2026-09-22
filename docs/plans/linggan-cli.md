# 灵感命令行

`linggan` 给外部 Agent 使用。Agent 用自己的模型决定怎么做，命令只负责登录、画布、素材和生成。

## 安装命令

macOS 和 Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/a2231698193/open-ai-canvas/main/scripts/install-linggan.sh | bash
```

安装包发布在 [GitHub Releases](https://github.com/a2231698193/open-ai-canvas/releases/latest)。`v1.5.7.2` 的质量检查和镜像构建通过后，这里才会出现四个系统压缩包。

## 安装 Skill

把下面的压缩包交给 Agent，或解压后放到它的 skills 目录：

[linggan-cli-skill.zip](https://github.com/a2231698193/open-ai-canvas/raw/main/scripts/linggan-cli-skill.zip)

压缩包里包含 `SKILL.md`、命令说明和示例。Agent 只能按其中的命令操作，不要调用系统语言模型。

## 登录

```bash
linggan login --server https://你的站点
```

生成图片或视频时，Agent 会先在对话里给出摘要。你同意后，它再自己提交，不需要你另外打开终端。
