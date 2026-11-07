# 深度动作捕捉接口

- Provider ID：`volcengine-mediakit-video-depth`，`kind: processing`，能力 `video`。
- 使用 MediaKit API Key（配置字段 `apiKey`）；创建 `POST /api/v1/tools/video-depth`，查询 `GET /api/v1/tasks/{task_id}`。
- 请求只发送一个 `video_url`、固定 `model=standard` 及宿主任务幂等键 `client_token`，不发送画质增强的尺寸、帧率和码率参数。
- 结果 `result.video_url` 标记临时资源，宿主转存；`result.duration` 映射 `usage.outputDurationSeconds`，按实际输出时长结算。输出 HEVC；宿主原件为本地存储且安装 ffmpeg 时可生成 H.264 播放副本，OSS 原件不在现有转码范围内，需单独验收浏览器播放。
- 官方输入上限 600 秒及 2K；站点默认限制 60 秒，后台可调至 600 秒。本接入按短边不超过 1440、长边不超过 2560 做前置限制，最终格式兼容仍需真实接口验收。
- 官方公开处理价 0.1 CNY/分钟，即约 0.001666667 CNY/秒；按输出时长、毫秒精度计费。平台按秒订单沿用整秒向上取整预留和结算，成本统计也是整秒估算，与火山实际账单存在尾数差异。后台选择按秒、任意规格，深度模型不分帧率档；建议初始售价 0.005 CNY/秒。成本栏单位是积分/秒，按站点统一成本兑换率换算，不能直接填人民币单价。不自动创建渠道、写入密钥或更改售价。
- 参考：https://docs.volcengine.com/docs/intelligent-processing/deep-motion-capture?lang=zh

## 插件边界

### 响应映射

创建响应的 `task_id` 用于轮询，`success:false` 和 `error.code` 表示失败；轮询 `status=completed` 后提取 `result.video_url` 并转存，`result.duration` 写入 `usage.outputDurationSeconds`。错误响应不产生成功结果。

- 插件 ID 与协议 ID 均为 `volcengine-mediakit-video-depth`，可在后台独立启停，原画质增强插件的开关不控制本协议。
- 输入参数 `videos` 为一个源视频，无提示词或画质增强参数。
- 渠道中的 API Key 继续由后端使用，不复制密钥到插件包，既有模型的协议 ID 与价格配置不变。
- 旧合并版 `volcengine-mediakit` 1.1.0 与独立深度插件不能同时提供同一协议。应将原插件同步更新为仅含画质增强的 1.2.0，并安装本包；整套应用启动会从配套包重新加载。仅回退其中一个包会造成协议冲突，应成对回退。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下清单与包内 manifest 一致；documentation 正文省略以避免递归。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "volcengine-mediakit-video-depth",
  "name": "深度动作捕捉（火山 MediaKit）",
  "version": "1.0.0",
  "author": "Volcengine / 影策",
  "description": "火山 AI MediaKit 深度动作捕捉独立协议插件，与画质增强分别启停。",
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
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>",
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
            "description": "一个源视频；支持上限 600 秒及 2K，站点默认限制 60 秒。"
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
            "message": "深度动作捕捉需要且只能提交一个源视频"
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
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
