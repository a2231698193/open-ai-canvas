package app

import (
	"fmt"
	"strings"
	"testing"
)

func TestValidateImageTaskRejectsOversizedGrokPromptByUTF8Bytes(t *testing.T) {
	prompt := strings.Repeat("中", 4001)
	input := canvasGenerationInput{
		Mode:   "image",
		Prompt: prompt,
		Config: providerConfig{InterfaceType: "grok-image", Model: "grok-imagine-image-quality"},
	}

	err := validateImageTask(DefaultImageCapabilityConfig("grok-image", "grok-imagine-image-quality"), input)
	if err == nil {
		t.Fatal("validateImageTask() error = nil")
	}
	wantBytes := fmt.Sprintf("%d UTF-8 字节", len(prompt))
	if !strings.Contains(err.Error(), wantBytes) || !strings.Contains(err.Error(), "8000") || !strings.Contains(err.Error(), "连线文本") {
		t.Fatalf("validateImageTask() error = %q", err)
	}
}

func TestValidateImageTaskDoesNotApplyQualityPromptLimitToGrokLite(t *testing.T) {
	prompt := strings.Repeat("中", 4001)
	input := canvasGenerationInput{
		Mode:   "image",
		Prompt: prompt,
		Config: providerConfig{InterfaceType: "grok-image", Model: "grok-imagine-image"},
	}

	if err := validateImageTask(DefaultImageCapabilityConfig("grok-image", "grok-imagine-image"), input); err != nil {
		t.Fatalf("validateImageTask() error = %q", err)
	}
}

func TestValidateVideoTaskRejectsPromptAboveCapabilityLimit(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("autodl-comfyui", "MiniMax H3").Video
	profile.References.PromptMaxChars = 10_000
	input := canvasGenerationInput{
		Mode:   "video",
		Prompt: strings.Repeat("镜", 23_142),
		Config: providerConfig{Model: "MiniMax H3", VideoSeconds: "15", Size: "16:9", VQuality: "768p横"},
	}

	err := validateVideoTask(profile, input)
	if err == nil || !strings.Contains(err.Error(), "最多 10000 个字符") || !strings.Contains(err.Error(), "23142 个字符") || !strings.Contains(err.Error(), "不会自动截断") {
		t.Fatalf("validateVideoTask() error = %v", err)
	}
}

// 视频提示词由输入框文本、连线内容和技能上下文合成，默认上限必须留出足够余量，
// 否则画布工作流会连同线内容一起被拦在本地。这里锁定默认值与边界行为。
func TestDefaultVideoPromptMaxCharsAllowsComposedCanvasPrompt(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("seedance-videos-compatible", "sd-2.5").Video
	if profile.References.PromptMaxChars != 8000 {
		t.Fatalf("视频默认提示词上限 = %d, want 8000", profile.References.PromptMaxChars)
	}

	// 画布实际合成出的提示词量级（输入框 + 连线 + 技能上下文）必须通过。
	composed := canvasGenerationInput{Mode: "video", Prompt: strings.Repeat("镜", 2399), Config: providerConfig{Model: "sd-2.5", VideoSeconds: "6", Size: "16:9", VQuality: "720p"}}
	if err := validateVideoTask(profile, composed); err != nil {
		t.Fatalf("合成提示词 2399 字符被拒绝: %v", err)
	}
	// 恰好等于上限仍然放行，与前端 `actualChars <= maxChars` 的判定保持一致。
	atLimit := composed
	atLimit.Prompt = strings.Repeat("镜", 8000)
	if err := validateVideoTask(profile, atLimit); err != nil {
		t.Fatalf("提示词 8000 字符被拒绝: %v", err)
	}
	// 超出上限必须明确失败，并保持“不自动截断”的语义。
	overLimit := composed
	overLimit.Prompt = strings.Repeat("镜", 8001)
	err := validateVideoTask(profile, overLimit)
	if err == nil || !strings.Contains(err.Error(), "最多 8000 个字符") || !strings.Contains(err.Error(), "8001 个字符") {
		t.Fatalf("validateVideoTask() error = %v", err)
	}
}

