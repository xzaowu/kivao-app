# 坤肉音频接口

## 身份与请求

- 插件及 Provider ID：`kunrou-chat-audio`。
- 能力：`audio`；声明式运行，无外部可执行程序。
- Base URL：`https://api.kunrouai.com`；渠道内现有 `apiKey` 用 Bearer 鉴权，插件不保存真实密钥。
- 创建：`POST /v1/chat/completions`，`Content-Type: application/json`。
- `model` 取后台上游模型 ID；`messages` 仅包含一条 `user` 消息，内容为提示词及可选音频说明。
- 固定 `stream: false`、`n: 1`。`audio_format` 取 `request.extra.audioFormat`，默认 `mp3`。
- `reference_images` 从已有图片引用取 URL / data URL。文档规定单张不超过 5 MiB；本插件不新增上传入口。
- 可选扩展通过 `providerOptions.kunrou-chat-audio` 的 `instrumental`、`lyrics`、`duration`、`bpm` 传入。不新增用户参数面板，时长和节奏也可写在提示词中。
- 不发送 OpenAI 专属的 `voice`、`speed` 或 `response_format`。非默认音色/速度和不支持的格式在发出请求前报错，不静默忽略。

## 响应与失败

- 从 `data[].url` 提取音频，映射 `mime_type` 为 MIME 类型，标记临时结果，由宿主下载保存。
- 音频 URL 缺失、上游 `error` / `error.code` 或无效 JSON 都保持失败；不将普通文本或 Markdown 链接伪装成音频。
- 无轮询和自动重试创建接口，避免对状态未知的音乐任务重复扣费。
- 响应 `usage` 可以为零；该插件不据此猜测免费或改写模型计费方式。

## 模型映射与计费边界

| 后台产品标识 | 上游请求模型 | 说明 |
| --- | --- | --- |
| `gemini-3.8-flash-tts` | 同名 | 文本转语音；价格页标注按秒，先核定成本与售价 |
| `grok-voice-latest` | 同名 | 文本转语音 |
| `lyria-3.5` | `lyria-3.5-m` | 按当前接口文档的请求 ID 配置 |
| `lyria-3-pro` | `lyria-3-pro-m` | 按当前接口文档的请求 ID 配置 |
| `suno-v6-mini` | 同名 | 目录声明使用 Chat 接口；保留待真实调用验收 |

模型及渠道不由插件自动启用，不修改其他模型、数据库 Schema 或既有插件。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "kunrou-chat-audio",
  "name": "坤肉音频",
  "version": "1.0.0",
  "author": "KIVAO",
  "description": "坤肉 Chat Completions 语音与音乐生成协议。",
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>",
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "apiKey",
        "type": "secret",
        "label": "API Key",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "kunrou-chat-audio",
        "label": "坤肉音频 · Chat Completions",
        "capabilities": [
          "audio"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://api.kunrouai.com",
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "model",
            "description": "后台配置的上游音频模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "messages[0].content",
            "description": "朗读内容或音乐描述，音色与语速可写在提示词中。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "instrumental/lyrics/duration/bpm",
            "description": "可选的音乐参数。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$in": [
                {
                  "$ref": "request.model"
                },
                [
                  "gemini-3.8-flash-tts",
                  "grok-voice-latest",
                  "lyria-3.5-m",
                  "lyria-3-pro-m",
                  "suno-v6-mini"
                ]
              ]
            },
            "message": "请选择已配置的坤肉音频模型；Lyria 请求 ID 需要 -m 后缀"
          },
          {
            "assert": {
              "$gt": [
                {
                  "$len": {
                    "$ref": "request.prompt"
                  }
                },
                0
              ]
            },
            "message": "请输入朗读内容或音乐描述"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.extra.audioFormat"
                    },
                    "mp3"
                  ]
                },
                [
                  "mp3",
                  "wav",
                  "m4a"
                ]
              ]
            },
            "message": "坤肉音频仅支持 MP3、WAV 或 M4A 格式"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$toFloat": {
                    "$coalesce": [
                      {
                        "$ref": "request.extra.audioSpeed"
                      },
                      1
                    ]
                  }
                },
                1
              ]
            },
            "message": "坤肉音频请保留默认速度，在提示词中描述语速"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.extra.audioVoice"
                    },
                    "alloy"
                  ]
                },
                "alloy"
              ]
            },
            "message": "坤肉音频请保留默认音色，在提示词中描述声音"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/chat/completions",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "messages": [
              {
                "role": "user",
                "content": {
                  "$concat": [
                    {
                      "$ref": "request.prompt"
                    },
                    {
                      "$if": {
                        "condition": {
                          "$ref": "request.extra.audioInstructions"
                        },
                        "then": {
                          "$concat": [
                            "\n",
                            {
                              "$ref": "request.extra.audioInstructions"
                            }
                          ]
                        },
                        "else": ""
                      }
                    }
                  ]
                }
              }
            ],
            "audio_format": {
              "$coalesce": [
                {
                  "$ref": "request.extra.audioFormat"
                },
                "mp3"
              ]
            },
            "n": 1,
            "stream": false,
            "reference_images": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$ref": "request.images"
                  },
                  "as": "image",
                  "in": {
                    "$ref": "image.value"
                  }
                }
              }
            },
            "instrumental": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.kunrou-chat-audio.instrumental"
              }
            },
            "lyrics": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.kunrou-chat-audio.lyrics"
              }
            },
            "duration": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.kunrou-chat-audio.duration"
              }
            },
            "bpm": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.kunrou-chat-audio.bpm"
              }
            }
          }
        },
        "response": {
          "status": {
            "$if": {
              "condition": {
                "$ref": "response.data.0.url"
              },
              "then": "succeeded",
              "else": "failed"
            }
          },
          "audios": {
            "$map": {
              "from": {
                "$ref": "response.data"
              },
              "as": "audio",
              "in": {
                "url": {
                  "$ref": "audio.url"
                },
                "mimeType": {
                  "$ref": "audio.mime_type"
                }
              }
            }
          },
          "errorPaths": [
            "error",
            "error.code"
          ],
          "message": {
            "$coalesce": [
              {
                "$ref": "response.error.message"
              },
              {
                "$ref": "response.message"
              },
              {
                "$if": {
                  "condition": {
                    "$ref": "response.data.0.url"
                  },
                  "then": "",
                  "else": "音频接口未返回 data[].url"
                }
              }
            ]
          },
          "resultEphemeral": true,
          "usage": {
            "$ref": "response.usage"
          }
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
