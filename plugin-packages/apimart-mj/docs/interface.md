# APIMart Midjourney 接口字段

## 协议身份

- 插件 ID：`apimart-mj`。
- Provider ID：`apimart-mj`。
- 能力：`image`。
- 默认 Base URL：`https://api.apimart.ai`。
- 鉴权驱动：`bearer`。
- 创建：`POST /v1/midjourney/generations`。
- 查询：`GET /v1/midjourney/{{taskId}}`。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `不提交` | 该协议不提交 model；上游按 /v1/midjourney 路由自动注入 model=midjourney。 |
| `prompt` | string | 是 | `prompt` | 提示词，支持原生 MJ 参数（如 --ar 16:9）。 |
| `images` | media[] | 否 | `image_urls` | 垫图参考，按 order 排序提交；上游单图上限 12MiB。 |
| `aspectRatio` | string | 否 | `size` | 画面比例，命中枚举时写入 size，否则交由上游默认。 |
| `providerOptions` | object | 否 | `version / niji / speed` | 命名空间 apimart-mj 的扩展字段。 |

## 上游请求模板逐字段清单

下表由插件请求模板生成，覆盖 body、query、headers 和 multipart 文件声明中的每个字段。

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/v1/midjourney/generations"` |
| `create.contentType` | `"application/json"` |
| `create.body.prompt` | `{"$omitEmpty":{"$ref":"request.prompt"}}` |
| `create.body.image_urls` | `{"$omitEmpty":{"$map":{"from":{"$filter":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","where":{"$ne":[{"$ref":"media.role"},"mask"]}}},"as":"media","in":{"$ref":"media.value"}}}}` |
| `create.body.size` | `{"$omitEmpty":{"$if":{"condition":{"$in":[{"$trim":{"$ref":"request.aspectRatio"}},["1:1","2:1","1:2","3:2","2:3","4:3","3:4","5:4","4:5","16:9","9:16","21:9","3:7"]]},"then":{"$trim":{"$ref":"request.aspectRatio"}},"else":null}}}` |
| `create.body.version` | `{"$omitEmpty":{"$if":{"condition":{"$in":[{"$lower":{"$trim":{"$toString":{"$ref":"request.providerOptions.apimart-mj.version"}}}},["8.2","8.1","8","7","6.1","6","5.2","5.1","5"]]},"then":{"$lower":{"$trim":{"$toString":{"$ref":"request.providerOptions.apimart-mj.version"}}}},"else":null}}}` |
| `create.body.niji` | `{"$omitEmpty":{"$if":{"condition":{"$in":[{"$lower":{"$trim":{"$toString":{"$ref":"request.providerOptions.apimart-mj.niji"}}}},["true","1","yes","on"]]},"then":true,"else":null}}}` |
| `create.body.speed` | `{"$omitEmpty":{"$if":{"condition":{"$in":[{"$lower":{"$trim":{"$toString":{"$ref":"request.providerOptions.apimart-mj.speed"}}}},["relax","fast","turbo"]]},"then":{"$lower":{"$trim":{"$toString":{"$ref":"request.providerOptions.apimart-mj.speed"}}}},"else":null}}}` |
| `poll.method` | `"GET"` |
| `poll.path` | `"/v1/midjourney/{{taskId}}"` |
| `poll.contentType` | `"application/json"` |

## Provider 扩展键