func TestValidateTaskCapabilityRejectsWorkflowPromptAboveConfiguredLimit(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("runninghub-workflow-video", "workflow-video")
	profile.Video.References.PromptMaxChars = 10_000
	input := map[string]any{
		"mode":   "video",
		"prompt": strings.Repeat("镜", 10_001),
		"config": map[string]any{
			"interfaceType":    "runninghub-workflow-video",
			"capabilityConfig": profile,
		},
	}

	err := (&Service{}).ValidateTaskCapability(input)
	if err == nil || !strings.Contains(err.Error(), "完整提示词为 10001 个字符") {
		t.Fatalf("ValidateTaskCapability() error = %v", err)
	}
}

func TestValidateImageTaskEnforcesGPTImage2CustomSizeLimits(t *testing.T) {
	profile := DefaultImageCapabilityConfig("openai-image", "gpt-image-2")
	profile.Size.AllowCustom = true

	valid := canvasGenerationInput{Mode: "image", Config: providerConfig{InterfaceType: "openai-image", Model: "gpt-image-2", Size: "3840x1920"}}
	if err := validateImageTask(profile, valid); err != nil {
		t.Fatalf("validateImageTask(valid) error = %v", err)
	}

	tests := map[string]string{
		"4096x2048": "最长边",
		"3840x2161": "16 的倍数",
		"3840x1024": "宽高比",
		"640x640":   "总像素",
	}
	for size, want := range tests {
		t.Run(size, func(t *testing.T) {
			input := canvasGenerationInput{Mode: "image", Config: providerConfig{InterfaceType: "openai-image", Model: "gpt-image-2", Size: size}}
			err := validateImageTask(profile, input)
			if err == nil || !strings.Contains(err.Error(), want) {
				t.Fatalf("validateImageTask(%s) error = %v, want %q", size, err, want)
			}
		})
	}
}

func TestDefaultVideoCapabilityUsesProtocolSpecificResolutionTiers(t *testing.T) {
	tests := map[string][]string{
		"newapi-channel-2":        {"480p", "720p", "1080p", "1440p", "2160p"},
		"volcengine-ark-video":    {"480p", "720p", "1080p"},
		"volcengine-jimeng-video": {"720p"},
		"gemini-veo":              {"720p", "1080p"},
	}
	for protocol, want := range tests {
		t.Run(protocol, func(t *testing.T) {
			profile := DefaultModelCapabilityConfigForModel(protocol, "")
			if profile == nil || profile.Video == nil {
				t.Fatalf("DefaultModelCapabilityConfigForModel(%q) video profile = nil", protocol)
			}
			if fmt.Sprint(profile.Video.Resolutions) != fmt.Sprint(want) {
				t.Fatalf("resolutions = %v, want %v", profile.Video.Resolutions, want)
			}
		})
	}
}

func TestAPIMartImageCapabilityUsesRatioAndResolutionTiers(t *testing.T) {
	image := DefaultImageCapabilityConfig("apimart-image", "gpt-image-2")
	if image.Size.Parameter != "aspect_ratio" || image.Quality.Default != "2k" || image.References.MaskSupported || image.MaxOutputs != 4 {
		t.Fatalf("APIMart image capability = %#v", image)
	}
}

func TestAPIMartVideoCapabilitiesUseModelLimits(t *testing.T) {
	miniMax := DefaultModelCapabilityConfigForModel("apimart-video", "MiniMax-H3").Video
	if miniMax.DefaultResolution != "2K" || miniMax.References.MaxVideos != 3 || miniMax.GenerateAudio.Supported {
		t.Fatalf("MiniMax-H3 capability = %#v", miniMax)
	}
	seedance25 := DefaultModelCapabilityConfigForModel("apimart-video", "seedance-2.5").Video
	if seedance25.DefaultRatio != "adaptive" || seedance25.Duration.Max != 30 || seedance25.References.MaxImages != 30 || seedance25.References.MaxVideos != 10 || seedance25.References.MaxAudios != 10 {
		t.Fatalf("Seedance 2.5 capability = %#v", seedance25)
	}
	kling := DefaultModelCapabilityConfigForModel("apimart-video", "kling-v3").Video
	if kling.GenerateAudio.Default || !kling.GenerateAudio.Supported || kling.References.MaxImages != 2 {
		t.Fatalf("Kling v3 capability = %#v", kling)
	}
}

