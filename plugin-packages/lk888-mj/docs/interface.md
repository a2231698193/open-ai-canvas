# 问鼎 LK888 Midjourney 接口字段

## 协议身份

- 插件 ID：`lk888-mj`。
- Provider ID：`lk888-mj`。
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
| `model` | string | 是 | `model` | 固定 `mj_imagine`。 |
| `prompt` | string | 是 | `prompt` | 图片提示词。顶层或 `params.prompt` 任传其一，本协议按顶层提交。 |
| `images` | media[] | 否 | `params.images` | 垫图，1~4 张；必须传数组，支持公网 URL 或 data URL。 |
| `aspectRatio` | string | 否 | `params.aspectRatio` | 上游必填。画布比例命中上游枚举时原样提交，否则回落扩展键，最后回落 `1:1`。 |
| `botType` | string | 否 | `params.botType` | 上游必填。默认 `MID_JOURNEY`，可用扩展键切成 Niji。 |
| `quality` | string | 否 | `params.quality` | 上游图片精细度，只接受 `0.25` / `0.5` / `1` / `2`，且只来自扩展键。 |
| `stylize` | string | 否 | `params.stylize` | 艺术风格强度，只来自扩展键。 |
| `chaos` | string | 否 | `params.chaos` | 变化多样性，只来自扩展键。 |
| `style` | string | 否 | `params.style` | 只识别 `raw`，其它取值不提交。 |
| `providerOptions` | object | 否 | `params.botType` / `params.quality` / `params.stylize` / `params.chaos` / `params.style` | 命名空间 `lk888-mj` 的扩展字段。 |

## 上游请求模板逐字段清单

下表由插件请求模板生成，覆盖 body、query、headers 和 multipart 文件声明中的每个字段。

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/v1/media/generate"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `request.model` |
| `create.body.prompt` | `request.prompt` |
| `create.body.params.images` | 参考图 URL / data URL 列表（数组） |
| `create.body.params.botType` | `providerOptions.lk888-mj.botType` 命中 niji 时 `NIJI_JOURNEY`，否则 `MID_JOURNEY` |
| `create.body.params.aspectRatio` | 画布比例 → `providerOptions.lk888-mj.aspectRatio` → `1:1` |
| `create.body.params.quality` | `providerOptions.lk888-mj.quality`，仅 `0.25`/`0.5`/`1`/`2` |
| `create.body.params.stylize` | `providerOptions.lk888-mj.stylize`，仅 `0`/`50`/`100`/`250`/`500`/`750`/`1000` |
| `create.body.params.chaos` | `providerOptions.lk888-mj.chaos`，仅 `0`/`25`/`50`/`75`/`100` |
| `create.body.params.style` | `providerOptions.lk888-mj.style`，仅 `raw` |
| `poll.method` | `"GET"` |
| `poll.path` | `"/v1/media/status"` |
| `poll.query.task_id` | `taskId` |

## Provider 扩展键

