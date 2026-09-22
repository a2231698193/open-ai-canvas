package app

import (
	"fmt"
	"sort"
	"strings"

	"infinite-canvas/backend/internal/canvas/contract"
)

// generation 字段里与生成选项无关、直接写进节点 metadata 的模型选择键。
// 取值与 contract.GenerationSpec.NodeMetadata 写出的形状一致，前端读的也是同一组字段。
var cloudAgentGenerationSelectionKeys = []string{"model", "logicalModelId", "channelId", "channelModelKey"}

// cloudAgentGenerationMetadata 把 add_node / update_node 的 generation 字段投影成节点 metadata。
//
// 只接受该节点类型所属生成模式的选项字段：字段拼错或跨模式（例如给图片节点传 seconds）
// 都会被拒绝，而不是静默丢弃——否则工具报告成功，用户在网页上看到的却是编辑器默认值。
// 取值边界由 contract.Options 的 modes 标签和 GenerationSpec.Validate 共同保证。
func cloudAgentGenerationMetadata(nodeType string, generation map[string]any) (map[string]any, error) {
	if len(generation) == 0 {
		return nil, nil
	}
	capability, known := cloudAgentNodeCapabilityForType(nodeType)
	if !known {
		return nil, BadAuthRequest("不支持的节点类型")
	}
	if capability.GenerationMode == "" {
		return nil, BadAuthRequest(fmt.Sprintf("%s 节点不接受生成规格", capability.Label))
	}
	options := map[string]any{}
	selection := map[string]any{}
	for key, value := range generation {
		if cloudAgentContainsString(cloudAgentGenerationSelectionKeys, key) {
			selection[key] = value
			continue
		}
		options[key] = value
	}
	parsed, err := contract.OptionsFromNodeMetadata(capability.GenerationMode, options)
	if err != nil {
		// 契约返回的是本地生成的 FieldError（字段路径 + 原因），不含上游或凭据信息，
		// 直接透出才能让调用方按可用字段名自己改对。
		return nil, BadAuthRequest(err.Error())
	}
	if selection["logicalModelId"] != nil && selection["model"] != nil {
		return nil, BadAuthRequest("generation.logicalModelId 与 generation.model 只能填一个")
	}
	spec := contract.GenerationSpec{Version: contract.GenerationVersion, Mode: capability.GenerationMode, TextInputMode: "prompt-only", Options: parsed}
	projected, err := spec.NodeMetadata()
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	metadata := map[string]any{}
	for key, value := range projected {
		switch key {
		case "generationSpec", "prompt", "composerContent":
			// 这三个由节点正文和生成任务自己维护，不由 generation 字段写入。
			continue
		}
		metadata[key] = value
	}
	for _, key := range cloudAgentGenerationSelectionKeys {
		raw, exists := selection[key]
		if !exists {
			continue
		}
		text, ok := raw.(string)
		if !ok || strings.TrimSpace(text) == "" {
			return nil, BadAuthRequest(fmt.Sprintf("generation.%s 必须是非空字符串", key))
		}
		metadata[key] = strings.TrimSpace(text)
	}
	return metadata, nil
}

// cloudAgentGenerationFieldNames 给审批预览列出这次要写入的生成字段名，顺序稳定便于阅读。
func cloudAgentGenerationFieldNames(generation map[string]any) []string {
	names := make([]string, 0, len(generation))
	for key := range generation {
		names = append(names, key)
	}
	sort.Strings(names)
	return names
}