func TestLK888VideoCapabilitiesUseModelLimits(t *testing.T) {
	miniMax := DefaultModelCapabilityConfigForModel("lk888-video", "minimax-h3").Video
	if miniMax.DefaultRatio != "adaptive" || fmt.Sprint(miniMax.Resolutions) != fmt.Sprint([]string{"768P", "1080P", "2K", "4K"}) || miniMax.DefaultResolution != "768P" || miniMax.Duration.Min != 4 || miniMax.References.MaxVideos != 3 {
		t.Fatalf("lk888 MiniMax-H3 capability = %#v", miniMax)
	}
	kling := DefaultModelCapabilityConfigForModel("lk888-video", "kling-v3-video").Video
	if fmt.Sprint(kling.Ratios) != fmt.Sprint([]string{"16:9", "9:16", "1:1"}) || kling.References.MaxImages != 2 || fmt.Sprint(kling.Duration.Values) != fmt.Sprint([]int{5, 10, 15}) {
		t.Fatalf("lk888 Kling capability = %#v", kling)
	}
	wan := DefaultModelCapabilityConfigForModel("lk888-video", "wan3.0-video-cankaosheng").Video
	if wan.DefaultRatio != "adaptive" || fmt.Sprint(wan.Resolutions) != fmt.Sprint([]string{"480P", "720P", "1080P"}) || wan.Duration.Max != 30 || !wan.GenerateAudio.Supported {
		t.Fatalf("lk888 Wan capability = %#v", wan)
	}
	enhance := DefaultModelCapabilityConfigForModel("lk888-video", "video-enhance").Video
	if enhance.DefaultOperation != "video_to_video" || fmt.Sprint(enhance.Resolutions) != fmt.Sprint([]string{"720p", "1080p", "2k", "4k", "8k"}) || enhance.References.MaxVideos != 1 || len(enhance.Ratios) != 0 {
		t.Fatalf("lk888 video-enhance capability = %#v", enhance)
	}
}

func TestLK888SeedanceCapabilitiesIncludeAdaptiveRatio(t *testing.T) {
	standard := DefaultModelCapabilityConfigForModel("lk888-seedance", "doubao-seedance-2-0-260128").Video
	if standard.DefaultRatio != "adaptive" || fmt.Sprint(standard.Ratios) != fmt.Sprint([]string{"adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"}) || fmt.Sprint(standard.Resolutions) != fmt.Sprint([]string{"480p", "720p", "1080p", "4k"}) {
		t.Fatalf("lk888 seedance capability = %#v", standard)
	}
	anmiao := DefaultModelCapabilityConfigForModel("lk888-seedance-anmiao", "doubao-seedance-2-0-fast-260128").Video
	if anmiao.DefaultRatio != "adaptive" || fmt.Sprint(anmiao.Resolutions) != fmt.Sprint([]string{"480p", "720p"}) {
		t.Fatalf("lk888 seedance anmiao capability = %#v", anmiao)
	}
}

func TestNormalizeVideoCapabilityPromotesLegacyPromptLimit(t *testing.T) {
	input := DefaultModelCapabilityConfigForModel("lk888-seedance", "doubao-seedance-2-0-260128")
	input.Video.References.PromptMaxChars = 1000
	got, err := NormalizeModelCapabilityConfigForModel("video", "lk888-seedance", "doubao-seedance-2-0-260128", input)
	if err != nil {
		t.Fatal(err)
	}
	if got.Video.References.PromptMaxChars != DefaultVideoPromptMaxChars {
		t.Fatalf("promptMaxChars = %d, want %d", got.Video.References.PromptMaxChars, DefaultVideoPromptMaxChars)
	}
}

func TestDefaultMiniMaxVideoCapabilitySupportsReferenceGeneration(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("minimax-video", "MiniMax-H3")
	if profile == nil || profile.Video == nil {
		t.Fatal("MiniMax video profile = nil")
	}
	if !containsCapabilityString(profile.Video.Operations, "reference_to_video") {
		t.Fatalf("operations = %v, want reference_to_video", profile.Video.Operations)
	}
}

func TestAgnesVideo25CapabilityUsesOfficialLimits(t *testing.T) {
	standard := DefaultModelCapabilityConfigForModel("agnes-video", "agnes-video-2.5").Video
	if standard.Duration.Min != 4 || standard.Duration.Max != 12 || standard.Duration.Default != 5 {
		t.Fatalf("Agnes 2.5 duration = %#v", standard.Duration)
	}
	if fmt.Sprint(standard.Resolutions) != fmt.Sprint([]string{"720P", "960P", "2K"}) || standard.References.MaxVideos != 3 {
		t.Fatalf("Agnes 2.5 capability = %#v", standard)
	}
	flash := DefaultModelCapabilityConfigForModel("agnes-video", "agnes-video-2.5-flash").Video
	if fmt.Sprint(flash.Resolutions) != fmt.Sprint([]string{"720P"}) || flash.References.MaxImages != 5 || flash.References.MaxVideos != 0 {
		t.Fatalf("Agnes 2.5 Flash capability = %#v", flash)
	}
}

