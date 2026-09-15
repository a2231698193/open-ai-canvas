package capability

const (
	maxAgentNodeTitleRunes   = 240
	maxAgentNodeContentRunes = 16000
)

func BuiltinRegistry() *Registry {
	registry, err := NewRegistry([]Descriptor{
		{
			Type: "text", Version: "1", Label: "文本", DefaultWidth: 340, DefaultHeight: 240,
			InputKind: "text", Connection: ConnectionPolicy{CanSource: true}, CanUpdate: true,
			SummaryFields: []string{"content"}, DetailFields: []string{"content"},
			PatchFields: editableNodeFields("metadata.content", "正文", "节点正文"),
			CreateMetadata: func(content string) map[string]any {
				return map[string]any{"content": content, "status": "idle", "fontSize": float64(14)}
			},
		},
		{
			Type: "markdown", Version: "1", Label: "Markdown", DefaultWidth: 420, DefaultHeight: 320,
			InputKind: "text", Connection: ConnectionPolicy{CanSource: true}, CanUpdate: true,
			SummaryFields: []string{"content"}, DetailFields: []string{"content"},
			PatchFields: editableNodeFields("metadata.content", "Markdown 正文", "Markdown 正文"),
		},
		generatedMediaDescriptor("image", "2", "图片", 720, 405, "image", ConnectionPolicy{
			CanSource: true, CanTarget: true, CanReference: true, AcceptedInputKinds: []string{"text", "image"},
		}),
		generatedMediaDescriptor("video", "2", "视频", 720, 405, "video", ConnectionPolicy{
			CanSource: true, CanTarget: true, CanReference: true, AcceptedInputKinds: []string{"text", "image", "video", "audio"},
		}),
		generatedMediaDescriptor("audio", "2", "音频", 340, 120, "audio", ConnectionPolicy{
			CanSource: true, CanTarget: true, CanReference: true, MaxInputCount: 1, AcceptedInputKinds: []string{"text"},
		}),
		{
			Type: "frame", Version: "1", Label: "背板", DefaultWidth: 760, DefaultHeight: 520,
			SummaryFields: []string{"label"}, DetailFields: []string{"label"},
			CreateMetadata: func(string) map[string]any {
				return map[string]any{"frame": map[string]any{"collapsed": false, "expandedWidth": float64(760), "expandedHeight": float64(520)}}
			},
		},
		{
			Type: "script", Version: "1", Label: "分镜脚本", DefaultWidth: 920, DefaultHeight: 360,
			SummaryFields: []string{"storyboard"}, DetailFields: []string{"storyboard"}, ProjectionKind: "storyboard", ProjectionField: "storyboard",
			CreateMetadata: func(string) map[string]any {
				return map[string]any{"status": "idle", "workflowKind": "script", "storyboard": map[string]any{"rows": []any{}, "visibleColumns": []any{"shotNumber", "durationSeconds", "videoMotionPrompt", "dialogue", "assets"}, "referenceNodeIds": []any{}}}
			},
		},
	})
	if err != nil {
		panic(err)
	}
	return registry
}

func generatedMediaDescriptor(nodeType, version, label string, width, height float64, generationMode string, connection ConnectionPolicy) Descriptor {
	return Descriptor{
		Type: nodeType, Version: version, Label: label, DefaultWidth: width, DefaultHeight: height,
		InputKind: nodeType, GenerationMode: generationMode, Connection: connection, CanUpdate: true,
		SummaryFields:  []string{"prompt", "composerContent", "assetTags", "referenceNodeIds"},
		DetailFields:   []string{"prompt", "composerContent", "assetTags", "referenceNodeIds"},
		PatchFields:    editableNodeFields("metadata.composerContent", "下一版提示词", "下次生成使用的提示词草稿；不覆盖已提交提示词或媒体结果"),
		CreateMetadata: generatedMetadata,
	}
}

func editableNodeFields(contentPath, contentLabel, contentDescription string) map[string]PatchField {
	return map[string]PatchField{
		"title": {
			Path: "title", Kind: patchKindString, Label: "节点名称", Order: 10, Description: "节点标题", MaxRunes: maxAgentNodeTitleRunes,
		},
		"content": {
			Path: contentPath, Kind: patchKindString, Label: contentLabel, Order: 20, Description: contentDescription, MaxRunes: maxAgentNodeContentRunes,
		},
	}
}

func generatedMetadata(prompt string) map[string]any {
	return map[string]any{"content": "", "prompt": prompt, "composerContent": prompt, "status": "idle"}
}
