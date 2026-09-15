package app

import (
	"encoding/json"
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// cloudAgentCreativeAnchor is durable, server-owned context for the creative
// task. It separates the user's constraints and real canvas references from
// model-authored drafts, so a later turn cannot mistake an invented character
// or story for an approved requirement.
type cloudAgentCreativeAnchor struct {
	Version            int                         `json:"version"`
	UserPrompt         string                      `json:"userPrompt"`
	ReferenceMode      string                      `json:"referenceMode,omitempty"`
	ReferenceNodeIDs   []string                    `json:"referenceNodeIds,omitempty"`
	ReferenceAssets    []cloudAgentReferenceAnchor `json:"referenceAssets,omitempty"`
	LockedRequirements []string                    `json:"lockedRequirements,omitempty"`
	FreelyDecidable    []string                    `json:"freelyDecidable,omitempty"`
}

type cloudAgentReferenceAnchor struct {
	NodeID                   string   `json:"nodeId"`
	Type                     string   `json:"type"`
	Title                    string   `json:"title,omitempty"`
	Prompt                   string   `json:"prompt,omitempty"`
	AssetTags                []string `json:"assetTags,omitempty"`
	ReferenceReady           bool     `json:"referenceReady"`
	VisualIdentity           string   `json:"visualIdentity"`
	RequiresVisualInspection bool     `json:"requiresVisualInspection"`
	Width                    any      `json:"width,omitempty"`
	Height                   any      `json:"height,omitempty"`
}

func cloudAgentPromptUsesCanvasReferences(prompt string) bool {
	prompt = strings.ToLower(strings.TrimSpace(prompt))
	for _, marker := range []string{
		"多参考图", "参考图", "参考素材", "基于画布", "画布上的图", "这些图", "这两张图",
		"用这两张", "图片生成视频", "图生视频", "多图生视频", "image-to-video", "image to video",
	} {
		if strings.Contains(prompt, marker) {
			return true
		}
	}
	return false
}

func cloudAgentCreativeAnchorForCanvas(repo *repository.Repository, userID string, canvas *model.CanvasProject, prompt string, inherited *cloudAgentCreativeAnchor) (cloudAgentCreativeAnchor, error) {
	anchor := cloudAgentCreativeAnchor{Version: 1, UserPrompt: truncateRunes(prompt, 16000)}
	if inherited != nil && inherited.Version > 0 {
		anchor = *inherited
		anchor.ReferenceNodeIDs = append([]string(nil), inherited.ReferenceNodeIDs...)
		anchor.ReferenceAssets = append([]cloudAgentReferenceAnchor(nil), inherited.ReferenceAssets...)
		anchor.LockedRequirements = append([]string(nil), inherited.LockedRequirements...)
		anchor.FreelyDecidable = append([]string(nil), inherited.FreelyDecidable...)
		if anchor.UserPrompt == "" {
			anchor.UserPrompt = truncateRunes(prompt, 16000)
		}
	}
	if anchor.ReferenceMode == "" {
		if cloudAgentPromptUsesCanvasReferences(prompt) {
			anchor.ReferenceMode = "explicit"
		} else {
			anchor.ReferenceMode = "candidate"
		}
	}
	if len(anchor.LockedRequirements) == 0 {
		anchor.LockedRequirements = []string{
			"用户明确要求是约束；‘剧本你自己想’只授权自行决定情节，不授权替换或遗忘当前画布参考素材。",
			"当前画布中标记 referenceReady=true 的媒体节点是真实可复用素材；不得凭空把未出现的新角色、世界观或结局当作用户要求。",
		}
	}
	if len(anchor.FreelyDecidable) == 0 {
		anchor.FreelyDecidable = []string{"故事情节、镜头顺序、对白和表现风格可以自主设计，但必须说明并保持参考素材主体与连续性。"}
	}

	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return cloudAgentCreativeAnchor{}, BadAuthRequest("服务端画布内容无法解析，请先重新同步")
	}
	nodes := creationMaps(doc["nodes"])
	byID := make(map[string]map[string]any, len(nodes))
	for _, node := range nodes {
		if id := stringValue(node["id"]); id != "" {
			byID[id] = node
		}
	}

	// On a continuation, rehydrate the original reference IDs against the
	// current snapshot. This preserves the task boundary while making removal or
	// replacement explicit instead of silently carrying stale media forward.
	ids := anchor.ReferenceNodeIDs
	if len(ids) == 0 {
		for _, node := range nodes {
			descriptor, known := cloudAgentNodeCapabilityForType(stringValue(node["type"]))
			if known && descriptor.Connection.CanReference {
				ids = append(ids, stringValue(node["id"]))
			}
			if len(ids) == 16 {
				break
			}
		}
	}
	anchor.ReferenceNodeIDs = nil
	anchor.ReferenceAssets = nil
	for _, id := range ids {
		if id == "" || byID[id] == nil {
			continue
		}
		node := byID[id]
		descriptor, known := cloudAgentNodeCapabilityForType(stringValue(node["type"]))
		if !known || !descriptor.Connection.CanReference {
			continue
		}
		meta, _ := node["metadata"].(map[string]any)
		item := cloudAgentReferenceAnchor{
			NodeID: stringValue(node["id"]), Type: stringValue(node["type"]),
			Title:          truncateRunes(stringValue(node["title"]), 300),
			Prompt:         truncateRunes(firstNonEmpty(stringValue(meta["prompt"]), stringValue(meta["composerContent"])), 1000),
			VisualIdentity: "unknown", RequiresVisualInspection: true,
		}
		if tags, ok := meta["assetTags"].([]any); ok {
			for _, tag := range tags {
				if text := strings.TrimSpace(stringValue(tag)); text != "" {
					item.AssetTags = append(item.AssetTags, truncateRunes(text, 120))
				}
			}
		}
		if repo != nil {
			ref, _, refErr := cloudAgentReference(repo, userID, node)
			if refErr == nil {
				item.ReferenceReady = true
				item.Width, item.Height = ref["width"], ref["height"]
			}
		}
		// A title/prompt/tag may provide a semantic hint, but this is not a
		// vision result. Do not claim to recognize an image from metadata alone.
		if item.Title != "" && item.Title != "生成图片" || item.Prompt != "" && item.Prompt != "生成图片" || len(item.AssetTags) > 0 {
			item.RequiresVisualInspection = true
		}
		anchor.ReferenceNodeIDs = append(anchor.ReferenceNodeIDs, item.NodeID)
		anchor.ReferenceAssets = append(anchor.ReferenceAssets, item)
		if len(anchor.ReferenceAssets) == 16 {
			break
		}
	}
	if anchor.ReferenceMode == "explicit" && len(anchor.ReferenceNodeIDs) == 0 {
		anchor.LockedRequirements = append(anchor.LockedRequirements, "用户要求使用参考图，但当前快照没有可验证的参考节点；先读取/澄清素材，不得用新角色替代。")
	}
	return anchor, nil
}

func cloudAgentCreativeAnchorContext(anchor cloudAgentCreativeAnchor) string {
	if anchor.Version == 0 {
		return ""
	}
	encoded, err := json.Marshal(anchor)
	if err != nil {
		return ""
	}
	return "创作任务锚点（服务端固定事实，优先级高于模型草稿）：\n" +
		"- referenceNodeIds 是当前画布中真实候选素材的节点 ID；生成媒体时只能通过 referenceNodeIds 建立引用。\n" +
		"- visualIdentity=unknown 表示文本模型没有视觉识别证据：不要把它默认为无关素材，也不要编造其内容；需要识别时应请求视觉理解或向用户澄清。\n" +
		"- Agent 自己生成的故事、角色和镜头属于 draft，除非用户明确批准，不得升级为 locked requirement。\n" +
		string(encoded)
}