func TestNormalizeAgnesVideo25CapabilityRepairsLegacyStoredLimits(t *testing.T) {
	legacy := DefaultModelCapabilityConfigForModel("newapi", "legacy-video")
	normalized, err := NormalizeModelCapabilityConfigForModel("video", "agnes-video", "agnes-video-2.5", legacy)
	if err != nil {
		t.Fatalf("NormalizeModelCapabilityConfigForModel() error = %v", err)
	}
	if normalized.Video.Duration.Min != 4 || normalized.Video.Duration.Max != 12 || normalized.Video.Duration.Default != 5 {
		t.Fatalf("normalized duration = %#v", normalized.Video.Duration)
	}
	if fmt.Sprint(normalized.Video.Resolutions) != fmt.Sprint([]string{"720P", "960P", "2K"}) {
		t.Fatalf("normalized resolutions = %v", normalized.Video.Resolutions)
	}
	input := canvasGenerationInput{Config: providerConfig{InterfaceType: "agnes-video", Model: "agnes-video-2.5", VideoSeconds: "15", Size: "16:9", VQuality: "720P"}}
	if err := validateVideoTask(normalized.Video, input); err == nil {
		t.Fatalf("validateVideoTask(15 seconds) error = %v", err)
	}
}

func TestDefaultVolcengineArkVideoCapabilitySupportsFullModalReference(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("volcengine-ark-video", "doubao-seedance-2-0-260128")
	if profile == nil || profile.Video == nil {
		t.Fatal("Volcengine Ark video profile = nil")
	}
	for _, operation := range []string{"reference_to_video", "audio_to_video"} {
		if !containsCapabilityString(profile.Video.Operations, operation) {
			t.Fatalf("operations = %v, want %s", profile.Video.Operations, operation)
		}
	}
	if profile.Video.References.MaxImages != 9 || profile.Video.References.MaxVideos != 3 || profile.Video.References.MaxAudios != 3 {
		t.Fatalf("reference limits = %#v", profile.Video.References)
	}
	for _, role := range []string{"first_frame", "last_frame", "reference_image"} {
		if !containsCapabilityString(profile.Video.References.ImageRoles, role) {
			t.Fatalf("image roles = %v, want %s", profile.Video.References.ImageRoles, role)
		}
	}
}

func TestValidateVideoReferenceModeRequiresDistinctSupportedKeyframes(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("novita-video", "example").Video
	input := canvasGenerationInput{
		Prompt:          "transition",
		ReferenceImages: []providerMedia{{ID: "first"}, {ID: "last"}},
		Metadata:        map[string]interface{}{"videoMode": "keyframes", "videoEditOperation": "image_to_video", "videoStartFrameNodeId": "first", "videoEndFrameNodeId": "last"},
	}
	if err := validateVideoReferenceMode(profile, input); err == nil || !strings.Contains(err.Error(), "尾帧") {
		t.Fatalf("start-only profile error = %v", err)
	}
	profile.References.ImageRoles = []string{"first_frame", "last_frame"}
	if err := validateVideoReferenceMode(profile, input); err != nil {
		t.Fatalf("keyframe profile error = %v", err)
	}
	input.Metadata["videoEndFrameNodeId"] = "first"
	if err := validateVideoReferenceMode(profile, input); err == nil || !strings.Contains(err.Error(), "两张不同") {
		t.Fatalf("duplicate frame error = %v", err)
	}
}

func TestValidateVolcengineArkFullModalReferenceRejectsTextAndAudioOnly(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("volcengine-ark-video", "doubao-seedance-2-0-260128").Video
	input := canvasGenerationInput{
		Prompt:          "follow the soundtrack",
		Config:          providerConfig{InterfaceType: "volcengine-ark-video", VideoSeconds: "6", Size: "16:9", VQuality: "720p"},
		ReferenceAudios: []providerMedia{{URL: "https://example.com/music.mp3"}},
		Metadata:        map[string]interface{}{"videoEditOperation": "audio_to_video"},
	}
	err := validateVideoTask(profile, input)
	if err == nil || !strings.Contains(err.Error(), "文本+音频") {
		t.Fatalf("validateVideoTask() error = %v", err)
	}

	input.ReferenceImages = []providerMedia{{URL: "https://example.com/subject.png"}}
	if err := validateVideoTask(profile, input); err != nil {
		t.Fatalf("validateVideoTask(full modal) error = %v", err)
	}
}

