# APIMart Image 接口字段

## 协议身份

- 插件 ID：`apimart-image`。
- Provider ID：`apimart-image`。
- 能力：`image`。
- 默认 Base URL：`https://api.apimart.ai`。
- 鉴权驱动：`bearer`。
- 创建：`POST /v1/images/generations`。
- 查询：`GET /v1/tasks/{{taskId}}`。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 图片模型 ID。 |
| `prompt` | string | 是 | `prompt` | 图片提示词。 |
| `images` | media[] | 否 | `provider image/reference fields` | 参考图或编辑源图，role 由业务层确定。 |
| `imageCount` | integer | 否 | `n/sample_count` | 输出数量。 |
| `aspectRatio` | string | 否 | `size/aspect_ratio` | 比例或尺寸，语义按协议说明。 |
| `resolution` | string | 否 | `resolution/imageSize` | 分辨率档位。 |
| `quality` | string | 否 | `quality` | 质量档位。 |
| `providerOptions` | object | 否 | `provider-specific fields` | 插件命名空间内的厂商扩展字段。 |

## 上游请求模板逐字段清单

下表由插件请求模板生成，覆盖 body、query、headers 和 multipart 文件声明中的每个字段。

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/v1/images/generations"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `{"$ref":"request.model"}` |
| `create.body.prompt` | `{"$omitEmpty":{"$ref":"request.prompt"}}` |
| `create.body.n` | `{"$omitEmpty":{"$if":{"condition":{"$gt":[{"$ref":"request.imageCount"},0]},"then":{"$ref":"request.imageCount"},"else":null}}}` |
| `create.body.size` | `{"$omitEmpty":{"$if":{"condition":{"$in":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},["","auto"]]},"then":null,"else":{"$ref":"request.aspectRatio"}}}}` |
| `create.body.resolution` | `{"$omitEmpty":{"$switch":{"cases":[{"when":{"$in":[{"$lower":{"$trim":{"$coalesce":[{"$ref":"request.quality"},{"$ref":"request.resolution"}]}}},["1k","low"]]},"then":"1k"},{"when":{"$in":[{"$lower":{"$trim":{"$coalesce":[{"$ref":"request.quality"},{"$ref":"request.resolution"}]}}},["2k","medium","hd"]]},"then":"2k"},{"when":{"$in":[{"$lower":{"$trim":{"$coalesce":[{"$ref":"request.quality"},{"$ref":"request.resolution"}]}}},["4k","high"]]},"then":"4k"},{"when":{"$in":[{"$lower":{"$trim":{"$coalesce":[{"$ref":"request.quality"},{"$ref":"request.resolution"}]}}},["","auto"]]},"then":null}],"default":{"$lower":{"$trim":{"$coalesce":[{"$ref":"request.quality"},{"$ref":"request.resolution"}]}}}}}}` |
| `create.body.image_urls` | `{"$omitEmpty":{"$map":{"from":{"$filter":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","where":{"$ne":[{"$ref":"media.role"},"mask"]}}},"as":"media","in":{"$ref":"media.value"}}}}` |
| `poll.method` | `"GET"` |
| `poll.path` | `"/v1/tasks/{{taskId}}"` |
| `poll.contentType` | `"application/json"` |

## Provider 扩展键

- 无额外扩展键。

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.taskId` | `{"$coalesce":[{"$ref":"response.data.0.task_id"},{"$ref":"response.data.0.taskId"},{"$ref":"response.data.task_id"},{"$ref":"response.task_id"},{"$ref":"taskId"}]}` |
| `response.status` | `{"$coalesce":[{"$ref":"response.data.0.status"},{"$ref":"response.data.status"},{"$ref":"response.status"},"pending"]}` |
| `response.message` | `{"$coalesce":[{"$ref":"response.data.error.message"},{"$ref":"response.error.message"},{"$ref":"response.message"},{"$ref":"response.fail_reason"}]}` |
| `response.images` | `{"$coalesce":[{"$map":{"from":{"$ref":"response.data.result.images"},"as":"image","in":{"$at":[{"$ref":"image.url"},0]}}},{"$map":{"from":{"$ref":"response.data.images"},"as":"image","in":{"$at":[{"$ref":"image.url"},0]}}},{"$ref":"response.data.result.image_url"},{"$ref":"response.data.image_url"},{"$ref":"response.image_url"}]}` |
| `response.errorPaths[0]` | `"response.data.error.code"` |
| `response.errorPaths[1]` | `"response.data.error.message"` |
| `response.errorPaths[2]` | `"response.error.code"` |
| `response.resultEphemeral` | `true` |
| `response.messagePaths[0]` | `"response.data.error.message"` |
| `response.messagePaths[1]` | `"response.error.message"` |
| `response.messagePaths[2]` | `"response.message"` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 兼容边界

APIMart 图片统一异步接口：创建使用 /v1/images/generations，查询使用 /v1/tasks/{task_id}。size 为比例或像素尺寸，resolution 为 1k/2k/4k；参考图走 image_urls。Midjourney 等独立路由必须使用独立协议。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "apimart-image",
  "name": "APIMart Image",
  "version": "2.0.0",
  "author": "APIMart / 影策",
  "description": "APIMart Image 独立请求协议插件。",
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
        "id": "apimart-image",
        "label": "APIMart Image",
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
            "mapping": "model",
            "description": "图片模型 ID。"
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
            "mapping": "provider image/reference fields",
            "description": "参考图或编辑源图，role 由业务层确定。"
          },
          {
            "name": "imageCount",
            "type": "integer",
            "required": false,
            "mapping": "n/sample_count",
            "description": "输出数量。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "size/aspect_ratio",
            "description": "比例或尺寸，语义按协议说明。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution/imageSize",
            "description": "分辨率档位。"
          },
          {
            "name": "quality",
            "type": "string",
            "required": false,
            "mapping": "quality",
            "description": "质量档位。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "provider-specific fields",
            "description": "插件命名空间内的厂商扩展字段。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/images/generations",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$omitEmpty": {
                "$ref": "request.prompt"
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
                    "$ref": "request.aspectRatio"
                  }
                }
              }
            },
            "resolution": {
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
                            "1k",
                            "low"
                          ]
                        ]
                      },
                      "then": "1k"
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
                      "then": "2k"
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
                      "then": "4k"
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
                            "",
                            "auto"
                          ]
                        ]
                      },
                      "then": null
                    }
                  ],
                  "default": {
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
                  }
                }
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
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/tasks/{{taskId}}"
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
                "$ref": "response.data.0.status"
              },
              {
                "$ref": "response.data.status"
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
                "$ref": "response.data.error.message"
              },
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
          "images": {
            "$coalesce": [
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
            "response.data.error.code",
            "response.data.error.message",
            "response.error.code"
          ],
          "resultEphemeral": true,
          "messagePaths": [
            "response.data.error.message",
            "response.error.message",
            "response.message"
          ]
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
