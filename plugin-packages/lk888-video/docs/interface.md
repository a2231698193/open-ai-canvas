# 问鼎 LK888 Video 接口字段

## 协议身份

- 插件 ID：`lk888-video`。
- Provider ID：`lk888-video`。
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
| `model` | string | 是 | `model` | `minimax-h3` / `kling-v3-video` / `wan3.0-video-cankaosheng`。 |
| `prompt` | string | 是 | `prompt` | 视频提示词。 |
| `images` | media[] | 否 | `params.images` / `params.image_url` / `params.reference_urls` | MiniMax 首尾帧进 `images`，参考图进 `image_url`；可灵 `images` 最多 2 张；万相走 `reference_urls`。 |
| `videos` | media[] | 否 | `params.video_url` | 仅 MiniMax 参考生。 |
| `audios` | media[] | 否 | `params.audio_url` | 仅 MiniMax 参考生。 |
| `duration` | integer | 否 | `params.duration` | 字符串秒。可灵映射 5/10/15；万相 0 秒为 `auto`。 |
| `aspectRatio` | string | 否 | `params.aspect_ratio` / `params.ratio` | MiniMax / 可灵用 `aspect_ratio`；万相用 `ratio`。 |
| `resolution` | string | 否 | `params.resolution` / `params.mode` | MiniMax `768P/1080P/2K/4K`；万相 `480P/720P/1080P`；可灵 1080p/4k 映射 `mode=pro`。 |
| `generateAudio` | boolean | 否 | `params.audio` | 仅万相。 |
| `providerOptions` | object | 否 | `params.mode` / `params.version` / `params.file_url` / `params.link_url` / `params.prompt_extend` | 命名空间 `lk888-video`。 |

## 上游请求模板逐字段清单

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/v1/media/generate"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `request.model` |
| `create.body.prompt` | `request.prompt` |
| `create.body.params.mode` | MiniMax：`shouweizhen` / `cankaosheng`；可灵：`std` / `pro` |
| `create.body.params.images` | MiniMax 首尾帧；可灵全部图片 |
| `create.body.params.image_url` | MiniMax `reference_image` |
| `create.body.params.video_url` | MiniMax 参考视频 |
| `create.body.params.audio_url` | MiniMax 参考音频 |
| `create.body.params.reference_urls` | 万相参考图 |
| `create.body.params.file_url` | `providerOptions.lk888-video.file_url` |
| `create.body.params.link_url` | `providerOptions.lk888-video.link_url` |
| `create.body.params.version` | 万相 `standard` / `prime`，默认 `standard` |
| `create.body.params.duration` | 字符串秒或万相 `auto` |
| `create.body.params.aspect_ratio` | MiniMax / 可灵 |
| `create.body.params.ratio` | 万相 |
| `create.body.params.resolution` | MiniMax / 万相 |
| `create.body.params.audio` | 万相 `request.generateAudio` |
| `create.body.params.prompt_extend` | `providerOptions.lk888-video.prompt_extend` |
| `poll.method` | `"GET"` |
| `poll.path` | `"/v1/media/status"` |
| `poll.query.task_id` | `taskId` |

## Provider 扩展键