func TestCapabilitySpecFromModelCapabilityConfigRestoresLegacyWildcardImageSizes(t *testing.T) {
	config := &ModelCapabilityConfig{
		Version: 1,
		Image: &ImageCapabilityConfig{
			Size: ImageSizeConfig{Parameter: "size", Values: []string{"*"}, AllowCustom: true},
		},
	}

	spec, err := CapabilitySpecFromModelCapabilityConfig(config, "image")
	if err != nil {
		t.Fatalf("CapabilitySpecFromModelCapabilityConfig() error = %v", err)
	}
	constraint, ok := spec.Options["size"]
	if !ok {
		t.Fatal("size constraint is missing")
	}
	values := make(map[string]int)
	for _, value := range constraint.Values {
		values[fmt.Sprint(value)]++
	}
	for _, value := range legacyImageSizeValues() {
		if values[value] != 1 {
			t.Fatalf("size constraint missing %q: %v", value, constraint.Values)
		}
	}
	if values["*"] != 1 {
		t.Fatalf("size constraint wildcard count = %d, values = %v", values["*"], constraint.Values)
	}
}

func TestNormalizeResolutionSupportsCommonAliases(t *testing.T) {
	tests := map[string]string{
		"1440":  "1440p",
		"1440p": "1440p",
		"2K":    "1440p",
		"4K":    "2160p",
		"768P":  "768p",
	}
	for input, want := range tests {
		if got := normalizeResolution(input); got != want {
			t.Fatalf("normalizeResolution(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestValidateVideoTaskIgnoresGlobalResolutionWhenCatalogDeclaresNone(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("newapi", "omni").Video
	profile.Duration = VideoDurationConfig{Selection: "enum", Values: []int{8, 10}, Default: 10}
	profile.Ratios = []string{"16:9", "9:16"}
	profile.DefaultRatio = "16:9"
	profile.Resolutions = nil
	profile.DefaultResolution = ""
	profile.References.MaxImages = 0
	profile.Operations = []string{"text_to_video"}
	profile.DefaultOperation = "text_to_video"

	err := validateVideoTask(profile, canvasGenerationInput{
		Config: providerConfig{Model: "omni", VideoSeconds: "10", Size: "16:9", VQuality: "720"},
	})
	if err != nil {
		t.Fatalf("validateVideoTask() error = %v", err)
	}
}

func TestNormalizeVideoCapabilityAllowsOmittedResolution(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("newapi-channel-2", "endpoint-video").Video
	profile.Resolutions = nil
	profile.DefaultResolution = ""

	result, err := NormalizeModelCapabilityConfig("video", "newapi-channel-2", &ModelCapabilityConfig{Version: 1, Video: profile})
	if err != nil {
		t.Fatalf("NormalizeModelCapabilityConfig() error = %v", err)
	}
	if result.Video == nil || len(result.Video.Resolutions) != 0 || result.Video.DefaultResolution != "" {
		t.Fatalf("normalized video resolution = %#v", result.Video)
	}
}

func TestNormalizeVideoCapabilityAllowsOmittedRatio(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("autodl-comfyui", "minimax_h3_lightx2v_no_pic").Video
	profile.Ratios = nil
	profile.DefaultRatio = ""
	profile.Resolutions = []string{"480p竖", "480p横"}
	profile.DefaultResolution = "480p竖"

	result, err := NormalizeModelCapabilityConfig("video", "autodl-comfyui", &ModelCapabilityConfig{Version: 1, Video: profile})
	if err != nil {
		t.Fatalf("NormalizeModelCapabilityConfig() error = %v", err)
	}
	if result.Video == nil || len(result.Video.Ratios) != 0 || result.Video.DefaultRatio != "" {
		t.Fatalf("normalized video ratios = %#v", result.Video)
	}
	if err := validateVideoTask(result.Video, canvasGenerationInput{Config: providerConfig{Model: "minimax_h3_lightx2v_no_pic", VideoSeconds: "6", VQuality: "480p竖"}}); err != nil {
		t.Fatalf("validateVideoTask() error = %v", err)
	}
}

func TestCapabilitySpecFromModelCapabilityConfigProjectsImageSizePresets(t *testing.T) {
	config := &ModelCapabilityConfig{
		Version: 1,
		Image: &ImageCapabilityConfig{
			References: ImageReferenceConfig{MaxImages: 4},
			Size: ImageSizeConfig{
				Parameter: "aspect_ratio",
				Values:    []string{"16:9"},
				Default:   "16:9",
				Presets: []ImageSizePreset{
					{Tier: "4k", Ratio: "16:9", Size: "3840x2160", Width: 3840, Height: 2160},
				},
			},
			Quality:    ImageQualityConfig{Supported: false, Default: "auto"},
			MaxOutputs: 1,
		},
	}
	spec, err := CapabilitySpecFromModelCapabilityConfig(config, "image")
	if err != nil {
		t.Fatal(err)
	}
	if spec.Options["quality"].Values != nil {
		t.Fatalf("quality must stay undeclared when unsupported: %#v", spec.Options["quality"])
	}
	if spec.ImageSize == nil || spec.ImageSize.Parameter != "aspect_ratio" || len(spec.ImageSize.Presets) != 1 || spec.ImageSize.Presets[0].Tier != "4k" {
		t.Fatalf("imageSize presets = %#v", spec.ImageSize)
	}
}

func TestCapabilitySpecFromModelCapabilityConfigProjectsImageSizeOnce(t *testing.T) {
	config := &ModelCapabilityConfig{
		Version: 1,
		Image: &ImageCapabilityConfig{
			References: ImageReferenceConfig{MaxImages: 3, MaskSupported: false},
			Size:       ImageSizeConfig{Parameter: "size", Values: []string{"1:1", "16:9"}, AllowCustom: true},
			MaxOutputs: 4,
		},
	}

	spec, err := CapabilitySpecFromModelCapabilityConfig(config, "image")
	if err != nil {
		t.Fatalf("CapabilitySpecFromModelCapabilityConfig() error = %v", err)
	}
	if got := spec.Options["size"].Values; len(got) != 3 || got[0] != "1:1" || got[1] != "16:9" || got[2] != "*" {
		t.Fatalf("size projection = %#v, want configured values plus wildcard", got)
	}
	if got := spec.Inputs["image"].Max; got != 3 {
		t.Fatalf("image input max = %d, want 3", got)
	}
	if got := spec.Options["count"].Max; got == nil || *got != 4 {
		t.Fatalf("count max = %v, want 4", got)
	}
}

func TestCapabilitySpecFromModelCapabilityConfigProjectsCustomImageSizeAsWildcard(t *testing.T) {
	config := &ModelCapabilityConfig{
		Version: 1,
		Image: &ImageCapabilityConfig{
			Size:       ImageSizeConfig{Parameter: "size", Values: []string{"1:1"}, AllowCustom: true},
			MaxOutputs: 1,
		},
	}

	spec, err := CapabilitySpecFromModelCapabilityConfig(config, "image")
	if err != nil {
		t.Fatalf("CapabilitySpecFromModelCapabilityConfig() error = %v", err)
	}
	if got := spec.Options["size"].Values; len(got) != 2 || got[0] != "1:1" || got[1] != "*" {
		t.Fatalf("custom size projection = %#v, want configured value plus wildcard", got)
	}
}

func TestCapabilitySpecFromModelCapabilityConfigAllowsAudioWithoutConfig(t *testing.T) {
	spec, err := CapabilitySpecFromModelCapabilityConfig(nil, "audio")
	if err != nil {
		t.Fatalf("audio projection error = %v", err)
	}
	if spec.Capability != "audio" || len(spec.Inputs) != 0 || len(spec.Options) != 0 {
		t.Fatalf("audio projection = %#v", spec)
	}
}

func TestValidateVideoTaskRequiresDeclaredMinimumImages(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("newapi-channel-2", "image-required-video").Video
	profile.References.MinImages = 1
	profile.References.MaxImages = 2
	profile.Operations = []string{"image_to_video"}
	profile.DefaultOperation = "image_to_video"

	err := validateVideoTask(profile, canvasGenerationInput{
		Config: providerConfig{Model: "image-required-video", VideoSeconds: "6", Size: "16:9", VQuality: "720"},
	})
	if err == nil || !strings.Contains(err.Error(), "至少需要 1 张参考图") {
		t.Fatalf("validateVideoTask() error = %v", err)
	}
}
