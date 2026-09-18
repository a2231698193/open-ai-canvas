# 问鼎 LK888 Image 接口字段

## 协议身份

- 插件 ID：`lk888-image`。
- Provider ID：`lk888-image`。
- 能力：`image`。
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
| `model` | string | 是 | `model` | `tt-image-2` / `banana-pro` / `doubao-seedream-5-0-pro-260628`。 |
| `prompt` | string | 是 | `prompt` | 图片提示词。 |
| `images` | media[] | 否 | `params.images` | 参考图，支持公网 URL 或 data URL。 |
| `imageCount` | integer | 否 | `params.n` | 输出数量。 |
| `aspectRatio` | string | 否 | `params.size` / `params.aspectRatio` / `params.aspect_ratio` | tt-image-2 映射像素；banana-pro 用比例；即梦用 `aspect_ratio`。 |
| `resolution` | string | 否 | `params.size` / `params.imageSize` | 与 `quality` 一起决定尺寸档。 |
| `quality` | string | 否 | `params.size` / `params.imageSize` | 画布 1k/2k/4k 用于尺寸档，不直接传上游 `quality`。 |
| `providerOptions` | object | 否 | `params.quality` | 命名空间 `lk888-image` 内的扩展字段。 |

## 上游请求模板逐字段清单

下表由插件请求模板生成，覆盖 body、query、headers 和 multipart 文件声明中的每个字段。

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/v1/media/generate"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `request.model` |
| `create.body.prompt` | `request.prompt` |
| `create.body.params.images` | 参考图 URL / data URL 列表 |
| `create.body.params.n` | `request.imageCount` |
| `create.body.params.size` | tt-image-2：像素或 `auto`；即梦：`1K`/`2K` |
| `create.body.params.quality` | 仅 tt-image-2，`providerOptions.lk888-image.quality` |
| `create.body.params.aspectRatio` | 仅 banana-pro |
| `create.body.params.imageSize` | 仅 banana-pro：`1K`/`2K`/`4K` |
| `create.body.params.aspect_ratio` | 仅即梦 5.0 Pro |
| `poll.method` | `"GET"` |
| `poll.path` | `"/v1/media/status"` |
| `poll.query.task_id` | `taskId` |

## Provider 扩展键

