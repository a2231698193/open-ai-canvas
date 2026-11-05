# 问鼎 LK888 可灵视频 接口字段

## 协议身份

- 插件 ID：`lk888-kling-video`。
- Provider ID：`lk888-kling-video`。
- 能力：`video`。
- 默认 Base URL：`https://api.lk888.ai`。
- 鉴权驱动：`bearer`。
- 创建：`POST /v1/media/generate`。
- 查询：`GET /v1/media/status`，查询参数 `task_id`。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | `kling-motion-control-v3` / `kling-v4-video`。 |
| `prompt` | string | 是 | `prompt` | 视频提示词。V4 可直接文生视频，也可用 `[图1]`、`[视频1]` 引用参考素材。 |
| `images` | media[] | 否 | `params.image_url` | 动作控制取第一张（必填，jpg/png，≤10MB）；V4 全量映射为数组（最多 10 张，单张 ≤30MB）。 |
| `videos` | media[] | 否 | `params.video_url` | 动作控制取第一段（必填，mp4/mov，3～30 秒，≤100MB）；V4 全量映射为数组（最多 5 段）。 |
| `duration` | integer | 否 | `params.duration` | 仅 V4：3～30 秒，以字符串发送，缺省 5；动作控制由参考视频决定，不发送。 |
| `aspectRatio` | string | 否 | `params.aspect_ratio` | 仅 V4：`16:9` / `9:16` / `1:1` / `21:9`，空值与 `auto` 归一为 `16:9`。 |
| `resolution` | string | 否 | `params.resolution` / `params.mode` | V4 映射 `720p` / `1080p`；动作控制把 1080p 档映射 `mode=pro`，其余映射 `std`。 |
| `generateAudio` | boolean | 否 | `params.keep_original_sound` | 仅动作控制：`true` 映射 `yes`，`false` 映射 `no`。 |
| `providerOptions` | object | 否 | `params.mode` / `params.character_orientation` / `params.keep_original_sound` | 命名空间 `lk888-kling-video`，仅动作控制读取。 |

## 按模型的必填与可选

| 模型 | 必填参数 | 可选参数 | 说明 |
| --- | --- | --- | --- |
| `kling-motion-control-v3` | `image_url`（1 张）、`video_url`（1 段）、`mode`、`character_orientation` | `keep_original_sound` | 参考图决定人物与背景，参考视频决定动作。人物朝向与图片一致时成片最长 10 秒，与视频一致时最长 30 秒。 |
| `kling-v4-video` | `prompt` | `image_url[]`、`video_url[]`、`duration`、`aspect_ratio`、`resolution` | 支持 720p/1080p、3～30 秒，`21:9` 宽银幕。 |

### 动作控制扩展键

| 键 | 取值 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `providerOptions.lk888-kling-video.mode` | `std` / `pro` | 按 `resolution` 推断 | 标准模式性价比高，专家模式质量更佳。 |
| `providerOptions.lk888-kling-video.character_orientation` | `video` / `image` | `video` | 与视频一致时动作还原更好，与图片一致时保留原图朝向。 |
| `providerOptions.lk888-kling-video.keep_original_sound` | `yes` / `no` | 跟随 `generateAudio`，缺省 `no` | 是否保留参考视频原声。 |

## 上游请求模板逐字段清单

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/v1/media/generate"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `request.model` |
| `create.body.prompt` | `request.prompt` |
| `create.body.params.mode` | 仅动作控制：`providerOptions.lk888-kling-video.mode` → `std` / `pro`，其次按 `resolution` 推断 |
| `create.body.params.image_url` | 动作控制取 `request.images` 首项字符串；V4 取全部 URL 数组 |
| `create.body.params.video_url` | 动作控制取 `request.videos` 首项字符串；V4 取全部 URL 数组 |
| `create.body.params.duration` | 仅 V4：`request.duration` 转字符串，缺省 `"5"` |
| `create.body.params.aspect_ratio` | 仅 V4：`request.aspectRatio`，空值与 `auto` 归一为 `"16:9"` |
| `create.body.params.resolution` | 仅 V4：`1080p` 档映射 `"1080p"`，其余 `"720p"` |
| `create.body.params.character_orientation` | 仅动作控制：`providerOptions.lk888-kling-video.character_orientation` → `"video"` / `"image"`，缺省 `"video"` |
| `create.body.params.keep_original_sound` | 仅动作控制：`providerOptions.lk888-kling-video.keep_original_sound` → `"yes"` / `"no"`，其次跟随 `request.generateAudio` |
| `poll.method` | `"GET"` |
| `poll.path` | `"/v1/media/status"` |
| `poll.query.task_id` | `taskId` |