- `providerOptions.apimart-mj.niji`
- `providerOptions.apimart-mj.speed`
- `providerOptions.apimart-mj.version`

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.taskId` | `{"$coalesce":[{"$ref":"response.data.0.task_id"},{"$ref":"response.data.0.taskId"},{"$ref":"response.data.task_id"},{"$ref":"response.id"},{"$ref":"taskId"}]}` |
| `response.status` | `{"$coalesce":[{"$ref":"response.data.0.status"},{"$ref":"response.status"},"pending"]}` |
| `response.message` | `{"$coalesce":[{"$ref":"response.fail_reason"},{"$ref":"response.error.message"},{"$ref":"response.message"}]}` |
| `response.images` | `{"$coalesce":[{"$map":{"from":{"$ref":"response.image_urls"},"as":"image","in":{"$ref":"image"}}},{"$map":{"from":{"$ref":"response.data.0.image_urls"},"as":"image","in":{"$ref":"image"}}},{"$map":{"from":{"$ref":"response.data.result.images"},"as":"image","in":{"$at":[{"$ref":"image.url"},0]}}},{"$map":{"from":{"$ref":"response.data.images"},"as":"image","in":{"$at":[{"$ref":"image.url"},0]}}},{"$ref":"response.grid_image_url"},{"$ref":"response.data.result.image_url"},{"$ref":"response.data.image_url"},{"$ref":"response.image_url"}]}` |
| `response.errorPaths[0]` | `"error.code"` |
| `response.errorPaths[1]` | `"error.message"` |
| `response.errorPaths[2]` | `"response.error.message"` |
| `response.resultEphemeral` | `true` |
| `response.messagePaths[0]` | `"fail_reason"` |
| `response.messagePaths[1]` | `"error.message"` |
| `response.messagePaths[2]` | `"response.error.message"` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 兼容边界

APIMart Midjourney 独立路由协议，当前 profile 只覆盖 imagine（文生图与垫图）。创建 POST /v1/midjourney/generations，不提交 model；查询 GET /v1/midjourney/{task_id} 读取 image_urls 的四张单图。上游不校验 version，非法版本会先建任务再 FAILURE，因此版本与速度在 validations 层拦截。upscale / variation / blend / describe / edits / zoom / pan / inpaint / modal / video / remix 属于其他路由，必须另立 provider。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "apimart-mj",
  "name": "APIMart Midjourney",
  "version": "2.0.0",
  "author": "APIMart / 影策",
  "description": "APIMart Midjourney 独立请求协议插件。",
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
        "id": "apimart-mj",
        "label": "APIMart Midjourney",
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
        "baseUrl": "https://api.apimart.ai",
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
            "mapping": "不提交",
            "description": "该协议不提交 model；上游按 /v1/midjourney 路由自动注入 model=midjourney。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "提示词，支持原生 MJ 参数（如 --ar 16:9）。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "image_urls",
            "description": "垫图参考，按 order 排序提交；上游单图上限 12MiB。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "size",
            "description": "画面比例，命中枚举时写入 size，否则交由上游默认。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "version / niji / speed",
            "description": "命名空间 apimart-mj 的扩展字段。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$lower": {
                        "$trim": {
                          "$toString": {
                            "$ref": "request.providerOptions.apimart-mj.version"
                          }
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
                        "$trim": {
                          "$toString": {
                            "$ref": "request.providerOptions.apimart-mj.version"
                          }
                        }
                      }
                    },
                    [
                      "8.2",
                      "8.1",
                      "8",
                      "7",
                      "6.1",
                      "6",
                      "5.2",
                      "5.1",
                      "5"
                    ]
                  ]
                }
              ]
            },
            "message": "Midjourney version 必须是 8.2 / 8.1 / 8 / 7 / 6.1 / 6 / 5.2 / 5.1 / 5 之一"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$lower": {
                        "$trim": {
                          "$toString": {
                            "$ref": "request.providerOptions.apimart-mj.speed"
                          }
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
                        "$trim": {
                          "$toString": {
                            "$ref": "request.providerOptions.apimart-mj.speed"
                          }
                        }
                      }
                    },
                    [
                      "relax",
                      "fast",
                      "turbo"
                    ]
                  ]
                }
              ]
            },
            "message": "Midjourney speed 必须是 relax / fast / turbo 之一"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/midjourney/generations",
          "contentType": "application/json",
          "body": {
            "prompt": {
              "$omitEmpty": {
                "$ref": "request.prompt"
              }
            },
            "image_urls": {
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
            "size": {
              "$omitEmpty": {
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
                        "2:1",
                        "1:2",
                        "3:2",
                        "2:3",
                        "4:3",
                        "3:4",
                        "5:4",
                        "4:5",
                        "16:9",
                        "9:16",
                        "21:9",
                        "3:7"
                      ]
                    ]
                  },
                  "then": {
                    "$trim": {
                      "$ref": "request.aspectRatio"
                    }
                  },
                  "else": null
                }
              }
            },
            "version": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$in": [
                      {
                        "$lower": {
                          "$trim": {
                            "$toString": {
                              "$ref": "request.providerOptions.apimart-mj.version"
                            }
                          }
                        }
                      },
                      [
                        "8.2",
                        "8.1",
                        "8",
                        "7",
                        "6.1",
                        "6",
                        "5.2",
                        "5.1",
                        "5"
                      ]
                    ]
                  },
                  "then": {
                    "$lower": {
                      "$trim": {
                        "$toString": {
                          "$ref": "request.providerOptions.apimart-mj.version"
                        }
                      }
                    }
                  },
                  "else": null
                }
              }
            },
            "niji": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$in": [
                      {
                        "$lower": {
                          "$trim": {
                            "$toString": {
                              "$ref": "request.providerOptions.apimart-mj.niji"
                            }
                          }
                        }
                      },
                      [
                        "true",
                        "1",
                        "yes",
                        "on"
                      ]
                    ]
                  },
                  "then": true,
                  "else": null
                }
              }
            },
            "speed": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$in": [
                      {
                        "$lower": {
                          "$trim": {
                            "$toString": {
                              "$ref": "request.providerOptions.apimart-mj.speed"
                            }
                          }
                        }
                      },
                      [
                        "relax",
                        "fast",
                        "turbo"
                      ]
                    ]
                  },
                  "then": {
                    "$lower": {
                      "$trim": {
                        "$toString": {
                          "$ref": "request.providerOptions.apimart-mj.speed"
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
          "path": "/v1/midjourney/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.data.0.task_id"
              },
              {
                "$ref": "response.data.0.taskId"
              },
              {
                "$ref": "response.data.task_id"
              },
              {
                "$ref": "response.id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.data.0.status"
              },
              {
                "$ref": "response.status"
              },
              "pending"
            ]
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.fail_reason"
              },
              {
                "$ref": "response.error.message"
              },
              {
                "$ref": "response.message"
              }
            ]
          },
          "images": {
            "$coalesce": [
              {
                "$map": {
                  "from": {
                    "$ref": "response.image_urls"
                  },
                  "as": "image",
                  "in": {
                    "$ref": "image"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.data.0.image_urls"
                  },
                  "as": "image",
                  "in": {
                    "$ref": "image"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.data.result.images"
                  },
                  "as": "image",
                  "in": {
                    "$at": [
                      {
                        "$ref": "image.url"
                      },
                      0
                    ]
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.data.images"
                  },
                  "as": "image",
                  "in": {
                    "$at": [
                      {
                        "$ref": "image.url"
                      },
                      0
                    ]
                  }
                }
              },
              {
                "$ref": "response.grid_image_url"
              },
              {
                "$ref": "response.data.result.image_url"
              },
              {
                "$ref": "response.data.image_url"
              },
              {
                "$ref": "response.image_url"
              }
            ]
          },
          "errorPaths": [
            "error.code",
            "error.message",
            "response.error.message"
          ],
          "resultEphemeral": true,
          "messagePaths": [
            "fail_reason",
            "error.message",
            "response.error.message"
          ]
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