- `lk888-video.mode`：覆盖 MiniMax / 可灵自动推断。
- `lk888-video.version`：万相 `standard` / `prime`。
- `lk888-video.file_url`：万相文档 URL。
- `lk888-video.link_url`：万相网页链接。
- `lk888-video.prompt_extend`：万相提示词优化。

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.taskId` | `response.data.task_id` / `response.task_id` |
| `response.status` | `response.state` |
| `response.message` | `response.error` |
| `response.videos` | `response.result_url` |
| `response.resultEphemeral` | `true` |

## 响应与错误

创建成功返回 `data.task_id`（可能是数字）。轮询用 `state`：`pending` / `running` / `success` / `failed`。成功后从 `result_url` 取视频。临时媒体 URL 标记为 ephemeral。

## 兼容边界

MiniMax 有首尾帧时走 `images`，参考生走 `image_url`/`video_url`/`audio_url`，不要把参考图塞进首尾帧。可灵 `images` 1 张=首帧、2 张=首尾帧。万相文档和网页链接二选一，走扩展键。Seedance 不在本包，见 `lk888-seedance`。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "lk888-video",
  "name": "问鼎 LK888 Video",
  "version": "1.0.0",
  "author": "问鼎数据 / 影策",
  "description": "问鼎数据视频异步任务协议，覆盖 minimax-h3、kling-v3-video、wan3.0-video-cankaosheng。",
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
        "id": "lk888-video",
        "label": "问鼎 LK888 Video",
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
            "description": "视频模型 ID：minimax-h3、kling-v3-video、wan3.0-video-cankaosheng。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "视频提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "params.images / params.image_url / params.reference_urls",
            "description": "首尾帧或参考图。role 由画布确定：first_frame / last_frame / reference_image。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "params.video_url",
            "description": "MiniMax 参考生的参考视频。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "params.audio_url",
            "description": "MiniMax 参考生的参考音频。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "params.duration",
            "description": "时长秒数。可灵只接受 5/10/15；万相 0 秒映射 auto。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "params.aspect_ratio / params.ratio",
            "description": "画幅比例。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "params.resolution / params.mode",
            "description": "分辨率档位。可灵 1080p/4k 映射 mode=pro。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "required": false,
            "mapping": "params.audio",
            "description": "万相是否生成音频。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "params.mode / params.version / params.file_url / params.link_url / params.prompt_extend",
            "description": "命名空间 lk888-video 的扩展字段。"
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
                      "minimax-h3"
                    ]
                  },
                  "then": {
                    "$coalesce": [
                      {
                        "$ref": "request.providerOptions.lk888-video.mode"
                      },
                      {
                        "$if": {
                          "condition": {
                            "$gt": [
                              {
                                "$len": {
                                  "$filter": {
                                    "from": {
                                      "$sortByOrder": {
                                        "$ref": "request.images"
                                      }
                                    },
                                    "as": "media",
                                    "where": {
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
                                }
                              },
                              0
                            ]
                          },
                          "then": "shouweizhen",
                          "else": {
                            "$if": {
                              "condition": {
                                "$or": [
                                  {
                                    "$gt": [
                                      {
                                        "$len": {
                                          "$filter": {
                                            "from": {
                                              "$sortByOrder": {
                                                "$ref": "request.images"
                                              }
                                            },
                                            "as": "media",
                                            "where": {
                                              "$in": [
                                                {
                                                  "$ref": "media.role"
                                                },
                                                [
                                                  "reference_image"
                                                ]
                                              ]
                                            }
                                          }
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
                                  },
                                  {
                                    "$gt": [
                                      {
                                        "$len": {
                                          "$ref": "request.audios"
                                        }
                                      },
                                      0
                                    ]
                                  }
                                ]
                              },
                              "then": "cankaosheng",
                              "else": null
                            }
                          }
                        }
                      }
                    ]
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
                          "kling-v3-video"
                        ]
                      },
                      "then": {
                        "$coalesce": [
                          {
                            "$ref": "request.providerOptions.lk888-video.mode"
                          },
                          {
                            "$if": {
                              "condition": {
                                "$in": [
                                  {
                                    "$lower": {
                                      "$trim": {
                                        "$ref": "request.resolution"
                                      }
                                    }
                                  },
                                  [
                                    "4k",
                                    "1080p",
                                    "1080",
                                    "high",
                                    "pro"
                                  ]
                                ]
                              },
                              "then": "pro",
                              "else": "std"
                            }
                          }
                        ]
                      },
                      "else": null
                    }
                  }
                }
              },
              "images": {
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
                      "minimax-h3"
                    ]
                  },
                  "then": {
                    "$omitEmpty": {
                      "$map": {
                        "from": {
                          "$filter": {
                            "from": {
                              "$sortByOrder": {
                                "$ref": "request.images"
                              }
                            },
                            "as": "media",
                            "where": {
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
                          "kling-v3-video"
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
                      "minimax-h3"
                    ]
                  },
                  "then": {
                    "$omitEmpty": {
                      "$map": {
                        "from": {
                          "$filter": {
                            "from": {
                              "$sortByOrder": {
                                "$ref": "request.images"
                              }
                            },
                            "as": "media",
                            "where": {
                              "$eq": [
                                {
                                  "$ref": "media.role"
                                },
                                "reference_image"
                              ]
                            }
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
                      "minimax-h3"
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
              },
              "audio_url": {
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
                      "minimax-h3"
                    ]
                  },
                  "then": {
                    "$omitEmpty": {
                      "$map": {
                        "from": {
                          "$sortByOrder": {
                            "$ref": "request.audios"
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
              },
              "reference_urls": {
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
                      "wan3.0-video-cankaosheng"
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
              },
              "file_url": {
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
                      "wan3.0-video-cankaosheng"
                    ]
                  },
                  "then": {
                    "$omitEmpty": {
                      "$ref": "request.providerOptions.lk888-video.file_url"
                    }
                  },
                  "else": null
                }
              },
              "link_url": {
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
                      "wan3.0-video-cankaosheng"
                    ]
                  },
                  "then": {
                    "$omitEmpty": {
                      "$ref": "request.providerOptions.lk888-video.link_url"
                    }
                  },
                  "else": null
                }
              },
              "version": {
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
                      "wan3.0-video-cankaosheng"
                    ]
                  },
                  "then": {
                    "$coalesce": [
                      {
                        "$ref": "request.providerOptions.lk888-video.version"
                      },
                      "standard"
                    ]
                  },
                  "else": null
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
                      "kling-v3-video"
                    ]
                  },
                  "then": {
                    "$if": {
                      "condition": {
                        "$gte": [
                          {
                            "$ref": "request.duration"
                          },
                          15
                        ]
                      },
                      "then": "15",
                      "else": {
                        "$if": {
                          "condition": {
                            "$gte": [
                              {
                                "$ref": "request.duration"
                              },
                              10
                            ]
                          },
                          "then": "10",
                          "else": "5"
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
                          "wan3.0-video-cankaosheng"
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
                          "else": "auto"
                        }
                      },
                      "else": {
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
                      }
                    }
                  }
                }
              },
              "aspect_ratio": {
                "$if": {
                  "condition": {
                    "$in": [
                      {
                        "$lower": {
                          "$trim": {
                            "$ref": "request.model"
                          }
                        }
                      },
                      [
                        "minimax-h3",
                        "kling-v3-video"
                      ]
                    ]
                  },
                  "then": {
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
                        "then": {
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
                                "minimax-h3"
                              ]
                            },
                            "then": "adaptive",
                            "else": null
                          }
                        },
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
                            "then": null,
                            "else": {
                              "$ref": "request.aspectRatio"
                            }
                          }
                        }
                      }
                    }
                  },
                  "else": null
                }
              },
              "ratio": {
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
                      "wan3.0-video-cankaosheng"
                    ]
                  },
                  "then": {
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
                      "minimax-h3"
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
                                "4k",
                                "2160",
                                "2160p"
                              ]
                            ]
                          },
                          "then": "4K"
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
                                "2k",
                                "1440",
                                "1440p"
                              ]
                            ]
                          },
                          "then": "2K"
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
                                "high"
                              ]
                            ]
                          },
                          "then": "1080P"
                        }
                      ],
                      "default": "768P"
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
                          "wan3.0-video-cankaosheng"
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
                                    "2k",
                                    "4k",
                                    "high"
                                  ]
                                ]
                              },
                              "then": "1080P"
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
                                    "720p",
                                    "720",
                                    "hd",
                                    "medium"
                                  ]
                                ]
                              },
                              "then": "720P"
                            }
                          ],
                          "default": "480P"
                        }
                      },
                      "else": null
                    }
                  }
                }
              },
              "audio": {
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
                      "wan3.0-video-cankaosheng"
                    ]
                  },
                  "then": {
                    "$ref": "request.generateAudio"
                  },
                  "else": null
                }
              },
              "prompt_extend": {
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
                      "wan3.0-video-cankaosheng"
                    ]
                  },
                  "then": {
                    "$omitEmpty": {
                      "$ref": "request.providerOptions.lk888-video.prompt_extend"
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
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