- `lk888-mj.botType`：`mj` / `niji` / `mid_journey` / `niji_journey`，大小写与下划线不敏感；只有 Niji 系取值会改变默认模式。
- `lk888-mj.aspectRatio`：画布比例不是 `1:1` / `16:9` / `9:16` / `4:3` / `3:4` / `3:2` / `2:3` / `4:5` / `5:4` / `21:9` 时的回落值。
- `lk888-mj.quality`：`0.25` / `0.5` / `1` / `2`。画布的 `1k` / `2k` / `4k` 不属于该参数，传了也不会写入上游。
- `lk888-mj.stylize`：`0` / `50` / `100` / `250` / `500` / `750` / `1000`。
- `lk888-mj.chaos`：`0` / `25` / `50` / `75` / `100`。
- `lk888-mj.style`：`raw`；留空即上游默认风格。

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.taskId` | `response.data.task_id` / `response.task_id` |
| `response.status` | `response.state` |
| `response.message` | `response.error` |
| `response.images` | `response.result_url` |
| `response.resultEphemeral` | `true` |

## 响应与错误

创建成功返回 `{"code":200,"data":{"task_id":123456},"msg":"任务创建成功"}`，`task_id` 可能是数字。轮询用 `state`：`pending` / `running` / `success` / `failed`，终态以 `is_final` 为准但宿主按 `state` 归一化。成功后从 `result_url` 取图。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。

## 兼容边界

问鼎 Midjourney 异步接口与图片协议同形：创建 `/v1/media/generate`，查询 `/v1/media/status?task_id=`，因此与 `lk888-image` 分开成包只为参数集不同，不是因为换了上游协议。

- 上游 `params` 必填 `botType` 与 `aspectRatio`，两者都在本协议内兜底，调用方不传也能提交。
- `quality` 语义与画布不同：画布 `1k` / `2k` / `4k` 是尺寸档，Midjourney 的 `quality` 是图片精细度，因此不互相映射。
- Midjourney 没有 `size` / `resolution` / `n` 参数，输出数量由上游决定，画布数量参数不会提交到上游。
- 上游没有版本参数，实际命中的 Midjourney 版本由平台渠道决定，协议层无法指定。
- OpenAI 兼容端点 `/v1/images/generations` 不覆盖该模型，图片一律走异步创建 + 轮询。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "lk888-mj",
  "name": "问鼎 LK888 Midjourney",
  "version": "1.0.0",
  "author": "问鼎数据 / 影策",
  "description": "问鼎数据 Midjourney 图片异步任务协议，覆盖 mj_imagine：MJ / Niji 两种模式、10 档画面比例、可选的 quality / stylize / chaos / style 与 1~4 张垫图。",
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
        "id": "lk888-mj",
        "label": "问鼎 LK888 Midjourney",
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
            "description": "上游模型 ID，固定填 mj_imagine。"
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
            "description": "垫图参考，1~4 张，必须传数组；支持公网 URL 或 data URL。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "params.aspectRatio",
            "values": [
              "1:1",
              "16:9",
              "9:16",
              "4:3",
              "3:4",
              "3:2",
              "2:3",
              "4:5",
              "5:4",
              "21:9"
            ],
            "description": "画面比例，上游必填。画布比例命中枚举时原样提交，否则回落 providerOptions.lk888-mj.aspectRatio，最后回落 1:1。"
          },
          {
            "name": "botType",
            "type": "string",
            "required": false,
            "mapping": "params.botType",
            "values": [
              "MID_JOURNEY",
              "NIJI_JOURNEY"
            ],
            "description": "MJ 写实模式 / Niji 动漫模式，上游必填。默认 MID_JOURNEY，用 providerOptions.lk888-mj.botType 覆盖（接受 mj / niji / mid_journey / niji_journey）。"
          },
          {
            "name": "quality",
            "type": "string",
            "required": false,
            "mapping": "params.quality",
            "values": [
              "0.25",
              "0.5",
              "1",
              "2"
            ],
            "description": "上游图片精细度，仅从 providerOptions.lk888-mj.quality 读取；画布的 1k / 2k / 4k 档位不写入该字段。非这些取值一律不提交。"
          },
          {
            "name": "stylize",
            "type": "string",
            "required": false,
            "mapping": "params.stylize",
            "values": [
              "0",
              "50",
              "100",
              "250",
              "500",
              "750",
              "1000"
            ],
            "description": "艺术风格强度，取值来自 providerOptions.lk888-mj.stylize，范围外的值不提交。"
          },
          {
            "name": "chaos",
            "type": "string",
            "required": false,
            "mapping": "params.chaos",
            "values": [
              "0",
              "25",
              "50",
              "75",
              "100"
            ],
            "description": "变化多样性，取值来自 providerOptions.lk888-mj.chaos，范围外的值不提交。"
          },
          {
            "name": "style",
            "type": "string",
            "required": false,
            "mapping": "params.style",
            "values": [
              "raw"
            ],
            "description": "上游风格模式，仅识别 providerOptions.lk888-mj.style=raw；其它取值不提交，走上游默认风格。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "params.botType / params.quality / params.stylize / params.chaos / params.style",
            "description": "命名空间 lk888-mj 的扩展字段。"
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
              "botType": {
                "$switch": {
                  "cases": [
                    {
                      "when": {
                        "$in": [
                          {
                            "$lower": {
                              "$trim": {
                                "$toString": {
                                  "$ref": "request.providerOptions.lk888-mj.botType"
                                }
                              }
                            }
                          },
                          [
                            "niji",
                            "niji_journey",
                            "niji-journey",
                            "niji_journey_mode"
                          ]
                        ]
                      },
                      "then": "NIJI_JOURNEY"
                    }
                  ],
                  "default": "MID_JOURNEY"
                }
              },
              "aspectRatio": {
                "$if": {
                  "condition": {
                    "$in": [
                      {
                        "$trim": {
                          "$ref": "request.aspectRatio"
                        }
                      },
                      [
                        "1:1",
                        "16:9",
                        "9:16",
                        "4:3",
                        "3:4",
                        "3:2",
                        "2:3",
                        "4:5",
                        "5:4",
                        "21:9"
                      ]
                    ]
                  },
                  "then": {
                    "$trim": {
                      "$ref": "request.aspectRatio"
                    }
                  },
                  "else": {
                    "$if": {
                      "condition": {
                        "$in": [
                          {
                            "$trim": {
                              "$ref": "request.providerOptions.lk888-mj.aspectRatio"
                            }
                          },
                          [
                            "1:1",
                            "16:9",
                            "9:16",
                            "4:3",
                            "3:4",
                            "3:2",
                            "2:3",
                            "4:5",
                            "5:4",
                            "21:9"
                          ]
                        ]
                      },
                      "then": {
                        "$trim": {
                          "$ref": "request.providerOptions.lk888-mj.aspectRatio"
                        }
                      },
                      "else": "1:1"
                    }
                  }
                }
              },
              "quality": {
                "$omitEmpty": {
                  "$switch": {
                    "cases": [
                      {
                        "when": {
                          "$in": [
                            {
                              "$trim": {
                                "$toString": {
                                  "$ref": "request.providerOptions.lk888-mj.quality"
                                }
                              }
                            },
                            [
                              "0.25",
                              "0.5",
                              "1",
                              "2"
                            ]
                          ]
                        },
                        "then": {
                          "$trim": {
                            "$toString": {
                              "$ref": "request.providerOptions.lk888-mj.quality"
                            }
                          }
                        }
                      }
                    ],
                    "default": null
                  }
                }
              },
              "stylize": {
                "$omitEmpty": {
                  "$switch": {
                    "cases": [
                      {
                        "when": {
                          "$in": [
                            {
                              "$trim": {
                                "$toString": {
                                  "$ref": "request.providerOptions.lk888-mj.stylize"
                                }
                              }
                            },
                            [
                              "0",
                              "50",
                              "100",
                              "250",
                              "500",
                              "750",
                              "1000"
                            ]
                          ]
                        },
                        "then": {
                          "$trim": {
                            "$toString": {
                              "$ref": "request.providerOptions.lk888-mj.stylize"
                            }
                          }
                        }
                      }
                    ],
                    "default": null
                  }
                }
              },
              "chaos": {
                "$omitEmpty": {
                  "$switch": {
                    "cases": [
                      {
                        "when": {
                          "$in": [
                            {
                              "$trim": {
                                "$toString": {
                                  "$ref": "request.providerOptions.lk888-mj.chaos"
                                }
                              }
                            },
                            [
                              "0",
                              "25",
                              "50",
                              "75",
                              "100"
                            ]
                          ]
                        },
                        "then": {
                          "$trim": {
                            "$toString": {
                              "$ref": "request.providerOptions.lk888-mj.chaos"
                            }
                          }
                        }
                      }
                    ],
                    "default": null
                  }
                }
              },
              "style": {
                "$omitEmpty": {
                  "$if": {
                    "condition": {
                      "$eq": [
                        {
                          "$lower": {
                            "$trim": {
                              "$toString": {
                                "$ref": "request.providerOptions.lk888-mj.style"
                              }
                            }
                          }
                        },
                        "raw"
                      ]
                    },
                    "then": "raw",
                    "else": null
                  }
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
