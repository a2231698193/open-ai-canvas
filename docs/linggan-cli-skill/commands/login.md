# 登录

```bash
linggan login --server https://站点
```

`--server` 也可以用环境变量 `LINGGAN_API`。地址可以不带 `/api`，命令会自动补上。

用户名和密码从终端读取。不要把密码写进命令参数、技能说明或对话记录。

成功后会话保存在 `~/.linggan/session.json`，权限只有当前用户可读写。后续命令使用这份会话。

```bash
linggan whoami
linggan logout
```

`whoami` 的 stdout 是当前账号 JSON。`logout` 会让服务器会话失效并删除本机文件。
