# Volcengine AI MediaKit

该目录仅提供视频画质增强协议，后端加载 `volcengine-mediakit.yingce-plugin`。

Provider ID：`volcengine-mediakit-enhance-video`，`kind: processing`，能力 `video`，原有请求、鉴权和响应映射保持不变。

深度动作捕捉已拆分至 [独立插件](../volcengine-mediakit-video-depth/README.md)，两个插件可分别启停。完整接口见 [docs/interface.md](docs/interface.md)。