- `lk888-image.quality`：问鼎 `auto` / `high` / `medium` / `low`。画布 1K/2K/4K 不写入该字段。

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.taskId` | `response.data.task_id` / `response.task_id` |
| `response.status` | `response.state` |
| `response.message` | `response.error` / `response.msg` |
| `response.images` | `response.result_url` |
| `response.resultEphemeral` | `true` |

## 响应与错误

创建成功返回 `data.task_id`（可能是数字）。轮询用 `state`：`pending` / `running` / `success` / `failed`，终态以 `is_final` 为准但宿主按 `state` 归一化。成功后从 `result_url` 取图。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。

## 兼容边界

问鼎图片异步接口：创建 `/v1/media/generate`，查询 `/v1/media/status?task_id=`。按 `request.model` 切换 params：`tt-image-2` 的 `size` 必须是像素或 `auto`（`16:9`+2K → `2560x1440`）；`banana-pro` 用 `aspectRatio`+`imageSize`；即梦用档位 `size`（`1K`/`2K`）和 `aspect_ratio`。画布 1K/2K/4K 只选尺寸档。OpenAI / Gemini 同步端点不在本协议内。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "lk888-image",
  "name": "问鼎 LK888 Image",
  "version": "1.0.0",
  "author": "问鼎数据 / 影策",
  "description": "问鼎数据图片异步任务协议，覆盖 tt-image-2、banana-pro、doubao-seedream-5-0-pro-260628。",
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
        "id": "lk888-image",
        "label": "问鼎 LK888 Image",
        "capabilities": [
          "image"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://api.lk888.ai",
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
            "description": "图片模型 ID：tt-image-2、banana-pro、doubao-seedream-5-0-pro-260628。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "图片提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "params.images",
            "description": "参考图，支持公网 URL 或 data URL。"
          },
          {
            "name": "imageCount",
            "type": "integer",
            "required": false,
            "mapping": "params.n",
            "description": "输出数量。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "params.size / params.aspectRatio / params.aspect_ratio",
            "description": "比例或像素。tt-image-2 映射像素 size；banana-pro 用 aspectRatio；即梦 5.0 Pro 用 aspect_ratio。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "params.size / params.imageSize",
            "description": "分辨率档位。"
          },
          {
            "name": "quality",
            "type": "string",
            "required": false,
            "mapping": "params.size / params.imageSize",
            "description": "画布 1k/2k/4k 用于尺寸档位。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "params.quality",
            "description": "命名空间 lk888-image 的扩展字段。"
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
              "images": {
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
                          "$ne": [
                            {
                              "$ref": "media.role"
                            },
                            "mask"
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
              "n": {
                "$omitEmpty": {
                  "$if": {
                    "condition": {
                      "$gt": [
                        {
                          "$ref": "request.imageCount"
                        },
                        0
                      ]
                    },
                    "then": {
                      "$ref": "request.imageCount"
                    },
                    "else": null
                  }
                }
              },
              "size": {
                "$switch": {
                  "cases": [
                    {
                      "when": {
                        "$in": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "request.model"
                              }
                            }
                          },
                          [
                            "tt-image-2"
                          ]
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
                                "auto"
                              ]
                            ]
                          },
                          "then": "auto",
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
                              "then": {
                                "$ref": "request.aspectRatio"
                              },
                              "else": {
                                "$switch": {
                                  "cases": [
                                    {
                                      "when": {
                                        "$in": [
                                          {
                                            "$lower": {
                                              "$trim": {
                                                "$coalesce": [
                                                  {
                                                    "$ref": "request.quality"
                                                  },
                                                  {
                                                    "$ref": "request.resolution"
                                                  }
                                                ]
                                              }
                                            }
                                          },
                                          [
                                            "2k",
                                            "medium",
                                            "hd"
                                          ]
                                        ]
                                      },
                                      "then": {
                                        "$switch": {
                                          "cases": [
                                            {
                                              "when": {
                                                "$eq": [
                                                  {
                                                    "$ref": "request.aspectRatio"
                                                  },
                                                  "1:1"
                                                ]
                                              },
                                              "then": "2048x2048"
                                            },
                                            {
                                              "when": {
                                                "$eq": [
                                                  {
                                                    "$ref": "request.aspectRatio"
                                                  },
                                                  "2:3"
                                                ]
                                              },
                                              "then": "2048x3072"
                                            },
                                            {
                                              "when": {
                                                "$eq": [
                                                  {
                                                    "$ref": "request.aspectRatio"
                                                  },
                                                  "3:2"
                                                ]
                                              },
                                              "then": "3072x2048"
                                            },
                                            {
                                              "when": {
                                                "$eq": [
                                                  {
                                                    "$ref": "request.aspectRatio"
                                                  },
                                                  "3:4"
                                                ]
                                              },
                                              "then": "1920x2560"
                                            },
                                            {
                                              "when": {
                                                "$eq": [
                                                  {
                                                    "$ref": "request.aspectRatio"
                                                  },
                                                  "4:3"
                                                ]
                                              },
                                              "then": "2560x1920"
                                            },
                                            {
                                              "when": {
                                                "$eq": [
                                                  {
                                                    "$ref": "request.aspectRatio"
                                                  },
                                                  "9:16"
                                                ]
                                              },
                                              "then": "1440x2560"
                                            },
                                            {
                                              "when": {
                                                "$eq": [
                                                  {
                                                    "$ref": "request.aspectRatio"
                                                  },
                                                  "16:9"
                                                ]
                                              },
                                              "then": "2560x1440"
                                            },
                                            {
                                              "when": {
                                                "$eq": [
                                                  {
                                                    "$ref": "request.aspectRatio"
                                                  },
                                                  "4:5"
                                                ]
                                              },
                                              "then": "2048x2560"
                                            },
                                            {
                                              "when": {
                                                "$eq": [
                                                  {
                                                    "$ref": "request.aspectRatio"
                                                  },
                                                  "5:4"
                                                ]
                                              },
                                              "then": "2560x2048"
                                            },
                                            {
                                              "when": {
                                                "$eq": [
                                                  {
                                                    "$ref": "request.aspectRatio"
                                                  },
                                                  "21:9"
                                                ]
                                              },
                                              "then": "2560x1280"
                                            }
                                          ],
                                          "default": "auto"
                                        }
                                      }
                                    },
                                    {
                                      "when": {
                                        "$in": [
                                          {
                                            "$lower": {
                                              "$trim": {
                                                "$coalesce": [
                                                  {
                                                    "$ref": "request.quality"
                                                  },
                                                  {
                                                    "$ref": "request.resolution"
                                                  }
                                                ]
                                              }
                                            }
                                          },
                                          [
                                            "4k",
                                            "high"
                                          ]
                                        ]
                                      },
                                      "then": {
                                        "$switch": {
                                          "cases": [
                                            {
                                              "when": {
                                                "$eq": [
                                                  {
                                                    "$ref": "request.aspectRatio"
                                                  },
                                                  "1:1"
                                                ]
                                              },
                                              "then": "2880x2880"
                                            },
                                            {
                                              "when": {
                                                "$eq": [
                                                  {
                                                    "$ref": "request.aspectRatio"
                                                  },
                                                  "2:3"
                                                ]
                                              },
                                              "then": "2304x3456"
                                            },
                                            {
                                              "when": {
                                                "$eq": [
                                                  {
                                                    "$ref": "request.aspectRatio"
                                                  },
                                                  "3:2"
                                                ]
                                              },
                                              "then": "3456x2304"
                                            },
                                            {
                                              "when": {
                                                "$eq": [
                                                  {
                                                    "$ref": "request.aspectRatio"
                                                  },
                                                  "3:4"
                                                ]
                                              },
                                              "then": "2400x3200"
                                            },
                                            {
                                              "when": {
                                                "$eq": [
                                                  {
                                                    "$ref": "request.aspectRatio"
                                                  },
                                                  "4:3"
                                                ]
                                              },
                                              "then": "3200x2400"
                                            },
                                            {
                                              "when": {
                                                "$eq": [
                                                  {
                                                    "$ref": "request.aspectRatio"
                                                  },
                                                  "9:16"
                                                ]
                                              },
                                              "then": "2160x3840"
                                            },
                                            {
                                              "when": {
                                                "$eq": [
                                                  {
                                                    "$ref": "request.aspectRatio"
                                                  },
                                                  "16:9"
                                                ]
                                              },
                                              "then": "3840x2160"
                                            },
                                            {
                                              "when": {
                                                "$eq": [
                                                  {
                                                    "$ref": "request.aspectRatio"
                                                  },
                                                  "4:5"
                                                ]
                                              },
                                              "then": "2560x3200"
                                            },
                                            {
                                              "when": {
                                                "$eq": [
                                                  {
                                                    "$ref": "request.aspectRatio"
                                                  },
                                                  "5:4"
                                                ]
                                              },
                                              "then": "3200x2560"
                                            },
                                            {
                                              "when": {
                                                "$eq": [
                                                  {
                                                    "$ref": "request.aspectRatio"
                                                  },
                                                  "21:9"
                                                ]
                                              },
                                              "then": "3840x1920"
                                            }
                                          ],
                                          "default": "auto"
                                        }
                                      }
                                    }
                                  ],
                                  "default": {
                                    "$switch": {
                                      "cases": [
                                        {
                                          "when": {
                                            "$eq": [
                                              {
                                                "$ref": "request.aspectRatio"
                                              },
                                              "1:1"
                                            ]
                                          },
                                          "then": "1024x1024"
                                        },
                                        {
                                          "when": {
                                            "$eq": [
                                              {
                                                "$ref": "request.aspectRatio"
                                              },
                                              "2:3"
                                            ]
                                          },
                                          "then": "1024x1536"
                                        },
                                        {
                                          "when": {
                                            "$eq": [
                                              {
                                                "$ref": "request.aspectRatio"
                                              },
                                              "3:2"
                                            ]
                                          },
                                          "then": "1536x1024"
                                        },
                                        {
                                          "when": {
                                            "$eq": [
                                              {
                                                "$ref": "request.aspectRatio"
                                              },
                                              "3:4"
                                            ]
                                          },
                                          "then": "960x1280"
                                        },
                                        {
                                          "when": {
                                            "$eq": [
                                              {
                                                "$ref": "request.aspectRatio"
                                              },
                                              "4:3"
                                            ]
                                          },
                                          "then": "1280x960"
                                        },
                                        {
                                          "when": {
                                            "$eq": [
                                              {
                                                "$ref": "request.aspectRatio"
                                              },
                                              "9:16"
                                            ]
                                          },
                                          "then": "1088x1920"
                                        },
                                        {
                                          "when": {
                                            "$eq": [
                                              {
                                                "$ref": "request.aspectRatio"
                                              },
                                              "16:9"
                                            ]
                                          },
                                          "then": "1920x1088"
                                        },
                                        {
                                          "when": {
                                            "$eq": [
                                              {
                                                "$ref": "request.aspectRatio"
                                              },
                                              "4:5"
                                            ]
                                          },
                                          "then": "1024x1280"
                                        },
                                        {
                                          "when": {
                                            "$eq": [
                                              {
                                                "$ref": "request.aspectRatio"
                                              },
                                              "5:4"
                                            ]
                                          },
                                          "then": "1280x1024"
                                        },
                                        {
                                          "when": {
                                            "$eq": [
                                              {
                                                "$ref": "request.aspectRatio"
                                              },
                                              "21:9"
                                            ]
                                          },
                                          "then": "1920x960"
                                        }
                                      ],
                                      "default": "auto"
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    },
                    {
                      "when": {
                        "$in": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "request.model"
                              }
                            }
                          },
                          [
                            "doubao-seedream-5-0-pro-260628"
                          ]
                        ]
                      },
                      "then": {
                        "$omitEmpty": {
                          "$switch": {
                            "cases": [
                              {
                                "when": {
                                  "$in": [
                                    {
                                      "$lower": {
                                        "$trim": {
                                          "$coalesce": [
                                            {
                                              "$ref": "request.quality"
                                            },
                                            {
                                              "$ref": "request.resolution"
                                            }
                                          ]
                                        }
                                      }
                                    },
                                    [
                                      "2k",
                                      "medium",
                                      "hd",
                                      "4k",
                                      "high"
                                    ]
                                  ]
                                },
                                "then": "2K"
                              }
                            ],
                            "default": "1K"
                          }
                        }
                      }
                    },
                    {
                      "when": {
                        "$in": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "request.model"
                              }
                            }
                          },
                          [
                            "qwen-image"
                          ]
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
                                "auto"
                              ]
                            ]
                          },
                          "then": "1:1",
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
                              "then": "1:1",
                              "else": {
                                "$ref": "request.aspectRatio"
                              }
                            }
                          }
                        }
                      }
                    },
                    {
                      "when": {
                        "$in": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "request.model"
                              }
                            }
                          },
                          [
                            "doubao-seedream-5-0-260128"
                          ]
                        ]
                      },
                      "then": {
                        "$omitEmpty": {
                          "$switch": {
                            "cases": [
                              {
                                "when": {
                                  "$in": [
                                    {
                                      "$lower": {
                                        "$trim": {
                                          "$coalesce": [
                                            {
                                              "$ref": "request.quality"
                                            },
                                            {
                                              "$ref": "request.resolution"
                                            }
                                          ]
                                        }
                                      }
                                    },
                                    [
                                      "3k",
                                      "high"
                                    ]
                                  ]
                                },
                                "then": "3K"
                              }
                            ],
                            "default": "2K"
                          }
                        }
                      }
                    }
                  ],
                  "default": null
                }
              },
              "quality": {
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
                        "tt-image-2",
                        "tt-image-2.5"
                      ]
                    ]
                  },
                  "then": {
                    "$omitEmpty": {
                      "$ref": "request.providerOptions.lk888-image.quality"
                    }
                  },
                  "else": null
                }
              },
              "aspectRatio": {
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
                        "banana-pro",
                        "banana-2"
                      ]
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
                            "auto"
                          ]
                        ]
                      },
                      "then": "1:1",
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
                          "then": "1:1",
                          "else": {
                            "$ref": "request.aspectRatio"
                          }
                        }
                      }
                    }
                  },
                  "else": null
                }
              },
              "imageSize": {
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
                        "banana-pro",
                        "banana-2"
                      ]
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
                                    "$coalesce": [
                                      {
                                        "$ref": "request.quality"
                                      },
                                      {
                                        "$ref": "request.resolution"
                                      }
                                    ]
                                  }
                                }
                              },
                              [
                                "0.5k",
                                "low"
                              ]
                            ]
                          },
                          "then": "0.5K"
                        },
                        {
                          "when": {
                            "$in": [
                              {
                                "$lower": {
                                  "$trim": {
                                    "$coalesce": [
                                      {
                                        "$ref": "request.quality"
                                      },
                                      {
                                        "$ref": "request.resolution"
                                      }
                                    ]
                                  }
                                }
                              },
                              [
                                "4k",
                                "high"
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
                                    "$coalesce": [
                                      {
                                        "$ref": "request.quality"
                                      },
                                      {
                                        "$ref": "request.resolution"
                                      }
                                    ]
                                  }
                                }
                              },
                              [
                                "2k",
                                "medium",
                                "hd"
                              ]
                            ]
                          },
                          "then": "2K"
                        }
                      ],
                      "default": "1K"
                    }
                  },
                  "else": null
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
                        "doubao-seedream-5-0-pro-260628",
                        "doubao-seedream-5-0-260128",
                        "tt-image-2.5"
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
                        "then": null,
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
              "resolution": {
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
                        "tt-image-2.5"
                      ]
                    ]
                  },
                  "then": {
                    "$omitEmpty": {
                      "$switch": {
                        "cases": [
                          {
                            "when": {
                              "$in": [
                                {
                                  "$lower": {
                                    "$trim": {
                                      "$coalesce": [
                                        {
                                          "$ref": "request.quality"
                                        },
                                        {
                                          "$ref": "request.resolution"
                                        }
                                      ]
                                    }
                                  }
                                },
                                [
                                  "4k",
                                  "high"
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
                                      "$coalesce": [
                                        {
                                          "$ref": "request.quality"
                                        },
                                        {
                                          "$ref": "request.resolution"
                                        }
                                      ]
                                    }
                                  }
                                },
                                [
                                  "2k",
                                  "medium",
                                  "hd"
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
                                      "$coalesce": [
                                        {
                                          "$ref": "request.quality"
                                        },
                                        {
                                          "$ref": "request.resolution"
                                        }
                                      ]
                                    }
                                  }
                                },
                                [
                                  "1k"
                                ]
                              ]
                            },
                            "then": "1K"
                          },
                          {
                            "when": {
                              "$in": [
                                {
                                  "$lower": {
                                    "$trim": {
                                      "$coalesce": [
                                        {
                                          "$ref": "request.quality"
                                        },
                                        {
                                          "$ref": "request.resolution"
                                        }
                                      ]
                                    }
                                  }
                                },
                                [
                                  "auto",
                                  ""
                                ]
                              ]
                            },
                            "then": "auto"
                          }
                        ],
                        "default": null
                      }
                    }
                  },
                  "else": null
                }
              },
              "version": {
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
                        "tt-image-2.5"
                      ]
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
                                    "$toString": {
                                      "$ref": "request.providerOptions.lk888-image.version"
                                    }
                                  }
                                }
                              },
                              [
                                "sunburst",
                                "enhanced",
                                "增强版"
                              ]
                            ]
                          },
                          "then": "sunburst"
                        }
                      ],
                      "default": "flare"
                    }
                  },
                  "else": null
                }
              },
              "background": {
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
                        "tt-image-2.5"
                      ]
                    ]
                  },
                  "then": {
                    "$omitEmpty": {
                      "$switch": {
                        "cases": [
                          {
                            "when": {
                              "$in": [
                                {
                                  "$lower": {
                                    "$trim": {
                                      "$toString": {
                                        "$ref": "request.providerOptions.lk888-image.background"
                                      }
                                    }
                                  }
                                },
                                [
                                  "transparent",
                                  "opaque",
                                  "auto"
                                ]
                              ]
                            },
                            "then": {
                              "$lower": {
                                "$trim": {
                                  "$toString": {
                                    "$ref": "request.providerOptions.lk888-image.background"
                                  }
                                }
                              }
                            }
                          },
                          {
                            "when": {
                              "$in": [
                                {
                                  "$lower": {
                                    "$trim": {
                                      "$toString": {
                                        "$coalesce": [
                                          {
                                            "$ref": "request.extra.transparentBackground"
                                          },
                                          {
                                            "$ref": "request.extra.background"
                                          }
                                        ]
                                      }
                                    }
                                  }
                                },
                                [
                                  "true",
                                  "transparent"
                                ]
                              ]
                            },
                            "then": "transparent"
                          }
                        ],
                        "default": null
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
          "images": {
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