请求体固定为 `model` / `prompt` / `params` 三个顶层字段，每个 `params` 键按模型条件输出，不适用于当前模型的键不会出现在请求里。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.taskId` | `response.data.task_id` / `response.task_id` |
| `response.status` | `response.state`（`pending` / `running` / `success` / `failed`），缺省 `pending` |
| `response.message` | `response.error` |
| `response.videos` | `response.result_url`（临时地址，宿主立即下载并持久化） |
| `response.errorPaths` | `error` |
| `response.resultEphemeral` | `true` |

## 响应与错误

- 创建成功返回 `{ "code": 200, "data": { "task_id": 123456 }, "msg": "任务创建成功" }`，宿主从 `data.task_id` 取任务 ID。
- 查询以 `is_final` 判断终态、以 `state` 判断成功或失败；`status` / `status_group` 是中文展示字段，不参与判定。插件按 `state` 映射统一状态，`success` 时读取 `result_url`。
- `state === "failed"` 时上游已退款，`error` 写入任务失败原因。
- 视频任务通常 1～10 分钟完成，宿主按统一轮询节奏查询。

## 兼容边界

该包只覆盖问鼎数据的 `/v1/media/generate` 异步任务接口。可灵官方直连（`api.klingai.com`）使用 `kling-video` 插件，二者端点与字段不同，不能混用。同一问鼎站点上的 MiniMax、万相与 video-enhance 仍由 `lk888-video` 插件提供。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "lk888-kling-video",
  "name": "问鼎 LK888 可灵视频",
  "version": "1.0.0",
  "author": "问鼎数据 / 影策",
  "description": "问鼎数据可灵动作控制 V3 与可灵 V4 视频协议，覆盖 kling-motion-control-v3、kling-v4-video。",
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
        "id": "lk888-kling-video",
        "label": "问鼎 LK888 可灵视频",
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
            "description": "视频模型 ID：kling-motion-control-v3、kling-v4-video。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "视频提示词。V4 可直接文生视频，也可用 [图1]、[视频1] 引用参考素材。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "params.image_url",
            "description": "参考图片。动作控制取第一张（必填，jpg/png，≤10MB）；V4 全量映射为数组（最多 10 张）。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "params.video_url",
            "description": "参考视频。动作控制取第一段（必填，mp4/mov，3～30 秒，≤100MB）；V4 全量映射为数组（最多 5 段）。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "params.duration",
            "description": "成片时长秒数，仅 V4 使用（3～30），以字符串发送，缺省 5；动作控制由参考视频决定，不发送。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "params.aspect_ratio",
            "description": "画面比例，仅 V4 使用：16:9 / 9:16 / 1:1 / 21:9，缺省 16:9。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "params.resolution / params.mode",
            "description": "V4 映射 720p / 1080p；动作控制把 720p 映射 std、1080p 映射 pro。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "required": false,
            "mapping": "params.keep_original_sound",
            "description": "动作控制是否保留参考视频原声：true 映射 yes，false 映射 no。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "params.mode / params.character_orientation / params.keep_original_sound",
            "description": "命名空间 lk888-kling-video。动作控制可用 mode（std/pro）、character_orientation（video/image）、keep_original_sound（yes/no）覆盖默认值。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$if": {
                "condition": {
                  "$eq": [
                    {
                      "$lower": {
                        "$trim": {
                          "$ref": "request.model"
                        }
                      }
                    },
                    "kling-motion-control-v3"
                  ]
                },
                "then": {
                  "$and": [
                    {
                      "$gt": [
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
                            "$ref": "request.videos"
                          }
                        },
                        0
                      ]
                    }
                  ]
                },
                "else": true
              }
            },
            "message": "可灵动作控制 V3 需要至少 1 张参考图片和 1 段参考视频"
          },
          {
            "assert": {
              "$if": {
                "condition": {
                  "$eq": [
                    {
                      "$lower": {
                        "$trim": {
                          "$ref": "request.model"
                        }
                      }
                    },
                    "kling-v4-video"
                  ]
                },
                "then": {
                  "$and": [
                    {
                      "$lte": [
                        {
                          "$len": {
                            "$ref": "request.images"
                          }
                        },
                        10
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$len": {
                            "$ref": "request.videos"
                          }
                        },
                        5
                      ]
                    }
                  ]
                },
                "else": true
              }
            },
            "message": "可灵 V4 最多支持 10 张参考图片和 5 段参考视频"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/media/generate",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "params": {
              "mode": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$lower": {
                          "$trim": {
                            "$ref": "request.model"
                          }
                        }
                      },
                      "kling-motion-control-v3"
                    ]
                  },
                  "then": {
                    "$switch": {
                      "cases": [
                        {
                          "when": {
                            "$in": [
                              {
                                "$lower": {
                                  "$trim": {
                                    "$ref": "request.providerOptions.lk888-kling-video.mode"
                                  }
                                }
                              },
                              [
                                "pro",
                                "professional"
                              ]
                            ]
                          },
                          "then": "pro"
                        },
                        {
                          "when": {
                            "$in": [
                              {
                                "$lower": {
                                  "$trim": {
                                    "$ref": "request.providerOptions.lk888-kling-video.mode"
                                  }
                                }
                              },
                              [
                                "std",
                                "standard"
                              ]
                            ]
                          },
                          "then": "std"
                        },
                        {
                          "when": {
                            "$in": [
                              {
                                "$lower": {
                                  "$trim": {
                                    "$ref": "request.resolution"
                                  }
                                }
                              },
                              [
                                "1080p",
                                "1080",
                                "high",
                                "pro"
                              ]
                            ]
                          },
                          "then": "pro"
                        }
                      ],
                      "default": "std"
                    }
                  },
                  "else": null
                }
              },
              "image_url": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$lower": {
                          "$trim": {
                            "$ref": "request.model"
                          }
                        }
                      },
                      "kling-motion-control-v3"
                    ]
                  },
                  "then": {
                    "$first": {
                      "$map": {
                        "from": {
                          "$sortByOrder": {
                            "$ref": "request.images"
                          }
                        },
                        "as": "media",
                        "in": {
                          "$ref": "media.value"
                        }
                      }
                    }
                  },
                  "else": {
                    "$if": {
                      "condition": {
                        "$eq": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "request.model"
                              }
                            }
                          },
                          "kling-v4-video"
                        ]
                      },
                      "then": {
                        "$omitEmpty": {
                          "$map": {
                            "from": {
                              "$sortByOrder": {
                                "$ref": "request.images"
                              }
                            },
                            "as": "media",
                            "in": {
                              "$ref": "media.value"
                            }
                          }
                        }
                      },
                      "else": null
                    }
                  }
                }
              },
              "video_url": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$lower": {
                          "$trim": {
                            "$ref": "request.model"
                          }
                        }
                      },
                      "kling-motion-control-v3"
                    ]
                  },
                  "then": {
                    "$first": {
                      "$map": {
                        "from": {
                          "$sortByOrder": {
                            "$ref": "request.videos"
                          }
                        },
                        "as": "media",
                        "in": {
                          "$ref": "media.value"
                        }
                      }
                    }
                  },
                  "else": {
                    "$if": {
                      "condition": {
                        "$eq": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "request.model"
                              }
                            }
                          },
                          "kling-v4-video"
                        ]
                      },
                      "then": {
                        "$omitEmpty": {
                          "$map": {
                            "from": {
                              "$sortByOrder": {
                                "$ref": "request.videos"
                              }
                            },
                            "as": "media",
                            "in": {
                              "$ref": "media.value"
                            }
                          }
                        }
                      },
                      "else": null
                    }
                  }
                }
              },
              "duration": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$lower": {
                          "$trim": {
                            "$ref": "request.model"
                          }
                        }
                      },
                      "kling-v4-video"
                    ]
                  },
                  "then": {
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
                        "$toString": {
                          "$ref": "request.duration"
                        }
                      },
                      "else": "5"
                    }
                  },
                  "else": null
                }
              },
              "aspect_ratio": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$lower": {
                          "$trim": {
                            "$ref": "request.model"
                          }
                        }
                      },
                      "kling-v4-video"
                    ]
                  },
                  "then": {
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
                            "auto",
                            "adaptive",
                            "default"
                          ]
                        ]
                      },
                      "then": "16:9",
                      "else": {
                        "$ref": "request.aspectRatio"
                      }
                    }
                  },
                  "else": null
                }
              },
              "resolution": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$lower": {
                          "$trim": {
                            "$ref": "request.model"
                          }
                        }
                      },
                      "kling-v4-video"
                    ]
                  },
                  "then": {
                    "$switch": {
                      "cases": [
                        {
                          "when": {
                            "$in": [
                              {
                                "$lower": {
                                  "$trim": {
                                    "$ref": "request.resolution"
                                  }
                                }
                              },
                              [
                                "1080p",
                                "1080",
                                "high",
                                "pro"
                              ]
                            ]
                          },
                          "then": "1080p"
                        }
                      ],
                      "default": "720p"
                    }
                  },
                  "else": null
                }
              },
              "character_orientation": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$lower": {
                          "$trim": {
                            "$ref": "request.model"
                          }
                        }
                      },
                      "kling-motion-control-v3"
                    ]
                  },
                  "then": {
                    "$switch": {
                      "cases": [
                        {
                          "when": {
                            "$in": [
                              {
                                "$lower": {
                                  "$trim": {
                                    "$ref": "request.providerOptions.lk888-kling-video.character_orientation"
                                  }
                                }
                              },
                              [
                                "image",
                                "picture",
                                "img"
                              ]
                            ]
                          },
                          "then": "image"
                        }
                      ],
                      "default": "video"
                    }
                  },
                  "else": null
                }
              },
              "keep_original_sound": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$lower": {
                          "$trim": {
                            "$ref": "request.model"
                          }
                        }
                      },
                      "kling-motion-control-v3"
                    ]
                  },
                  "then": {
                    "$switch": {
                      "cases": [
                        {
                          "when": {
                            "$in": [
                              {
                                "$lower": {
                                  "$trim": {
                                    "$ref": "request.providerOptions.lk888-kling-video.keep_original_sound"
                                  }
                                }
                              },
                              [
                                "yes",
                                "true",
                                "1"
                              ]
                            ]
                          },
                          "then": "yes"
                        },
                        {
                          "when": {
                            "$in": [
                              {
                                "$lower": {
                                  "$trim": {
                                    "$ref": "request.providerOptions.lk888-kling-video.keep_original_sound"
                                  }
                                }
                              },
                              [
                                "no",
                                "false",
                                "0"
                              ]
                            ]
                          },
                          "then": "no"
                        }
                      ],
                      "default": {
                        "$if": {
                          "condition": {
                            "$ref": "request.generateAudio"
                          },
                          "then": "yes",
                          "else": "no"
                        }
                      }
                    }
                  },
                  "else": null
                }
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/media/status",
          "query": {
            "task_id": {
              "$ref": "taskId"
            }
          }
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.data.task_id"
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
                "$ref": "response.state"
              },
              "pending"
            ]
          },
          "message": {
            "$ref": "response.error"
          },
          "videos": {
            "$omitEmpty": {
              "$ref": "response.result_url"
            }
          },
          "errorPaths": [
            "error"
          ],
          "resultEphemeral": true
        },
        "description": "问鼎数据可灵视频异步任务协议：动作控制 V3 与 V4 视频。"
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
