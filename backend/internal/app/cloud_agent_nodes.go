package app

// cloudAgentNodeCapability is the server-side contract for nodes that an Agent
// may create or connect. It is intentionally independent from the browser node
// registry: renderers and plugin schemas are not an authorization boundary.
type cloudAgentNodeCapability struct {
	Type               string
	Label              string
	DefaultWidth       float64
	DefaultHeight      float64
	InputKind          string
	GenerationMode     string
	AcceptedInputKinds []string
	MaxInputCount      int
	CanUpdate          bool
}

var cloudAgentNodeCapabilities = []cloudAgentNodeCapability{
	{Type: "text", Label: "文本", DefaultWidth: 340, DefaultHeight: 240, InputKind: "text", CanUpdate: true},
	{Type: "markdown", Label: "Markdown", DefaultWidth: 420, DefaultHeight: 320, InputKind: "text", CanUpdate: true},
	{Type: "image", Label: "图片", DefaultWidth: 720, DefaultHeight: 405, InputKind: "image", GenerationMode: "image", AcceptedInputKinds: []string{"text", "image"}},
	{Type: "video", Label: "视频", DefaultWidth: 720, DefaultHeight: 405, InputKind: "video", GenerationMode: "video", AcceptedInputKinds: []string{"text", "image", "video", "audio"}},
	// The current audio provider has no character-image/voice binding input. Do
	// not advertise image references until the provider path consumes them.
	{Type: "audio", Label: "音频", DefaultWidth: 340, DefaultHeight: 120, InputKind: "audio", GenerationMode: "audio", AcceptedInputKinds: []string{"text"}, MaxInputCount: 1},
	{Type: "frame", Label: "背板", DefaultWidth: 760, DefaultHeight: 520},
	{Type: "script", Label: "分镜脚本", DefaultWidth: 920, DefaultHeight: 360},
}

func cloudAgentNodeCapabilityForType(nodeType string) (cloudAgentNodeCapability, bool) {
	for _, capability := range cloudAgentNodeCapabilities {
		if capability.Type == nodeType {
			return capability, true
		}
	}
	return cloudAgentNodeCapability{}, false
}

func cloudAgentNodeTypeNames() []string {
	names := make([]string, 0, len(cloudAgentNodeCapabilities))
	for _, capability := range cloudAgentNodeCapabilities {
		names = append(names, capability.Type)
	}
	return names
}

// cloudAgentGenerationModes is the single source of truth for generation
// capabilities exposed to Agent. Keep this derived from the node contract so a
// newly supported generation node cannot be accidentally omitted from model
// discovery while still being accepted by the write path.
func cloudAgentGenerationModes() map[string]bool {
	modes := make(map[string]bool)
	for _, capability := range cloudAgentNodeCapabilities {
		if capability.GenerationMode != "" {
			modes[capability.GenerationMode] = true
		}
	}
	return modes
}

func cloudAgentGenerationModeSupported(mode string) bool {
	return cloudAgentGenerationModes()[mode]
}
