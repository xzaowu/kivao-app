# 深度动作捕捉（火山 MediaKit）

后端从 `volcengine-mediakit-video-depth.yingce-plugin` 加载本声明式插件，不依赖 `host:` 执行器。

Provider ID 保持 `volcengine-mediakit-video-depth`，`kind: processing`，能力 `video`。用于视频节点及视频工作台的深度动作捕捉，输出深度视频，不输出骨骼或 BVH 文件。

插件独立启停，不更改已有模型、价格、画布节点或任务记录，也不自动复制渠道密钥。完整接口与合并版替换顺序见 [docs/interface.md](docs/interface.md)。
