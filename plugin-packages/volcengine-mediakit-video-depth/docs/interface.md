# 深度动作捕捉接口

- Provider ID：`volcengine-mediakit-video-depth`；类型为 `processing`，能力为 `video`。
- 鉴权：MediaKit API Key，使用 Bearer Header。
- 创建：`POST /api/v1/tools/video-depth`，提交一个公开可读取的 `video_url`、固定 `model: standard` 和宿主任务的 `client_token` 幂等键。
- 查询：`GET /api/v1/tasks/{{taskId}}`，沿用异步任务生命周期；明确失败才作为失败，网络不确定状态不能重复提交。
- 结果：`result.video_url` 为有效期 24 小时的 HEVC 视频地址，统一资源链路负责持久化；`result.duration` 为输出秒数，映射到 `usage.outputDurationSeconds`。
- 输入最长 600 秒，分辨率不超过 2K；平台默认上限 60 秒。后端按资源记录核验归属、就绪状态、时长和尺寸，不信任客户端估计。
- 不发送提示词、输出分辨率、画幅、音频、水印或帧率字段。没有选用回调、外部输出目标或队列参数。
- 本地虚拟验证不代表真实服务、价格或 HEVC 浏览器播放已验收。

官方接口：[提交深度动作捕捉任务](https://docs.volcengine.com/docs/intelligent-processing/submit-deep-motion-capture-task-api?lang=zh)。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "volcengine-mediakit-video-depth",
  "name": "深度动作捕捉（火山 MediaKit）",
  "version": "1.0.0",
  "author": "KIVAO",
  "description": "将源视频转换为相对深度视频，供动作与空间参考使用。独立于画质增强协议。",
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "apiKey",
        "type": "secret",
        "label": "MediaKit API Key",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "volcengine-mediakit-video-depth",
        "label": "深度动作捕捉",
        "kind": "processing",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas"
        ],
        "baseUrl": "https://mediakit.cn-beijing.volces.com",
        "requiresPublicMediaUrls": true,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "videos",
            "type": "media[]",
            "required": true,
            "mapping": "video_url",
            "description": "一个源视频，最长 600 秒，分辨率不超过 2K。平台默认限制为 60 秒。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                1
              ]
            },
            "message": "深度动作捕捉需要且只接受一个源视频"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/api/v1/tools/video-depth",
          "contentType": "application/json",
          "body": {
            "video_url": {
              "$first": {
                "$map": {
                  "from": {
                    "$ref": "request.videos"
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            },
            "model": "standard",
            "client_token": {
              "$omitEmpty": {
                "$ref": "request.extra.idempotencyKey"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/api/v1/tasks/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.task_id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.status"
              },
              "pending"
            ]
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.error.message"
              },
              {
                "$ref": "response.error.code"
              }
            ]
          },
          "videos": {
            "$ref": "response.result.video_url"
          },
          "usage": {
            "$omitEmpty": {
              "outputDurationSeconds": {
                "$ref": "response.result.duration"
              }
            }
          },
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
