# 问鼎 LK888 Audio 接口字段

## 协议身份

- 插件 ID：`lk888-audio`。
- Provider ID：`lk888-audio`。
- 能力：`audio`。
- 默认 Base URL：`https://api.lk888.ai`。
- 鉴权驱动：`bearer`。
- 创建：`POST /v1/media/generate`。
- 查询：`GET /v1/media/status`，查询参数 `task_id`。
- 音色清单：`GET /v1/skills/voices?model=doubao-tts-2.0`（免费，返回 `voice_id`、`name`、`gender`、`scene`、`language`、`demo_audio`）。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | `doubao-tts-2.0`。 |
| `prompt` | string | 是 | `prompt` | 待合成文本，最长 10 万字符。 |
| `providerOptions` | object | 否 | `params.*` 与顶层 `notify_url` | 命名空间 `lk888-audio`，见下表。 |

## 上游请求模板逐字段清单

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/v1/media/generate"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `request.model` |
| `create.body.prompt` | `request.prompt` |
| `create.body.params.voice_id` | 音色：节点音色 `audioVoice`（**OpenAI 风格音色名会被忽略**，见下）→ `providerOptions.lk888-audio.voice_id` → `zh_female_vv_uranus_bigtts` |
| `create.body.params.speaker` | 同一个音色的另一种上游写法，只在显式设置 `providerOptions.lk888-audio.speaker` 时发送 |
| `create.body.params.speech_rate` | 语速：先按上游枚举原值放行（`-50/-25/0/25/50/100`），否则把节点的倍速值映射到枚举，空值/非法值回 `0`；也可用 `providerOptions.lk888-audio.speech_rate` |
| `create.body.params.emotion` | 情感：`providerOptions.lk888-audio.emotion` → `auto`；取值 `auto/happy/sad/angry/fearful/surprised/calm` |
| `create.body.params.emotion_scale` | 情绪强度 `1~5`，只在显式设置时发送（情感为 `auto` 时上游会隐藏该参数） |
| `create.body.params.format` | 输出格式：节点格式 `audioFormat` → `providerOptions.lk888-audio.format` → `mp3`；`opus` 映射成 `ogg_opus`，`mp3/wav/pcm` 原样传，其它值落回 `mp3` |
| `create.body.notify_url` | 任务回调地址（顶层字段，与 `model`/`prompt`/`params` 平级），只在显式设置时发送 |
| `poll.method` | `"GET"` |
| `poll.path` | `"/v1/media/status"` |
| `poll.query.task_id` | `taskId`（创建响应里的 `data.task_id`） |

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.taskId` | `response.data.task_id` → `response.task_id` → `taskId` |
| `response.status` | `response.state`（`pending`/`running`/`success`/`failed`），缺失时 `pending` |
| `response.message` | `response.error` |
| `response.audios` | `response.result_url`（任务成功后才有值） |
| `response.errorPaths[0]` | `"error"` |
| `response.resultEphemeral` | `true` |

## 宿主音频字段与上游的语义差（重要）

宿主的音频参数面板是给 OpenAI 风格模型设计的，直接透传会被豆包 TTS 拒掉，插件按下面的规则对齐：

| 宿主字段 | 宿主取值形态 | 上游要求 | 插件行为 |
| --- | --- | --- | --- |
| `audioVoice` | 固定列表：`alloy`、`ash`、`ballad`、`coral`、`echo`、`fable`、`nova`、`onyx`、`sage`、`shimmer`、`verse`、`marin`、`cedar` | 豆包音色 ID，如 `zh_female_vv_uranus_bigtts` | 命中 OpenAI 名单时**忽略**并落回默认音色（或 `providerOptions.voice_id`）；其它取值原样传给 `voice_id`，因此命令行/Agent 写进去的豆包音色仍然有效 |
| `audioSpeed` | 倍速 `0.25 ~ 4`（`1` 为正常） | 枚举 `-50/-25/0/25/50/100`（`0` 为正常） | 取值本身就是枚举时原样传；否则按倍速映射：`≤0.6→-50`、`≤0.85→-25`、`<1.25→0`、`≥1.25→25`、`≥1.75→50`、`≥2.5→100`；空值或非数值回 `0` |
| `audioFormat` | `mp3`、`wav`、`opus`、`aac`、`flac`、`pcm` | `mp3`、`wav`、`ogg_opus` | `opus→ogg_opus`，`mp3/wav/pcm` 原样，`aac/flac` 等不支持的值落回 `mp3` |
| `audioInstructions` | 自由文本（OpenAI 的 voice instructions） | 无对应字段 | 本插件不发送；需要情感时用 `providerOptions.lk888-audio.emotion` / `emotion_scale` |

要在画布上选具体豆包音色，用 `providerOptions.lk888-audio.voice_id`（音色清单见 `GET /v1/skills/voices?model=doubao-tts-2.0`）；按模型下发音色下拉属于宿主侧后续能力（需要渠道模型可编辑的音频能力 JSON）。

## 响应与错误

- 终态判定用 `is_final`；上游的 `status` / `status_group` 是中文展示字段，不参与业务判断。
- `state` 固定 4 档：`pending` / `running` / `success` / `failed`。`failed` 时上游会自动退款。
- `result_url` 是临时地址，宿主在任务成功后立即下载并转存为账号资源，不把该地址写进画布。

## 兼容边界

- 只接文字转语音：不发送参考图片、参考视频或参考音频（`requiresPublicMediaUrls` 为 `false`，宿主不需要为它准备公网素材地址）。
- 上游文档在"请求参数"表里用 `voice_id`、在模型专属页里用 `speaker` 表示同一个音色字段。本插件默认只发 `voice_id`（与官方参数表和示例一致）；若某条线路只认 `speaker`，在渠道的协议扩展里填 `speaker` 即可，不需要改插件。
- 情感与情绪强度是上游扩展字段，宿主统一字段里没有对应项，因此只通过 `providerOptions.lk888-audio` 传入；不传时使用 `emotion=auto`。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "lk888-audio",
  "name": "问鼎 LK888 Audio",
  "version": "1.0.0",
  "author": "问鼎数据 / 影策",
  "description": "问鼎数据音频异步任务协议，覆盖 doubao-tts-2.0 豆包语音合成 2.0。",
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
        "id": "lk888-audio",
        "label": "问鼎 LK888 Audio",
        "capabilities": [
          "audio"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://api.lk888.ai",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "description": "文字转语音：POST /v1/media/generate 建任务，GET /v1/media/status 轮询；终态看 is_final，结果在 result_url。默认音色 zh_female_vv_uranus_bigtts，音色清单见 GET /v1/skills/voices?model=doubao-tts-2.0。",
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "model",
            "description": "音频模型 ID：doubao-tts-2.0。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "待合成文本，最长 10 万字符。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "params.voice_id / params.speaker / params.speech_rate / params.emotion / params.emotion_scale / params.format / notify_url",
            "description": "命名空间 lk888-audio 的扩展字段：voice_id、speaker（上游两份文档分别用这两个名字，默认只发 voice_id）、speech_rate、emotion、emotion_scale、format、notify_url（顶层回调地址）。"
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
              "voice_id": {
                "$switch": {
                  "cases": [
                    {
                      "when": {
                        "$in": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "request.extra.audioVoice"
                              }
                            }
                          },
                          [
                            "alloy",
                            "ash",
                            "ballad",
                            "coral",
                            "echo",
                            "fable",
                            "nova",
                            "onyx",
                            "sage",
                            "shimmer",
                            "verse",
                            "marin",
                            "cedar"
                          ]
                        ]
                      },
                      "then": {
                        "$coalesce": [
                          {
                            "$ref": "request.providerOptions.lk888-audio.voice_id"
                          },
                          "zh_female_vv_uranus_bigtts"
                        ]
                      }
                    }
                  ],
                  "default": {
                    "$coalesce": [
                      {
                        "$ref": "request.extra.audioVoice"
                      },
                      {
                        "$ref": "request.providerOptions.lk888-audio.voice_id"
                      },
                      "zh_female_vv_uranus_bigtts"
                    ]
                  }
                }
              },
              "speaker": {
                "$omitEmpty": {
                  "$coalesce": [
                    {
                      "$ref": "request.providerOptions.lk888-audio.speaker"
                    }
                  ]
                }
              },
              "speech_rate": {
                "$switch": {
                  "cases": [
                    {
                      "when": {
                        "$in": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "request.extra.audioSpeed"
                              }
                            }
                          },
                          [
                            "-50",
                            "-25",
                            "0",
                            "25",
                            "50",
                            "100"
                          ]
                        ]
                      },
                      "then": {
                        "$lower": {
                          "$trim": {
                            "$ref": "request.extra.audioSpeed"
                          }
                        }
                      }
                    },
                    {
                      "when": {
                        "$lte": [
                          {
                            "$ref": "request.extra.audioSpeed"
                          },
                          0
                        ]
                      },
                      "then": {
                        "$coalesce": [
                          {
                            "$ref": "request.providerOptions.lk888-audio.speech_rate"
                          },
                          "0"
                        ]
                      }
                    },
                    {
                      "when": {
                        "$gte": [
                          {
                            "$ref": "request.extra.audioSpeed"
                          },
                          2.5
                        ]
                      },
                      "then": "100"
                    },
                    {
                      "when": {
                        "$gte": [
                          {
                            "$ref": "request.extra.audioSpeed"
                          },
                          1.75
                        ]
                      },
                      "then": "50"
                    },
                    {
                      "when": {
                        "$gte": [
                          {
                            "$ref": "request.extra.audioSpeed"
                          },
                          1.25
                        ]
                      },
                      "then": "25"
                    },
                    {
                      "when": {
                        "$lte": [
                          {
                            "$ref": "request.extra.audioSpeed"
                          },
                          0.6
                        ]
                      },
                      "then": "-50"
                    },
                    {
                      "when": {
                        "$lte": [
                          {
                            "$ref": "request.extra.audioSpeed"
                          },
                          0.85
                        ]
                      },
                      "then": "-25"
                    }
                  ],
                  "default": {
                    "$coalesce": [
                      {
                        "$ref": "request.providerOptions.lk888-audio.speech_rate"
                      },
                      "0"
                    ]
                  }
                }
              },
              "emotion": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.lk888-audio.emotion"
                  },
                  "auto"
                ]
              },
              "emotion_scale": {
                "$omitEmpty": {
                  "$coalesce": [
                    {
                      "$ref": "request.providerOptions.lk888-audio.emotion_scale"
                    }
                  ]
                }
              },
              "format": {
                "$switch": {
                  "cases": [
                    {
                      "when": {
                        "$in": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "request.extra.audioFormat"
                              }
                            }
                          },
                          [
                            "opus",
                            "ogg_opus"
                          ]
                        ]
                      },
                      "then": "ogg_opus"
                    },
                    {
                      "when": {
                        "$in": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "request.extra.audioFormat"
                              }
                            }
                          },
                          [
                            "mp3",
                            "wav",
                            "pcm"
                          ]
                        ]
                      },
                      "then": {
                        "$lower": {
                          "$trim": {
                            "$ref": "request.extra.audioFormat"
                          }
                        }
                      }
                    }
                  ],
                  "default": {
                    "$coalesce": [
                      {
                        "$ref": "request.providerOptions.lk888-audio.format"
                      },
                      "mp3"
                    ]
                  }
                }
              }
            },
            "notify_url": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.lk888-audio.notify_url"
                  }
                ]
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
          "audios": {
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
