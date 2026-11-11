# KIVAO 坤肉视频（供应商直连）

版本 `1.2.0`，沿用插件与协议 ID `kivao-kunrou-video`。Base URL 为
`https://api.kunrouai.com`，使用渠道内的供应商 API Key。不再经过 KIVAO New API，
模型请求 ID 不带 `kivao/` 前缀。

| 系列 | 请求模型 | 创建接口 | 时长 |
| --- | --- | --- | --- |
| Veo / Omni | `gemini-veo-3.1-fast`、`gemini-veo-3.1-lite`、`gemini-omni-1.1-flash` | `POST /v1/videos` | Veo 4/6/8 秒；Omni 3–10 秒 |
| Grok | `grok-imagine-video`、`grok-imagine-video-1.5` | `POST /v1/videos` | 1–15 秒 |
| SD | `sd2.0-fast-480p`、`sd2.0-fast-720p`、`sd2.0-mini-480p`、`sd2.0-mini-720p` | `POST /v1/tasks/sora` | 4–15 秒 |

所有型号通过 `GET /v1/videos/{task_id}` 查询。Grok 完成响应通常不返回 URL，
宿主使用同源 `GET /v1/videos/{task_id}/content` 携带渠道鉴权下载；响应包含视频
直链时交由宿主安全下载，不把渠道密钥传给外部媒体地址。下载失败不视为成功。

Grok 发送 `duration`、`resolution`、`aspect_ratio`、`generate_audio` 和可选首帧
`image.url`。SD 发送字符串 `seconds`、`ratio`、`aspect_ratio`、`resolution` 和
可选 `images` 公网图片 URL 数组，不发送 Grok 或 Google 专属字段。

Veo/Omni 保留原插件的首尾帧、参考图、时长和分辨率校验；Veo 参考图及高分辨率
需要 8 秒，Lite 不支持普通参考图，视频延长限制保持。720p 横屏 8 秒单首帧沿用
已知的 `size=1280x720` 请求格式。宿主为需要的图片和视频准备可访问的素材 URL，
不在插件内增加上传入口，不改变素材归属或落库方式。

此版本主动拒绝旧 `kivao/` 模型名、未知模型、音频参考、水印和未映射厂商参数。
从旧中转版升级前必须核对所有绑定模型的 Base URL、凭据类型与请求 ID；不能只替换
插件后继续使用旧中转渠道。插件不修改价格、不自动启用渠道，也不自动重试创建请求。

接口依据：[坤肉使用文档](https://doc.kunrouai.com/)。价格以
[供应商价格页](https://api.kunrouai.com/pricing)及实际账户分组为准，不使用 Google
或 xAI 官方报价代替中转采购成本。离线协议测试不能代替真实生成、媒体与账单验收。
