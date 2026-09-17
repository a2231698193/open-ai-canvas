# 问鼎 LK888 Midjourney

该目录是独立官方协议插件源码。后端从生成的 `lk888-mj.yingce-plugin` 包加载，不依赖系统内置 `host:` 适配器。

覆盖问鼎 `mj_imagine`（Midjourney）单模型：MJ / Niji 两种模式、10 档画面比例、1~4 张垫图，以及可选的 `quality` / `stylize` / `chaos` / `style`。

完整接口见 [docs/interface.md](docs/interface.md)。
