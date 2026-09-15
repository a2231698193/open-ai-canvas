# 问鼎 LK888 Seedance 按秒

该目录是独立官方协议插件源码。后端从生成的 `lk888-seedance-anmiao.yingce-plugin` 包加载，不依赖系统内置 `host:` 适配器。

问鼎按秒路径：`POST/GET /api/v3/anmiao/contents/generations/tasks`。`duration` 必须是 4～15 整数秒，不接受 `-1`。content 角色原样映射。

完整接口见 [docs/interface.md](docs/interface.md)。
