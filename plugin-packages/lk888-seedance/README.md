# 问鼎 LK888 Seedance

该目录是独立官方协议插件源码。后端从生成的 `lk888-seedance.yingce-plugin` 包加载，不依赖系统内置 `host:` 适配器。

问鼎站的火山方舟路径：`POST/GET /api/v3/contents/generations/tasks`。插件按显式 role 映射 `content[]`，不按下标推断首尾帧。

完整接口见 [docs/interface.md](docs/interface.md)。
