# 问鼎 LK888 Seedance 按秒 接口字段

## 协议身份

- 插件 ID：`lk888-seedance-anmiao`。
- Provider ID：`lk888-seedance-anmiao`。
- 能力：`video`。
- 默认 Base URL：`https://api.lk888.ai`。
- 鉴权驱动：`bearer`。
- 创建：`POST /api/v3/anmiao/contents/generations/tasks`。
- 查询：`GET /api/v3/anmiao/contents/generations/tasks/{taskId}`。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | `doubao-seedance-2-0-260128` / `doubao-seedance-2-0-fast-260128` / `doubao-seedance-2-0-mini-260615`。文档标题 `seedance-2.0-guanfang-anmiao` 不是创建用 model。 |
| `prompt` | string | 是 | `content[type=text].text` | 视频提示词。 |
| `images` | media[] | 否 | `content[type=image_url]` | role 原样映射。 |
| `videos` | media[] | 否 | `content[type=video_url]` | `reference_video`。 |
| `audios` | media[] | 否 | `content[type=audio_url]` | `reference_audio`。 |
| `aspectRatio` | string | 否 | `ratio` | 空/`auto`/像素写法映射 `adaptive`。 |
| `resolution` | string | 否 | `resolution` | 默认 `720p`。fast/mini 仅 480p/720p。 |
| `duration` | integer | 是 | `duration` | 4～15 整数秒，缺省 5，不传 `-1`。 |

## 上游请求模板逐字段清单

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/api/v3/anmiao/contents/generations/tasks"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `request.model` |
| `create.body.content` | text + image_url/video_url/audio_url，role 来自 `media.role` |
| `create.body.ratio` | `request.aspectRatio`，缺省 `adaptive` |
| `create.body.resolution` | `request.resolution`，缺省 `720p` |
| `create.body.duration` | `request.duration`，缺省 5 |
| `poll.method` | `"GET"` |
| `poll.path` | `"/api/v3/anmiao/contents/generations/tasks/{{taskId}}"` |

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.taskId` | `response.id` / `response.task_id` |
| `response.status` | `response.status`（`queued` / `running` / `succeeded` / `failed`） |
| `response.message` | `response.error.message` |
| `response.videos` | `response.content.video_url` |
| `response.usage` | `response.usage`（`output_seconds`，token 为 0） |
| `response.resultEphemeral` | `true` |

## 响应与错误

创建成功返回 `{"id":"..."}`。完成态 `status=succeeded`，视频在 `content.video_url`。按秒一次扣清，查询 `usage.output_seconds` 与 `duration` 对齐。

## 兼容边界

路径是 `/api/v3/anmiao`，不是 token 版 `/api/v3`。后台价格档用 **按秒**。素材必须是公网 URL。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "lk888-seedance-anmiao",
  "name": "问鼎 LK888 Seedance 按秒",
  "version": "1.0.0",
  "author": "问鼎数据 / 影策",
  "description": "问鼎站 Seedance 按秒协议：POST/GET /api/v3/anmiao/contents/generations/tasks。",
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
        "id": "lk888-seedance-anmiao",
        "label": "问鼎 LK888 Seedance 按秒",
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
        "baseUrl": "https://api.lk888.ai",
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
            "description": "方舟 model：doubao-seedance-2-0-260128 / doubao-seedance-2-0-fast-260128 / doubao-seedance-2-0-mini-260615。文档标题 seedance-2.0-guanfang-anmiao 不是创建用 model。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "content[type=text].text",
            "description": "视频提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "content[type=image_url]",
            "description": "first_frame、last_frame、reference_image 等 role 原样映射。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "content[type=video_url]",
            "description": "reference_video。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "content[type=audio_url]",
            "description": "reference_audio。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "ratio",
            "description": "输出画幅，默认 adaptive。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "480p / 720p / 1080p / 4k。fast/mini 仅 480p/720p。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": true,
            "mapping": "duration",
            "description": "必填整数秒 4～15，不接受 -1。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/api/v3/anmiao/contents/generations/tasks",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "content": {
              "$concatArrays": [
                [
                  {
                    "type": "text",
                    "text": {
                      "$ref": "request.prompt"
                    }
                  }
                ],
                {
                  "$map": {
                    "from": {
                      "$sortByOrder": {
                        "$ref": "request.images"
                      }
                    },
                    "as": "media",
                    "in": {
                      "type": "image_url",
                      "image_url": {
                        "url": {
                          "$ref": "media.value"
                        }
                      },
                      "role": {
                        "$coalesce": [
                          {
                            "$ref": "media.role"
                          },
                          "reference_image"
                        ]
                      }
                    }
                  }
                },
                {
                  "$map": {
                    "from": {
                      "$sortByOrder": {
                        "$ref": "request.videos"
                      }
                    },
                    "as": "media",
                    "in": {
                      "type": "video_url",
                      "video_url": {
                        "url": {
                          "$ref": "media.value"
                        }
                      },
                      "role": {
                        "$coalesce": [
                          {
                            "$ref": "media.role"
                          },
                          "reference_video"
                        ]
                      }
                    }
                  }
                },
                {
                  "$map": {
                    "from": {
                      "$sortByOrder": {
                        "$ref": "request.audios"
                      }
                    },
                    "as": "media",
                    "in": {
                      "type": "audio_url",
                      "audio_url": {
                        "url": {
                          "$ref": "media.value"
                        }
                      },
                      "role": {
                        "$coalesce": [
                          {
                            "$ref": "media.role"
                          },
                          "reference_audio"
                        ]
                      }
                    }
                  }
                }
              ]
            },
            "ratio": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$in": [
                      {
                        "$lower": {
                          "$trim": {
                            "$ref": "request.aspectRatio"
                          }
                        }
                      },
                      [
                        "",
                        "auto"
                      ]
                    ]
                  },
                  "then": "adaptive",
                  "else": {
                    "$if": {
                      "condition": {
                        "$eq": [
                          {
                            "$len": {
                              "$split": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "x"
                              ]
                            }
                          },
                          2
                        ]
                      },
                      "then": "adaptive",
                      "else": {
                        "$ref": "request.aspectRatio"
                      }
                    }
                  }
                }
              }
            },
            "resolution": {
              "$coalesce": [
                {
                  "$ref": "request.resolution"
                },
                "720p"
              ]
            },
            "duration": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$ref": "request.duration"
                    },
                    0
                  ]
                },
                "then": {
                  "$ref": "request.duration"
                },
                "else": 5
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/api/v3/anmiao/contents/generations/tasks/{{taskId}}"
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
                "$ref": "response.error"
              }
            ]
          },
          "videos": {
            "$omitEmpty": {
              "$ref": "response.content.video_url"
            }
          },
          "usage": {
            "$ref": "response.usage"
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
