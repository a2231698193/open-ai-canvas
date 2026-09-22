---
name: linggan-cli
description: >-
  用 linggan 命令操作灵感画布。外部 Agent 只能通过这个命令登录、创建或打开画布、
  读取摘要、修改节点、上传素材和提交生成。不要调用系统语言模型，不要直接请求
  /api/agent/runs，也不要替用户确认生成。
---

# linggan

`linggan` 是灵感的命令行。思考和决定由当前 Agent 自己的模型完成。命令只负责登录、画布、素材和生成任务。

命令输出的 JSON 在 stdout。错误在 stderr，退出码非 0。

## 硬性边界

- 不调用 `/api/agent/runs`，也不使用灵感站点里的语言模型。
- 不自己拼接 HTTP 请求，不读取 `~/.linggan/session.json`。
- 生成没有 `--yes`。Agent 执行 `generate_media`、`image_layer_split` 或 `task create` 时，命令不会提交，只会返回 `needs_confirmation`。先用对话把摘要告诉用户并询问。用户明确同意后，由 Agent 执行返回的 `nextCommand`，不要让用户自己去终端执行。用户未同意时不要执行确认命令。
- 不能删除普通节点：只有 `canvas_get_state` 里带 `agentCreated`、且没有正文、没有任务、没有连线、没有被分镜或批量表引用的空节点能用 `canvas_apply_ops` 的 `delete_node` 撤销。文本/剧本节点的正文、媒体节点的提示词草稿（`composerContent`）都算内容；媒体节点没有任务时那份自动写入的 `prompt` 不算（它清不掉）。不能写任意媒体地址或任意 metadata。分镜和批量创作表只能使用各自的工具删除一行。
- 第一版没有项目工作区。项目、分集和角色仍在网页里处理。

## 命令

| 命令 | 说明 |
|---|---|
| `linggan login --server <站点>` | 登录并保存本机会话 |
| `linggan logout` | 退出并删除本机会话 |
| `linggan whoami` | 查看当前账号 |
| `linggan canvas list` | 列出当前用户的画布 |
| `linggan canvas create --title <名称>` | 创建空画布并设为当前画布 |
| `linggan canvas use <画布ID>` | 打开已有画布 |
| `linggan canvas state [--offset N] [--connection-offset N]` | 读取当前画布摘要、连线、`snapshotHash` 和总数 |
| `linggan canvas apply --file <操作.json>` | 新增、修改、删除自己建的空节点或建立连线 |
| `linggan canvas tool <工具名> --file <参数.json>` | 执行网页画布 Agent 的画布工具，包括分镜、批量表、模型目录和图片/视频/音频生成 |
| `linggan asset upload --file <文件>` | 上传素材 |
| `linggan task get <任务ID>` | 查询任务状态 |
| `linggan confirm <确认编号>` | 用户在对话里同意后，提交刚才挂起的生成 |
| `linggan confirm --list` | 列出还没过期的待确认生成 |
| `linggan confirm --cancel <确认编号>` | 取消一条待确认生成（没有创建任务、没有扣费） |

待确认生成只在本机保留 30 分钟，`needs_confirmation` 会返回 `expiresAt`；过期后必须重新执行生成命令，不能拿旧草稿提交。

详细参数见 `commands/`。可复制流程见 `examples/`。

安装见仓库 `scripts/install-linggan.sh`。安装前的版本标签还没有这些压缩包时，命令不存在是正常的。
