# 供应商直连接口与响应

配置项 `apiKey` 为渠道现有供应商密钥，由宿主按 Bearer 方式发送；插件不包含真实密钥。
创建、轮询、同源鉴权下载和外部视频直链分别由以下完整合同描述。所有网络操作仍由宿主
执行，并复用权限、出站保护、媒体保存和任务状态处理。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## 完整 Manifest 合同

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "kivao-kunrou-video",
  "name": "KIVAO 坤肉视频",
  "version": "1.2.0",
  "author": "KIVAO",
  "description": "坤肉供应商直连视频协议：Veo、Omni、Grok 和 SD。",
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "apiKey",
        "type": "secret",
        "label": "KIVAO New API Key",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "kivao-kunrou-video",
        "label": "KIVAO 坤肉视频 · 供应商直连",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://api.kunrouai.com",
        "requiresPublicMediaUrls": true,
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
            "description": "供应商模型 ID，不带 kivao/ 前缀。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "视频内容与运动描述。"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "seconds/duration",
            "description": "按型号校验整数秒。"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution/size",
            "description": "清晰度必须匹配所选型号。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "mapping": "aspect_ratio/ratio",
            "description": "按型号校验画面比例。"
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "input_reference/reference_images/image.url/images",
            "description": "Veo/Omni 按角色映射，Grok 单首帧，SD 公网图片 URL。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "mapping": "reference_videos",
            "description": "仅支持的 Veo/Omni 模式使用。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "mapping": "generate_audio",
            "description": "仅 Grok 提交独立音频开关，Google 原生声音由上游生成。"
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
                  "gemini-veo-3.1-fast",
                  "gemini-veo-3.1-lite",
                  "gemini-omni-1.1-flash",
                  "grok-imagine-video",
                  "grok-imagine-video-1.5",
                  "sd2.0-fast-480p",
                  "sd2.0-fast-720p",
                  "sd2.0-mini-480p",
                  "sd2.0-mini-720p"
                ]
              ]
            },
            "message": "请选择已配置的坤肉视频模型，不使用 kivao/ 前缀"
          },
          {
            "assert": {
              "$gt": [
                {
                  "$len": {
                    "$trim": {
                      "$ref": "request.prompt"
                    }
                  }
                },
                0
              ]
            },
            "message": "请填写视频提示词"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$in": [
                      {
                        "$ref": "request.model"
                      },
                      [
                        "gemini-veo-3.1-fast",
                        "gemini-veo-3.1-lite",
                        "gemini-omni-1.1-flash"
                      ]
                    ]
                  }
                },
                {
                  "$or": [
                    {
                      "$eq": [
                        {
                          "$coalesce": [
                            {
                              "$ref": "request.duration"
                            },
                            0
                          ]
                        },
                        0
                      ]
                    },
                    {
                      "$if": {
                        "condition": {
                          "$eq": [
                            {
                              "$ref": "request.model"
                            },
                            "gemini-omni-1.1-flash"
                          ]
                        },
                        "then": {
                          "$and": [
                            {
                              "$gte": [
                                {
                                  "$coalesce": [
                                    {
                                      "$ref": "request.duration"
                                    },
                                    0
                                  ]
                                },
                                3
                              ]
                            },
                            {
                              "$lte": [
                                {
                                  "$coalesce": [
                                    {
                                      "$ref": "request.duration"
                                    },
                                    0
                                  ]
                                },
                                10
                              ]
                            }
                          ]
                        },
                        "else": {
                          "$in": [
                            {
                              "$coalesce": [
                                {
                                  "$ref": "request.duration"
                                },
                                0
                              ]
                            },
                            [
                              4,
                              6,
                              8
                            ]
                          ]
                        }
                      }
                    }
                  ]
                }
              ]
            },
            "message": "Veo 支持 4/6/8 秒；Omni 1.1 支持 3–10 秒"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$in": [
                      {
                        "$ref": "request.model"
                      },
                      [
                        "gemini-veo-3.1-fast",
                        "gemini-veo-3.1-lite",
                        "gemini-omni-1.1-flash"
                      ]
                    ]
                  }
                },
                {
                  "$or": [
                    {
                      "$eq": [
                        {
                          "$coalesce": [
                            {
                              "$ref": "request.output.duration"
                            },
                            0
                          ]
                        },
                        0
                      ]
                    },
                    {
                      "$if": {
                        "condition": {
                          "$eq": [
                            {
                              "$ref": "request.model"
                            },
                            "gemini-omni-1.1-flash"
                          ]
                        },
                        "then": {
                          "$and": [
                            {
                              "$gte": [
                                {
                                  "$coalesce": [
                                    {
                                      "$ref": "request.output.duration"
                                    },
                                    0
                                  ]
                                },
                                3
                              ]
                            },
                            {
                              "$lte": [
                                {
                                  "$coalesce": [
                                    {
                                      "$ref": "request.output.duration"
                                    },
                                    0
                                  ]
                                },
                                10
                              ]
                            }
                          ]
                        },
                        "else": {
                          "$in": [
                            {
                              "$coalesce": [
                                {
                                  "$ref": "request.output.duration"
                                },
                                0
                              ]
                            },
                            [
                              4,
                              6,
                              8
                            ]
                          ]
                        }
                      }
                    }
                  ]
                }
              ]
            },
            "message": "Veo 支持 4/6/8 秒；Omni 1.1 支持 3–10 秒"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$in": [
                      {
                        "$ref": "request.model"
                      },
                      [
                        "gemini-veo-3.1-fast",
                        "gemini-veo-3.1-lite",
                        "gemini-omni-1.1-flash"
                      ]
                    ]
                  }
                },
                {
                  "$or": [
                    {
                      "$eq": [
                        {
                          "$lower": {
                            "$toString": {
                              "$ref": "request.resolution"
                            }
                          }
                        },
                        ""
                      ]
                    },
                    {
                      "$in": [
                        {
                          "$lower": {
                            "$toString": {
                              "$ref": "request.resolution"
                            }
                          }
                        },
                        {
                          "$if": {
                            "condition": {
                              "$eq": [
                                {
                                  "$ref": "request.model"
                                },
                                "gemini-omni-1.1-flash"
                              ]
                            },
                            "then": [
                              "360p",
                              "720p",
                              "1080p",
                              "4k"
                            ],
                            "else": {
                              "$if": {
                                "condition": {
                                  "$eq": [
                                    {
                                      "$ref": "request.model"
                                    },
                                    "gemini-veo-3.1-lite"
                                  ]
                                },
                                "then": [
                                  "720p",
                                  "1080p"
                                ],
                                "else": [
                                  "720p",
                                  "1080p",
                                  "4k"
                                ]
                              }
                            }
                          }
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "分辨率不符合当前 Google 型号：Lite 不支持 4K"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$in": [
                      {
                        "$ref": "request.model"
                      },
                      [
                        "gemini-veo-3.1-fast",
                        "gemini-veo-3.1-lite",
                        "gemini-omni-1.1-flash"
                      ]
                    ]
                  }
                },
                {
                  "$or": [
                    {
                      "$eq": [
                        {
                          "$lower": {
                            "$toString": {
                              "$ref": "request.output.resolution"
                            }
                          }
                        },
                        ""
                      ]
                    },
                    {
                      "$in": [
                        {
                          "$lower": {
                            "$toString": {
                              "$ref": "request.output.resolution"
                            }
                          }
                        },
                        {
                          "$if": {
                            "condition": {
                              "$eq": [
                                {
                                  "$ref": "request.model"
                                },
                                "gemini-omni-1.1-flash"
                              ]
                            },
                            "then": [
                              "360p",
                              "720p",
                              "1080p",
                              "4k"
                            ],
                            "else": {
                              "$if": {
                                "condition": {
                                  "$eq": [
                                    {
                                      "$ref": "request.model"
                                    },
                                    "gemini-veo-3.1-lite"
                                  ]
                                },
                                "then": [
                                  "720p",
                                  "1080p"
                                ],
                                "else": [
                                  "720p",
                                  "1080p",
                                  "4k"
                                ]
                              }
                            }
                          }
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "分辨率不符合当前 Google 型号：Lite 不支持 4K"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$in": [
                      {
                        "$ref": "request.model"
                      },
                      [
                        "gemini-veo-3.1-fast",
                        "gemini-veo-3.1-lite",
                        "gemini-omni-1.1-flash"
                      ]
                    ]
                  }
                },
                {
                  "$in": [
                    {
                      "$toString": {
                        "$ref": "request.aspectRatio"
                      }
                    },
                    [
                      "",
                      "16:9",
                      "9:16"
                    ]
                  ]
                }
              ]
            },
            "message": "Google 视频模型支持 16:9 或 9:16"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$in": [
                      {
                        "$ref": "request.model"
                      },
                      [
                        "gemini-veo-3.1-fast",
                        "gemini-veo-3.1-lite",
                        "gemini-omni-1.1-flash"
                      ]
                    ]
                  }
                },
                {
                  "$in": [
                    {
                      "$toString": {
                        "$ref": "request.output.aspectRatio"
                      }
                    },
                    [
                      "",
                      "16:9",
                      "9:16"
                    ]
                  ]
                }
              ]
            },
            "message": "Google 视频模型支持 16:9 或 9:16"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$in": [
                      {
                        "$ref": "request.model"
                      },
                      [
                        "gemini-veo-3.1-fast",
                        "gemini-veo-3.1-lite",
                        "gemini-omni-1.1-flash"
                      ]
                    ]
                  }
                },
                {
                  "$or": [
                    {
                      "$eq": [
                        {
                          "$ref": "request.model"
                        },
                        "gemini-omni-1.1-flash"
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$lower": {
                            "$coalesce": [
                              {
                                "$ref": "request.output.resolution"
                              },
                              "720p"
                            ]
                          }
                        },
                        "720p"
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$if": {
                            "condition": {
                              "$gt": [
                                {
                                  "$coalesce": [
                                    {
                                      "$ref": "request.output.duration"
                                    },
                                    0
                                  ]
                                },
                                0
                              ]
                            },
                            "then": {
                              "$ref": "request.output.duration"
                            },
                            "else": 8
                          }
                        },
                        8
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "Veo 1080p/4K 需要 8 秒"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$in": [
                      {
                        "$ref": "request.model"
                      },
                      [
                        "gemini-veo-3.1-fast",
                        "gemini-veo-3.1-lite",
                        "gemini-omni-1.1-flash"
                      ]
                    ]
                  }
                },
                {
                  "$eq": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$ref": "request.images"
                          },
                          "as": "media",
                          "where": {
                            "$not": {
                              "$in": [
                                {
                                  "$ref": "media.role"
                                },
                                [
                                  "",
                                  "first_frame",
                                  "last_frame",
                                  "reference",
                                  "reference_image"
                                ]
                              ]
                            }
                          }
                        }
                      }
                    },
                    0
                  ]
                }
              ]
            },
            "message": "不支持该图片角色"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$in": [
                      {
                        "$ref": "request.model"
                      },
                      [
                        "gemini-veo-3.1-fast",
                        "gemini-veo-3.1-lite",
                        "gemini-omni-1.1-flash"
                      ]
                    ]
                  }
                },
                {
                  "$and": [
                    {
                      "$lte": [
                        {
                          "$len": {
                            "$filter": {
                              "from": {
                                "$ref": "request.images"
                              },
                              "as": "media",
                              "where": {
                                "$or": [
                                  {
                                    "$eq": [
                                      {
                                        "$ref": "media.role"
                                      },
                                      "first_frame"
                                    ]
                                  },
                                  {
                                    "$and": [
                                      {
                                        "$and": [
                                          {
                                            "$eq": [
                                              {
                                                "$len": {
                                                  "$ref": "request.images"
                                                }
                                              },
                                              1
                                            ]
                                          },
                                          {
                                            "$in": [
                                              {
                                                "$ref": "request.images.0.role"
                                              },
                                              [
                                                "",
                                                "first_frame"
                                              ]
                                            ]
                                          }
                                        ]
                                      },
                                      {
                                        "$eq": [
                                          {
                                            "$ref": "media.role"
                                          },
                                          ""
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            }
                          }
                        },
                        1
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$len": {
                            "$filter": {
                              "from": {
                                "$ref": "request.images"
                              },
                              "as": "media",
                              "where": {
                                "$eq": [
                                  {
                                    "$ref": "media.role"
                                  },
                                  "last_frame"
                                ]
                              }
                            }
                          }
                        },
                        1
                      ]
                    },
                    {
                      "$or": [
                        {
                          "$eq": [
                            {
                              "$len": {
                                "$filter": {
                                  "from": {
                                    "$ref": "request.images"
                                  },
                                  "as": "media",
                                  "where": {
                                    "$eq": [
                                      {
                                        "$ref": "media.role"
                                      },
                                      "last_frame"
                                    ]
                                  }
                                }
                              }
                            },
                            0
                          ]
                        },
                        {
                          "$eq": [
                            {
                              "$len": {
                                "$filter": {
                                  "from": {
                                    "$ref": "request.images"
                                  },
                                  "as": "media",
                                  "where": {
                                    "$or": [
                                      {
                                        "$eq": [
                                          {
                                            "$ref": "media.role"
                                          },
                                          "first_frame"
                                        ]
                                      },
                                      {
                                        "$and": [
                                          {
                                            "$and": [
                                              {
                                                "$eq": [
                                                  {
                                                    "$len": {
                                                      "$ref": "request.images"
                                                    }
                                                  },
                                                  1
                                                ]
                                              },
                                              {
                                                "$in": [
                                                  {
                                                    "$ref": "request.images.0.role"
                                                  },
                                                  [
                                                    "",
                                                    "first_frame"
                                                  ]
                                                ]
                                              }
                                            ]
                                          },
                                          {
                                            "$eq": [
                                              {
                                                "$ref": "media.role"
                                              },
                                              ""
                                            ]
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                }
                              }
                            },
                            1
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "最多一张首帧和一张尾帧；尾帧必须搭配首帧"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$in": [
                      {
                        "$ref": "request.model"
                      },
                      [
                        "gemini-veo-3.1-fast",
                        "gemini-veo-3.1-lite",
                        "gemini-omni-1.1-flash"
                      ]
                    ]
                  }
                },
                {
                  "$or": [
                    {
                      "$eq": [
                        {
                          "$len": {
                            "$filter": {
                              "from": {
                                "$ref": "request.images"
                              },
                              "as": "media",
                              "where": {
                                "$and": [
                                  {
                                    "$not": {
                                      "$and": [
                                        {
                                          "$eq": [
                                            {
                                              "$len": {
                                                "$ref": "request.images"
                                              }
                                            },
                                            1
                                          ]
                                        },
                                        {
                                          "$in": [
                                            {
                                              "$ref": "request.images.0.role"
                                            },
                                            [
                                              "",
                                              "first_frame"
                                            ]
                                          ]
                                        }
                                      ]
                                    }
                                  },
                                  {
                                    "$not": {
                                      "$in": [
                                        {
                                          "$ref": "media.role"
                                        },
                                        [
                                          "first_frame",
                                          "last_frame"
                                        ]
                                      ]
                                    }
                                  }
                                ]
                              }
                            }
                          }
                        },
                        0
                      ]
                    },
                    {
                      "$and": [
                        {
                          "$eq": [
                            {
                              "$len": {
                                "$filter": {
                                  "from": {
                                    "$ref": "request.images"
                                  },
                                  "as": "media",
                                  "where": {
                                    "$or": [
                                      {
                                        "$eq": [
                                          {
                                            "$ref": "media.role"
                                          },
                                          "first_frame"
                                        ]
                                      },
                                      {
                                        "$and": [
                                          {
                                            "$and": [
                                              {
                                                "$eq": [
                                                  {
                                                    "$len": {
                                                      "$ref": "request.images"
                                                    }
                                                  },
                                                  1
                                                ]
                                              },
                                              {
                                                "$in": [
                                                  {
                                                    "$ref": "request.images.0.role"
                                                  },
                                                  [
                                                    "",
                                                    "first_frame"
                                                  ]
                                                ]
                                              }
                                            ]
                                          },
                                          {
                                            "$eq": [
                                              {
                                                "$ref": "media.role"
                                              },
                                              ""
                                            ]
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                }
                              }
                            },
                            0
                          ]
                        },
                        {
                          "$eq": [
                            {
                              "$len": {
                                "$filter": {
                                  "from": {
                                    "$ref": "request.images"
                                  },
                                  "as": "media",
                                  "where": {
                                    "$eq": [
                                      {
                                        "$ref": "media.role"
                                      },
                                      "last_frame"
                                    ]
                                  }
                                }
                              }
                            },
                            0
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "坤肉接口要求首尾帧与普通参考图分开使用"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$in": [
                      {
                        "$ref": "request.model"
                      },
                      [
                        "gemini-veo-3.1-fast",
                        "gemini-veo-3.1-lite",
                        "gemini-omni-1.1-flash"
                      ]
                    ]
                  }
                },
                {
                  "$or": [
                    {
                      "$eq": [
                        {
                          "$ref": "request.model"
                        },
                        "gemini-omni-1.1-flash"
                      ]
                    },
                    {
                      "$if": {
                        "condition": {
                          "$eq": [
                            {
                              "$ref": "request.model"
                            },
                            "gemini-veo-3.1-lite"
                          ]
                        },
                        "then": {
                          "$eq": [
                            {
                              "$len": {
                                "$filter": {
                                  "from": {
                                    "$ref": "request.images"
                                  },
                                  "as": "media",
                                  "where": {
                                    "$and": [
                                      {
                                        "$not": {
                                          "$and": [
                                            {
                                              "$eq": [
                                                {
                                                  "$len": {
                                                    "$ref": "request.images"
                                                  }
                                                },
                                                1
                                              ]
                                            },
                                            {
                                              "$in": [
                                                {
                                                  "$ref": "request.images.0.role"
                                                },
                                                [
                                                  "",
                                                  "first_frame"
                                                ]
                                              ]
                                            }
                                          ]
                                        }
                                      },
                                      {
                                        "$not": {
                                          "$in": [
                                            {
                                              "$ref": "media.role"
                                            },
                                            [
                                              "first_frame",
                                              "last_frame"
                                            ]
                                          ]
                                        }
                                      }
                                    ]
                                  }
                                }
                              }
                            },
                            0
                          ]
                        },
                        "else": {
                          "$lte": [
                            {
                              "$len": {
                                "$filter": {
                                  "from": {
                                    "$ref": "request.images"
                                  },
                                  "as": "media",
                                  "where": {
                                    "$and": [
                                      {
                                        "$not": {
                                          "$and": [
                                            {
                                              "$eq": [
                                                {
                                                  "$len": {
                                                    "$ref": "request.images"
                                                  }
                                                },
                                                1
                                              ]
                                            },
                                            {
                                              "$in": [
                                                {
                                                  "$ref": "request.images.0.role"
                                                },
                                                [
                                                  "",
                                                  "first_frame"
                                                ]
                                              ]
                                            }
                                          ]
                                        }
                                      },
                                      {
                                        "$not": {
                                          "$in": [
                                            {
                                              "$ref": "media.role"
                                            },
                                            [
                                              "first_frame",
                                              "last_frame"
                                            ]
                                          ]
                                        }
                                      }
                                    ]
                                  }
                                }
                              }
                            },
                            3
                          ]
                        }
                      }
                    }
                  ]
                }
              ]
            },
            "message": "Veo Lite 不支持普通参考图；Veo Fast 最多三张"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$in": [
                      {
                        "$ref": "request.model"
                      },
                      [
                        "gemini-veo-3.1-fast",
                        "gemini-veo-3.1-lite",
                        "gemini-omni-1.1-flash"
                      ]
                    ]
                  }
                },
                {
                  "$or": [
                    {
                      "$eq": [
                        {
                          "$ref": "request.model"
                        },
                        "gemini-omni-1.1-flash"
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$len": {
                            "$filter": {
                              "from": {
                                "$ref": "request.images"
                              },
                              "as": "media",
                              "where": {
                                "$and": [
                                  {
                                    "$not": {
                                      "$and": [
                                        {
                                          "$eq": [
                                            {
                                              "$len": {
                                                "$ref": "request.images"
                                              }
                                            },
                                            1
                                          ]
                                        },
                                        {
                                          "$in": [
                                            {
                                              "$ref": "request.images.0.role"
                                            },
                                            [
                                              "",
                                              "first_frame"
                                            ]
                                          ]
                                        }
                                      ]
                                    }
                                  },
                                  {
                                    "$not": {
                                      "$in": [
                                        {
                                          "$ref": "media.role"
                                        },
                                        [
                                          "first_frame",
                                          "last_frame"
                                        ]
                                      ]
                                    }
                                  }
                                ]
                              }
                            }
                          }
                        },
                        0
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$if": {
                            "condition": {
                              "$gt": [
                                {
                                  "$coalesce": [
                                    {
                                      "$ref": "request.output.duration"
                                    },
                                    0
                                  ]
                                },
                                0
                              ]
                            },
                            "then": {
                              "$ref": "request.output.duration"
                            },
                            "else": 8
                          }
                        },
                        8
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "Veo 参考图需要 8 秒"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$in": [
                      {
                        "$ref": "request.model"
                      },
                      [
                        "gemini-veo-3.1-fast",
                        "gemini-veo-3.1-lite",
                        "gemini-omni-1.1-flash"
                      ]
                    ]
                  }
                },
                {
                  "$eq": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$ref": "request.images"
                          },
                          "as": "media",
                          "where": {
                            "$or": [
                              {
                                "$eq": [
                                  {
                                    "$len": {
                                      "$coalesce": [
                                        {
                                          "$ref": "media.dataUrl"
                                        },
                                        {
                                          "$ref": "media.url"
                                        },
                                        ""
                                      ]
                                    }
                                  },
                                  0
                                ]
                              },
                              {
                                "$and": [
                                  {
                                    "$not": {
                                      "$eq": [
                                        {
                                          "$ref": "request.model"
                                        },
                                        "gemini-omni-1.1-flash"
                                      ]
                                    }
                                  },
                                  {
                                    "$ne": [
                                      {
                                        "$toString": {
                                          "$ref": "media.dataUrl"
                                        }
                                      },
                                      ""
                                    ]
                                  },
                                  {
                                    "$not": {
                                      "$in": [
                                        {
                                          "$dataMime": {
                                            "$ref": "media.dataUrl"
                                          }
                                        },
                                        [
                                          "image/png",
                                          "image/jpeg"
                                        ]
                                      ]
                                    }
                                  }
                                ]
                              }
                            ]
                          }
                        }
                      }
                    },
                    0
                  ]
                }
              ]
            },
            "message": "图片不能为空；Veo 图片格式为 PNG 或 JPEG"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$in": [
                      {
                        "$ref": "request.model"
                      },
                      [
                        "gemini-veo-3.1-fast",
                        "gemini-veo-3.1-lite",
                        "gemini-omni-1.1-flash"
                      ]
                    ]
                  }
                },
                {
                  "$lte": [
                    {
                      "$len": {
                        "$ref": "request.videos"
                      }
                    },
                    {
                      "$if": {
                        "condition": {
                          "$eq": [
                            {
                              "$ref": "request.model"
                            },
                            "gemini-omni-1.1-flash"
                          ]
                        },
                        "then": 3,
                        "else": {
                          "$if": {
                            "condition": {
                              "$eq": [
                                {
                                  "$ref": "request.model"
                                },
                                "gemini-veo-3.1-lite"
                              ]
                            },
                            "then": 0,
                            "else": 1
                          }
                        }
                      }
                    }
                  ]
                }
              ]
            },
            "message": "视频数量不符合型号能力；Lite 不支持视频输入"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$in": [
                      {
                        "$ref": "request.model"
                      },
                      [
                        "gemini-veo-3.1-fast",
                        "gemini-veo-3.1-lite",
                        "gemini-omni-1.1-flash"
                      ]
                    ]
                  }
                },
                {
                  "$or": [
                    {
                      "$eq": [
                        {
                          "$ref": "request.model"
                        },
                        "gemini-omni-1.1-flash"
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$len": {
                            "$ref": "request.videos"
                          }
                        },
                        0
                      ]
                    },
                    {
                      "$and": [
                        {
                          "$eq": [
                            {
                              "$if": {
                                "condition": {
                                  "$gt": [
                                    {
                                      "$coalesce": [
                                        {
                                          "$ref": "request.output.duration"
                                        },
                                        0
                                      ]
                                    },
                                    0
                                  ]
                                },
                                "then": {
                                  "$ref": "request.output.duration"
                                },
                                "else": 8
                              }
                            },
                            8
                          ]
                        },
                        {
                          "$eq": [
                            {
                              "$lower": {
                                "$coalesce": [
                                  {
                                    "$ref": "request.output.resolution"
                                  },
                                  "720p"
                                ]
                              }
                            },
                            "720p"
                          ]
                        },
                        {
                          "$eq": [
                            {
                              "$len": {
                                "$ref": "request.images"
                              }
                            },
                            0
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "Veo 延长视频需原 Veo 视频、8 秒、720p，不同时提交图片"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.audios"
                  }
                },
                0
              ]
            },
            "message": "这些 Google 视频模型不支持上传音频；原生声音通过提示词描述"
          },
          {
            "assert": {
              "$and": [
                {
                  "$eq": [
                    {
                      "$ref": "request.watermark"
                    },
                    false
                  ]
                },
                {
                  "$ne": [
                    {
                      "$ref": "request.output.watermark"
                    },
                    true
                  ]
                }
              ]
            },
            "message": "不支持额外水印开关"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.providerOptions"
                  }
                },
                0
              ]
            },
            "message": "此转接接口尚未映射额外厂商参数"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$not": {
                      "$in": [
                        {
                          "$ref": "request.model"
                        },
                        [
                          "gemini-veo-3.1-fast",
                          "gemini-veo-3.1-lite",
                          "gemini-omni-1.1-flash"
                        ]
                      ]
                    }
                  }
                },
                {
                  "$or": [
                    {
                      "$eq": [
                        {
                          "$coalesce": [
                            {
                              "$ref": "request.duration"
                            },
                            0
                          ]
                        },
                        0
                      ]
                    },
                    {
                      "$in": [
                        {
                          "$coalesce": [
                            {
                              "$ref": "request.duration"
                            },
                            0
                          ]
                        },
                        {
                          "$if": {
                            "condition": {
                              "$in": [
                                {
                                  "$ref": "request.model"
                                },
                                [
                                  "sd2.0-fast-480p",
                                  "sd2.0-fast-720p",
                                  "sd2.0-mini-480p",
                                  "sd2.0-mini-720p"
                                ]
                              ]
                            },
                            "then": [
                              4,
                              5,
                              6,
                              7,
                              8,
                              9,
                              10,
                              11,
                              12,
                              13,
                              14,
                              15
                            ],
                            "else": [
                              1,
                              2,
                              3,
                              4,
                              5,
                              6,
                              7,
                              8,
                              9,
                              10,
                              11,
                              12,
                              13,
                              14,
                              15
                            ]
                          }
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "SD 时长为 4–15 整数秒，Grok 为 1–15 整数秒"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$not": {
                      "$in": [
                        {
                          "$ref": "request.model"
                        },
                        [
                          "gemini-veo-3.1-fast",
                          "gemini-veo-3.1-lite",
                          "gemini-omni-1.1-flash"
                        ]
                      ]
                    }
                  }
                },
                {
                  "$or": [
                    {
                      "$eq": [
                        {
                          "$coalesce": [
                            {
                              "$ref": "request.output.duration"
                            },
                            0
                          ]
                        },
                        0
                      ]
                    },
                    {
                      "$in": [
                        {
                          "$coalesce": [
                            {
                              "$ref": "request.output.duration"
                            },
                            0
                          ]
                        },
                        {
                          "$if": {
                            "condition": {
                              "$in": [
                                {
                                  "$ref": "request.model"
                                },
                                [
                                  "sd2.0-fast-480p",
                                  "sd2.0-fast-720p",
                                  "sd2.0-mini-480p",
                                  "sd2.0-mini-720p"
                                ]
                              ]
                            },
                            "then": [
                              4,
                              5,
                              6,
                              7,
                              8,
                              9,
                              10,
                              11,
                              12,
                              13,
                              14,
                              15
                            ],
                            "else": [
                              1,
                              2,
                              3,
                              4,
                              5,
                              6,
                              7,
                              8,
                              9,
                              10,
                              11,
                              12,
                              13,
                              14,
                              15
                            ]
                          }
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "SD 时长为 4–15 整数秒，Grok 为 1–15 整数秒"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$not": {
                      "$in": [
                        {
                          "$ref": "request.model"
                        },
                        [
                          "gemini-veo-3.1-fast",
                          "gemini-veo-3.1-lite",
                          "gemini-omni-1.1-flash"
                        ]
                      ]
                    }
                  }
                },
                {
                  "$or": [
                    {
                      "$eq": [
                        {
                          "$lower": {
                            "$toString": {
                              "$ref": "request.resolution"
                            }
                          }
                        },
                        ""
                      ]
                    },
                    {
                      "$in": [
                        {
                          "$lower": {
                            "$toString": {
                              "$ref": "request.resolution"
                            }
                          }
                        },
                        {
                          "$if": {
                            "condition": {
                              "$in": [
                                {
                                  "$ref": "request.model"
                                },
                                [
                                  "sd2.0-fast-480p",
                                  "sd2.0-fast-720p",
                                  "sd2.0-mini-480p",
                                  "sd2.0-mini-720p"
                                ]
                              ]
                            },
                            "then": [
                              {
                                "$if": {
                                  "condition": {
                                    "$in": [
                                      {
                                        "$ref": "request.model"
                                      },
                                      [
                                        "sd2.0-fast-720p",
                                        "sd2.0-mini-720p"
                                      ]
                                    ]
                                  },
                                  "then": "720p",
                                  "else": "480p"
                                }
                              }
                            ],
                            "else": {
                              "$if": {
                                "condition": {
                                  "$eq": [
                                    {
                                      "$ref": "request.model"
                                    },
                                    "grok-imagine-video-1.5"
                                  ]
                                },
                                "then": [
                                  "480p",
                                  "720p",
                                  "1080p"
                                ],
                                "else": [
                                  "480p",
                                  "720p"
                                ]
                              }
                            }
                          }
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "清晰度必须匹配所选 SD 或 Grok 型号"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$not": {
                      "$in": [
                        {
                          "$ref": "request.model"
                        },
                        [
                          "gemini-veo-3.1-fast",
                          "gemini-veo-3.1-lite",
                          "gemini-omni-1.1-flash"
                        ]
                      ]
                    }
                  }
                },
                {
                  "$or": [
                    {
                      "$eq": [
                        {
                          "$lower": {
                            "$toString": {
                              "$ref": "request.output.resolution"
                            }
                          }
                        },
                        ""
                      ]
                    },
                    {
                      "$in": [
                        {
                          "$lower": {
                            "$toString": {
                              "$ref": "request.output.resolution"
                            }
                          }
                        },
                        {
                          "$if": {
                            "condition": {
                              "$in": [
                                {
                                  "$ref": "request.model"
                                },
                                [
                                  "sd2.0-fast-480p",
                                  "sd2.0-fast-720p",
                                  "sd2.0-mini-480p",
                                  "sd2.0-mini-720p"
                                ]
                              ]
                            },
                            "then": [
                              {
                                "$if": {
                                  "condition": {
                                    "$in": [
                                      {
                                        "$ref": "request.model"
                                      },
                                      [
                                        "sd2.0-fast-720p",
                                        "sd2.0-mini-720p"
                                      ]
                                    ]
                                  },
                                  "then": "720p",
                                  "else": "480p"
                                }
                              }
                            ],
                            "else": {
                              "$if": {
                                "condition": {
                                  "$eq": [
                                    {
                                      "$ref": "request.model"
                                    },
                                    "grok-imagine-video-1.5"
                                  ]
                                },
                                "then": [
                                  "480p",
                                  "720p",
                                  "1080p"
                                ],
                                "else": [
                                  "480p",
                                  "720p"
                                ]
                              }
                            }
                          }
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "清晰度必须匹配所选 SD 或 Grok 型号"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$not": {
                      "$in": [
                        {
                          "$ref": "request.model"
                        },
                        [
                          "gemini-veo-3.1-fast",
                          "gemini-veo-3.1-lite",
                          "gemini-omni-1.1-flash"
                        ]
                      ]
                    }
                  }
                },
                {
                  "$in": [
                    {
                      "$toString": {
                        "$ref": "request.aspectRatio"
                      }
                    },
                    {
                      "$if": {
                        "condition": {
                          "$in": [
                            {
                              "$ref": "request.model"
                            },
                            [
                              "sd2.0-fast-480p",
                              "sd2.0-fast-720p",
                              "sd2.0-mini-480p",
                              "sd2.0-mini-720p"
                            ]
                          ]
                        },
                        "then": [
                          "",
                          "16:9",
                          "9:16",
                          "1:1",
                          "4:3",
                          "3:4",
                          "21:9",
                          "adaptive"
                        ],
                        "else": [
                          "",
                          "16:9",
                          "9:16",
                          "1:1",
                          "4:3",
                          "3:4",
                          "3:2",
                          "2:3"
                        ]
                      }
                    }
                  ]
                }
              ]
            },
            "message": "该模型不支持此画面比例"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$not": {
                      "$in": [
                        {
                          "$ref": "request.model"
                        },
                        [
                          "gemini-veo-3.1-fast",
                          "gemini-veo-3.1-lite",
                          "gemini-omni-1.1-flash"
                        ]
                      ]
                    }
                  }
                },
                {
                  "$in": [
                    {
                      "$toString": {
                        "$ref": "request.output.aspectRatio"
                      }
                    },
                    {
                      "$if": {
                        "condition": {
                          "$in": [
                            {
                              "$ref": "request.model"
                            },
                            [
                              "sd2.0-fast-480p",
                              "sd2.0-fast-720p",
                              "sd2.0-mini-480p",
                              "sd2.0-mini-720p"
                            ]
                          ]
                        },
                        "then": [
                          "",
                          "16:9",
                          "9:16",
                          "1:1",
                          "4:3",
                          "3:4",
                          "21:9",
                          "adaptive"
                        ],
                        "else": [
                          "",
                          "16:9",
                          "9:16",
                          "1:1",
                          "4:3",
                          "3:4",
                          "3:2",
                          "2:3"
                        ]
                      }
                    }
                  ]
                }
              ]
            },
            "message": "该模型不支持此画面比例"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$not": {
                      "$in": [
                        {
                          "$ref": "request.model"
                        },
                        [
                          "gemini-veo-3.1-fast",
                          "gemini-veo-3.1-lite",
                          "gemini-omni-1.1-flash"
                        ]
                      ]
                    }
                  }
                },
                {
                  "$eq": [
                    {
                      "$len": {
                        "$ref": "request.videos"
                      }
                    },
                    0
                  ]
                }
              ]
            },
            "message": "Grok/SD 当前不支持参考视频"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$in": [
                      {
                        "$ref": "request.model"
                      },
                      [
                        "grok-imagine-video",
                        "grok-imagine-video-1.5"
                      ]
                    ]
                  }
                },
                {
                  "$lte": [
                    {
                      "$len": {
                        "$ref": "request.images"
                      }
                    },
                    1
                  ]
                }
              ]
            },
            "message": "Grok 仅支持一张首帧图片"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$in": [
                      {
                        "$ref": "request.model"
                      },
                      [
                        "grok-imagine-video",
                        "grok-imagine-video-1.5"
                      ]
                    ]
                  }
                },
                {
                  "$or": [
                    {
                      "$eq": [
                        {
                          "$len": {
                            "$ref": "request.images"
                          }
                        },
                        0
                      ]
                    },
                    {
                      "$in": [
                        {
                          "$ref": "request.images.0.role"
                        },
                        [
                          "",
                          "first_frame",
                          "reference",
                          "reference_image"
                        ]
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "Grok 图片作为首帧，不支持尾帧或蒙版"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$in": [
                      {
                        "$ref": "request.model"
                      },
                      [
                        "sd2.0-fast-480p",
                        "sd2.0-fast-720p",
                        "sd2.0-mini-480p",
                        "sd2.0-mini-720p"
                      ]
                    ]
                  }
                },
                {
                  "$eq": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$ref": "request.images"
                          },
                          "as": "media",
                          "where": {
                            "$or": [
                              {
                                "$not": {
                                  "$in": [
                                    {
                                      "$first": {
                                        "$split": [
                                          {
                                            "$toString": {
                                              "$ref": "media.url"
                                            }
                                          },
                                          ":"
                                        ]
                                      }
                                    },
                                    [
                                      "http",
                                      "https"
                                    ]
                                  ]
                                }
                              },
                              {
                                "$not": {
                                  "$in": [
                                    {
                                      "$ref": "media.role"
                                    },
                                    [
                                      "",
                                      "first_frame",
                                      "reference",
                                      "reference_image"
                                    ]
                                  ]
                                }
                              }
                            ]
                          }
                        }
                      }
                    },
                    0
                  ]
                }
              ]
            },
            "message": "SD 参考图片需要可访问的 HTTP(S) URL，不支持尾帧或蒙版"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$in": [
                      {
                        "$ref": "request.model"
                      },
                      [
                        "grok-imagine-video",
                        "grok-imagine-video-1.5"
                      ]
                    ]
                  }
                },
                {
                  "$or": [
                    {
                      "$eq": [
                        {
                          "$len": {
                            "$ref": "request.images"
                          }
                        },
                        0
                      ]
                    },
                    {
                      "$gt": [
                        {
                          "$len": {
                            "$coalesce": [
                              {
                                "$ref": "request.images.0.url"
                              },
                              {
                                "$ref": "request.images.0.dataUrl"
                              }
                            ]
                          }
                        },
                        0
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "首帧图片不能为空"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos",
          "pathTemplate": {
            "$if": {
              "condition": {
                "$in": [
                  {
                    "$ref": "request.model"
                  },
                  [
                    "sd2.0-fast-480p",
                    "sd2.0-fast-720p",
                    "sd2.0-mini-480p",
                    "sd2.0-mini-720p"
                  ]
                ]
              },
              "then": "/v1/tasks/sora",
              "else": "/v1/videos"
            }
          },
          "contentType": "application/json",
          "body": {
            "$if": {
              "condition": {
                "$in": [
                  {
                    "$ref": "request.model"
                  },
                  [
                    "gemini-veo-3.1-fast",
                    "gemini-veo-3.1-lite",
                    "gemini-omni-1.1-flash"
                  ]
                ]
              },
              "then": {
                "model": {
                  "$ref": "request.model"
                },
                "prompt": {
                  "$trim": {
                    "$ref": "request.prompt"
                  }
                },
                "seconds": {
                  "$toString": {
                    "$if": {
                      "condition": {
                        "$gt": [
                          {
                            "$coalesce": [
                              {
                                "$ref": "request.output.duration"
                              },
                              0
                            ]
                          },
                          0
                        ]
                      },
                      "then": {
                        "$ref": "request.output.duration"
                      },
                      "else": 8
                    }
                  }
                },
                "resolution": {
                  "$if": {
                    "condition": {
                      "$and": [
                        {
                          "$and": [
                            {
                              "$eq": [
                                {
                                  "$len": {
                                    "$ref": "request.images"
                                  }
                                },
                                1
                              ]
                            },
                            {
                              "$in": [
                                {
                                  "$ref": "request.images.0.role"
                                },
                                [
                                  "",
                                  "first_frame"
                                ]
                              ]
                            }
                          ]
                        },
                        {
                          "$eq": [
                            {
                              "$if": {
                                "condition": {
                                  "$gt": [
                                    {
                                      "$coalesce": [
                                        {
                                          "$ref": "request.output.duration"
                                        },
                                        0
                                      ]
                                    },
                                    0
                                  ]
                                },
                                "then": {
                                  "$ref": "request.output.duration"
                                },
                                "else": 8
                              }
                            },
                            8
                          ]
                        },
                        {
                          "$eq": [
                            {
                              "$lower": {
                                "$coalesce": [
                                  {
                                    "$ref": "request.output.resolution"
                                  },
                                  {
                                    "$ref": "request.resolution"
                                  },
                                  {
                                    "$if": {
                                      "condition": {
                                        "$in": [
                                          {
                                            "$ref": "request.model"
                                          },
                                          [
                                            "gemini-veo-3.1-fast",
                                            "gemini-veo-3.1-lite",
                                            "gemini-omni-1.1-flash"
                                          ]
                                        ]
                                      },
                                      "then": "720p",
                                      "else": {
                                        "$if": {
                                          "condition": {
                                            "$in": [
                                              {
                                                "$ref": "request.model"
                                              },
                                              [
                                                "sd2.0-fast-480p",
                                                "sd2.0-fast-720p",
                                                "sd2.0-mini-480p",
                                                "sd2.0-mini-720p"
                                              ]
                                            ]
                                          },
                                          "then": {
                                            "$if": {
                                              "condition": {
                                                "$in": [
                                                  {
                                                    "$ref": "request.model"
                                                  },
                                                  [
                                                    "sd2.0-fast-720p",
                                                    "sd2.0-mini-720p"
                                                  ]
                                                ]
                                              },
                                              "then": "720p",
                                              "else": "480p"
                                            }
                                          },
                                          "else": "480p"
                                        }
                                      }
                                    }
                                  }
                                ]
                              }
                            },
                            "720p"
                          ]
                        },
                        {
                          "$eq": [
                            {
                              "$coalesce": [
                                {
                                  "$ref": "request.output.aspectRatio"
                                },
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "16:9"
                              ]
                            },
                            "16:9"
                          ]
                        }
                      ]
                    },
                    "then": null,
                    "else": {
                      "$lower": {
                        "$coalesce": [
                          {
                            "$ref": "request.output.resolution"
                          },
                          {
                            "$ref": "request.resolution"
                          },
                          {
                            "$if": {
                              "condition": {
                                "$in": [
                                  {
                                    "$ref": "request.model"
                                  },
                                  [
                                    "gemini-veo-3.1-fast",
                                    "gemini-veo-3.1-lite",
                                    "gemini-omni-1.1-flash"
                                  ]
                                ]
                              },
                              "then": "720p",
                              "else": {
                                "$if": {
                                  "condition": {
                                    "$in": [
                                      {
                                        "$ref": "request.model"
                                      },
                                      [
                                        "sd2.0-fast-480p",
                                        "sd2.0-fast-720p",
                                        "sd2.0-mini-480p",
                                        "sd2.0-mini-720p"
                                      ]
                                    ]
                                  },
                                  "then": {
                                    "$if": {
                                      "condition": {
                                        "$in": [
                                          {
                                            "$ref": "request.model"
                                          },
                                          [
                                            "sd2.0-fast-720p",
                                            "sd2.0-mini-720p"
                                          ]
                                        ]
                                      },
                                      "then": "720p",
                                      "else": "480p"
                                    }
                                  },
                                  "else": "480p"
                                }
                              }
                            }
                          }
                        ]
                      }
                    }
                  }
                },
                "aspect_ratio": {
                  "$if": {
                    "condition": {
                      "$and": [
                        {
                          "$and": [
                            {
                              "$eq": [
                                {
                                  "$len": {
                                    "$ref": "request.images"
                                  }
                                },
                                1
                              ]
                            },
                            {
                              "$in": [
                                {
                                  "$ref": "request.images.0.role"
                                },
                                [
                                  "",
                                  "first_frame"
                                ]
                              ]
                            }
                          ]
                        },
                        {
                          "$eq": [
                            {
                              "$if": {
                                "condition": {
                                  "$gt": [
                                    {
                                      "$coalesce": [
                                        {
                                          "$ref": "request.output.duration"
                                        },
                                        0
                                      ]
                                    },
                                    0
                                  ]
                                },
                                "then": {
                                  "$ref": "request.output.duration"
                                },
                                "else": 8
                              }
                            },
                            8
                          ]
                        },
                        {
                          "$eq": [
                            {
                              "$lower": {
                                "$coalesce": [
                                  {
                                    "$ref": "request.output.resolution"
                                  },
                                  {
                                    "$ref": "request.resolution"
                                  },
                                  {
                                    "$if": {
                                      "condition": {
                                        "$in": [
                                          {
                                            "$ref": "request.model"
                                          },
                                          [
                                            "gemini-veo-3.1-fast",
                                            "gemini-veo-3.1-lite",
                                            "gemini-omni-1.1-flash"
                                          ]
                                        ]
                                      },
                                      "then": "720p",
                                      "else": {
                                        "$if": {
                                          "condition": {
                                            "$in": [
                                              {
                                                "$ref": "request.model"
                                              },
                                              [
                                                "sd2.0-fast-480p",
                                                "sd2.0-fast-720p",
                                                "sd2.0-mini-480p",
                                                "sd2.0-mini-720p"
                                              ]
                                            ]
                                          },
                                          "then": {
                                            "$if": {
                                              "condition": {
                                                "$in": [
                                                  {
                                                    "$ref": "request.model"
                                                  },
                                                  [
                                                    "sd2.0-fast-720p",
                                                    "sd2.0-mini-720p"
                                                  ]
                                                ]
                                              },
                                              "then": "720p",
                                              "else": "480p"
                                            }
                                          },
                                          "else": "480p"
                                        }
                                      }
                                    }
                                  }
                                ]
                              }
                            },
                            "720p"
                          ]
                        },
                        {
                          "$eq": [
                            {
                              "$coalesce": [
                                {
                                  "$ref": "request.output.aspectRatio"
                                },
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "16:9"
                              ]
                            },
                            "16:9"
                          ]
                        }
                      ]
                    },
                    "then": null,
                    "else": {
                      "$coalesce": [
                        {
                          "$ref": "request.output.aspectRatio"
                        },
                        {
                          "$ref": "request.aspectRatio"
                        },
                        "16:9"
                      ]
                    }
                  }
                },
                "input_reference": {
                  "$if": {
                    "condition": {
                      "$and": [
                        {
                          "$eq": [
                            {
                              "$len": {
                                "$ref": "request.images"
                              }
                            },
                            1
                          ]
                        },
                        {
                          "$in": [
                            {
                              "$ref": "request.images.0.role"
                            },
                            [
                              "",
                              "first_frame"
                            ]
                          ]
                        }
                      ]
                    },
                    "then": {
                      "$coalesce": [
                        {
                          "$ref": "request.images.0.dataUrl"
                        },
                        {
                          "$ref": "request.images.0.url"
                        }
                      ]
                    },
                    "else": null
                  }
                },
                "reference_images": {
                  "$if": {
                    "condition": {
                      "$and": [
                        {
                          "$eq": [
                            {
                              "$len": {
                                "$ref": "request.images"
                              }
                            },
                            1
                          ]
                        },
                        {
                          "$in": [
                            {
                              "$ref": "request.images.0.role"
                            },
                            [
                              "",
                              "first_frame"
                            ]
                          ]
                        }
                      ]
                    },
                    "then": null,
                    "else": {
                      "$omitEmpty": {
                        "$map": {
                          "from": {
                            "$sortByOrder": {
                              "$ref": "request.images"
                            }
                          },
                          "as": "media",
                          "in": {
                            "url": {
                              "$coalesce": [
                                {
                                  "$ref": "media.dataUrl"
                                },
                                {
                                  "$ref": "media.url"
                                }
                              ]
                            },
                            "role": {
                              "$if": {
                                "condition": {
                                  "$in": [
                                    {
                                      "$ref": "media.role"
                                    },
                                    [
                                      "first_frame",
                                      "last_frame"
                                    ]
                                  ]
                                },
                                "then": {
                                  "$ref": "media.role"
                                },
                                "else": "reference"
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                },
                "reference_videos": {
                  "$omitEmpty": {
                    "$map": {
                      "from": {
                        "$sortByOrder": {
                          "$ref": "request.videos"
                        }
                      },
                      "as": "media",
                      "in": {
                        "$coalesce": [
                          {
                            "$ref": "media.dataUrl"
                          },
                          {
                            "$ref": "media.url"
                          }
                        ]
                      }
                    }
                  }
                },
                "size": {
                  "$if": {
                    "condition": {
                      "$and": [
                        {
                          "$and": [
                            {
                              "$eq": [
                                {
                                  "$len": {
                                    "$ref": "request.images"
                                  }
                                },
                                1
                              ]
                            },
                            {
                              "$in": [
                                {
                                  "$ref": "request.images.0.role"
                                },
                                [
                                  "",
                                  "first_frame"
                                ]
                              ]
                            }
                          ]
                        },
                        {
                          "$eq": [
                            {
                              "$if": {
                                "condition": {
                                  "$gt": [
                                    {
                                      "$coalesce": [
                                        {
                                          "$ref": "request.output.duration"
                                        },
                                        0
                                      ]
                                    },
                                    0
                                  ]
                                },
                                "then": {
                                  "$ref": "request.output.duration"
                                },
                                "else": 8
                              }
                            },
                            8
                          ]
                        },
                        {
                          "$eq": [
                            {
                              "$lower": {
                                "$coalesce": [
                                  {
                                    "$ref": "request.output.resolution"
                                  },
                                  {
                                    "$ref": "request.resolution"
                                  },
                                  {
                                    "$if": {
                                      "condition": {
                                        "$in": [
                                          {
                                            "$ref": "request.model"
                                          },
                                          [
                                            "gemini-veo-3.1-fast",
                                            "gemini-veo-3.1-lite",
                                            "gemini-omni-1.1-flash"
                                          ]
                                        ]
                                      },
                                      "then": "720p",
                                      "else": {
                                        "$if": {
                                          "condition": {
                                            "$in": [
                                              {
                                                "$ref": "request.model"
                                              },
                                              [
                                                "sd2.0-fast-480p",
                                                "sd2.0-fast-720p",
                                                "sd2.0-mini-480p",
                                                "sd2.0-mini-720p"
                                              ]
                                            ]
                                          },
                                          "then": {
                                            "$if": {
                                              "condition": {
                                                "$in": [
                                                  {
                                                    "$ref": "request.model"
                                                  },
                                                  [
                                                    "sd2.0-fast-720p",
                                                    "sd2.0-mini-720p"
                                                  ]
                                                ]
                                              },
                                              "then": "720p",
                                              "else": "480p"
                                            }
                                          },
                                          "else": "480p"
                                        }
                                      }
                                    }
                                  }
                                ]
                              }
                            },
                            "720p"
                          ]
                        },
                        {
                          "$eq": [
                            {
                              "$coalesce": [
                                {
                                  "$ref": "request.output.aspectRatio"
                                },
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "16:9"
                              ]
                            },
                            "16:9"
                          ]
                        }
                      ]
                    },
                    "then": "1280x720",
                    "else": null
                  }
                }
              },
              "else": {
                "$if": {
                  "condition": {
                    "$in": [
                      {
                        "$ref": "request.model"
                      },
                      [
                        "sd2.0-fast-480p",
                        "sd2.0-fast-720p",
                        "sd2.0-mini-480p",
                        "sd2.0-mini-720p"
                      ]
                    ]
                  },
                  "then": {
                    "model": {
                      "$ref": "request.model"
                    },
                    "prompt": {
                      "$trim": {
                        "$ref": "request.prompt"
                      }
                    },
                    "seconds": {
                      "$toString": {
                        "$if": {
                          "condition": {
                            "$gt": [
                              {
                                "$coalesce": [
                                  {
                                    "$ref": "request.output.duration"
                                  },
                                  0
                                ]
                              },
                              0
                            ]
                          },
                          "then": {
                            "$ref": "request.output.duration"
                          },
                          "else": 8
                        }
                      }
                    },
                    "ratio": {
                      "$coalesce": [
                        {
                          "$ref": "request.output.aspectRatio"
                        },
                        {
                          "$ref": "request.aspectRatio"
                        },
                        "16:9"
                      ]
                    },
                    "aspect_ratio": {
                      "$coalesce": [
                        {
                          "$ref": "request.output.aspectRatio"
                        },
                        {
                          "$ref": "request.aspectRatio"
                        },
                        "16:9"
                      ]
                    },
                    "resolution": {
                      "$lower": {
                        "$coalesce": [
                          {
                            "$ref": "request.output.resolution"
                          },
                          {
                            "$ref": "request.resolution"
                          },
                          {
                            "$if": {
                              "condition": {
                                "$in": [
                                  {
                                    "$ref": "request.model"
                                  },
                                  [
                                    "gemini-veo-3.1-fast",
                                    "gemini-veo-3.1-lite",
                                    "gemini-omni-1.1-flash"
                                  ]
                                ]
                              },
                              "then": "720p",
                              "else": {
                                "$if": {
                                  "condition": {
                                    "$in": [
                                      {
                                        "$ref": "request.model"
                                      },
                                      [
                                        "sd2.0-fast-480p",
                                        "sd2.0-fast-720p",
                                        "sd2.0-mini-480p",
                                        "sd2.0-mini-720p"
                                      ]
                                    ]
                                  },
                                  "then": {
                                    "$if": {
                                      "condition": {
                                        "$in": [
                                          {
                                            "$ref": "request.model"
                                          },
                                          [
                                            "sd2.0-fast-720p",
                                            "sd2.0-mini-720p"
                                          ]
                                        ]
                                      },
                                      "then": "720p",
                                      "else": "480p"
                                    }
                                  },
                                  "else": "480p"
                                }
                              }
                            }
                          }
                        ]
                      }
                    },
                    "images": {
                      "$omitEmpty": {
                        "$map": {
                          "from": {
                            "$sortByOrder": {
                              "$ref": "request.images"
                            }
                          },
                          "as": "media",
                          "in": {
                            "$ref": "media.url"
                          }
                        }
                      }
                    }
                  },
                  "else": {
                    "model": {
                      "$ref": "request.model"
                    },
                    "prompt": {
                      "$trim": {
                        "$ref": "request.prompt"
                      }
                    },
                    "duration": {
                      "$if": {
                        "condition": {
                          "$gt": [
                            {
                              "$coalesce": [
                                {
                                  "$ref": "request.output.duration"
                                },
                                0
                              ]
                            },
                            0
                          ]
                        },
                        "then": {
                          "$ref": "request.output.duration"
                        },
                        "else": 8
                      }
                    },
                    "resolution": {
                      "$lower": {
                        "$coalesce": [
                          {
                            "$ref": "request.output.resolution"
                          },
                          {
                            "$ref": "request.resolution"
                          },
                          {
                            "$if": {
                              "condition": {
                                "$in": [
                                  {
                                    "$ref": "request.model"
                                  },
                                  [
                                    "gemini-veo-3.1-fast",
                                    "gemini-veo-3.1-lite",
                                    "gemini-omni-1.1-flash"
                                  ]
                                ]
                              },
                              "then": "720p",
                              "else": {
                                "$if": {
                                  "condition": {
                                    "$in": [
                                      {
                                        "$ref": "request.model"
                                      },
                                      [
                                        "sd2.0-fast-480p",
                                        "sd2.0-fast-720p",
                                        "sd2.0-mini-480p",
                                        "sd2.0-mini-720p"
                                      ]
                                    ]
                                  },
                                  "then": {
                                    "$if": {
                                      "condition": {
                                        "$in": [
                                          {
                                            "$ref": "request.model"
                                          },
                                          [
                                            "sd2.0-fast-720p",
                                            "sd2.0-mini-720p"
                                          ]
                                        ]
                                      },
                                      "then": "720p",
                                      "else": "480p"
                                    }
                                  },
                                  "else": "480p"
                                }
                              }
                            }
                          }
                        ]
                      }
                    },
                    "aspect_ratio": {
                      "$coalesce": [
                        {
                          "$ref": "request.output.aspectRatio"
                        },
                        {
                          "$ref": "request.aspectRatio"
                        },
                        "16:9"
                      ]
                    },
                    "generate_audio": {
                      "$coalesce": [
                        {
                          "$ref": "request.output.generateAudio"
                        },
                        {
                          "$ref": "request.generateAudio"
                        },
                        false
                      ]
                    },
                    "image": {
                      "$if": {
                        "condition": {
                          "$gt": [
                            {
                              "$len": {
                                "$ref": "request.images"
                              }
                            },
                            0
                          ]
                        },
                        "then": {
                          "url": {
                            "$coalesce": [
                              {
                                "$ref": "request.images.0.url"
                              },
                              {
                                "$ref": "request.images.0.dataUrl"
                              }
                            ]
                          }
                        },
                        "else": null
                      }
                    }
                  }
                }
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.id"
              },
              {
                "$ref": "response.task_id"
              },
              {
                "$ref": "response.data.id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$if": {
              "condition": {
                "$and": [
                  {
                    "$in": [
                      {
                        "$ref": "request.model"
                      },
                      [
                        "sd2.0-fast-480p",
                        "sd2.0-fast-720p",
                        "sd2.0-mini-480p",
                        "sd2.0-mini-720p"
                      ]
                    ]
                  },
                  {
                    "$eq": [
                      {
                        "$lower": {
                          "$coalesce": [
                            {
                              "$ref": "response.status"
                            },
                            {
                              "$ref": "response.data.status"
                            },
                            "unknown"
                          ]
                        }
                      },
                      "completed"
                    ]
                  },
                  {
                    "$eq": [
                      {
                        "$len": {
                          "$coalesce": [
                            {
                              "$ref": "response.video_url"
                            },
                            {
                              "$ref": "response.result.video_url"
                            },
                            {
                              "$ref": "response.url"
                            },
                            {
                              "$ref": "response.output.0.url"
                            }
                          ]
                        }
                      },
                      0
                    ]
                  }
                ]
              },
              "then": "in_progress",
              "else": {
                "$lower": {
                  "$coalesce": [
                    {
                      "$ref": "response.status"
                    },
                    {
                      "$ref": "response.data.status"
                    },
                    "unknown"
                  ]
                }
              }
            }
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.error.message"
              },
              {
                "$ref": "response.message"
              },
              {
                "$ref": "response.fail_reason"
              }
            ]
          },
          "videos": {
            "$if": {
              "condition": {
                "$eq": [
                  {
                    "$lower": {
                      "$coalesce": [
                        {
                          "$ref": "response.status"
                        },
                        {
                          "$ref": "response.data.status"
                        },
                        "unknown"
                      ]
                    }
                  },
                  "completed"
                ]
              },
              "then": {
                "$coalesce": [
                  {
                    "$ref": "response.video_url"
                  },
                  {
                    "$ref": "response.result.video_url"
                  },
                  {
                    "$ref": "response.url"
                  },
                  {
                    "$ref": "response.output.0.url"
                  }
                ]
              },
              "else": null
            }
          },
          "errorPaths": [
            "error",
            "error.code"
          ],
          "resultEphemeral": true
        },
        "result": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}/content",
          "headers": {
            "Accept": "video/mp4"
          }
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
