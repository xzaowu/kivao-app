# 坤肉音频

通过坤肉 Chat Completions 接口生成语音或音乐，作为独立的音频协议插件安装，不替换文本 Chat、OpenAI Speech 或异步音频协议。

- 接口：`POST https://api.kunrouai.com/v1/chat/completions`，非流式 JSON。
- 文档：[坤肉音频生成](https://doc.kunrouai.com/#audio)。
- 提示词描述朗读内容、曲风、人声、语言及情绪；补充音频说明合并到同一条用户消息。
- 音色与语速通过提示词描述；保留前端默认音色与默认速度，不把 OpenAI 的音色名称传给坤肉。
- 格式支持 MP3、WAV、M4A，以模型实际返回为准；现有界面可直接选择 MP3、WAV。
- 当前 Lyria 文档要求请求模型为 `lyria-3.5-m`、`lyria-3-pro-m`，后台产品标识可保留不带后缀的名称。
- 返回音频 URL 后复用宿主的安全下载和资源持久化，不把 Markdown 文本当作音频。

模型价格和启用状态由后台单独配置。目录价格不等于当前账户成本；未确认价格的模型保持停用。插件测试使用本地 Stub，不能替代真实渠道验收。
