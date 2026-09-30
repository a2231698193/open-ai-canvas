// 各类模型的默认能力配置与按模型的特例修正（例如固定分辨率、特定时长档位）。

package app

import (
	"strings"

	"infinite-canvas/backend/internal/model"
)

func DefaultModelCapabilityConfig(protocol string) *ModelCapabilityConfig {
	return DefaultModelCapabilityConfigForModel(protocol, "")
}

func videoDurationSupported(value *VideoCapabilityConfig) bool {
	return value == nil || value.DurationSupported == nil || *value.DurationSupported
}

func DefaultImageCapabilityConfig(protocol string, modelName string) *ImageCapabilityConfig {
	image := &ImageCapabilityConfig{
		References:            ImageReferenceConfig{PromptMaxChars: 32000, MaxImages: 16, MaxImageBytes: 30 * 1024 * 1024, MaskSupported: true},
		Size:                  ImageSizeConfig{Parameter: "size", Values: defaultImageSizeValues(), Default: "1:1", AllowCustom: true},
		Quality:               ImageQualityConfig{Supported: true, Values: []string{"auto", "low", "medium", "high"}, Default: "auto"},
		TransparentBackground: VideoBooleanConfig{Supported: true, Default: false},
		ResponseFormat:        ParameterSupport{Supported: true},
		OutputFormat:          ParameterSupport{Supported: true},
		MaxOutputs:            15,
	}
	switch model.ChannelInterfaceType(protocol) {
	case model.ChannelInterfaceGrokImage:
		image.References.MaxImages = 1
		image.References.MaskSupported = false
		// grok2api / xAI Imagine：size→aspect_ratio，quality→resolution(1k/2k)。
		image.Size = ImageSizeConfig{Parameter: "aspect_ratio", Values: []string{"1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2"}, Default: "1:1", AllowCustom: false}
		image.Quality = ImageQualityConfig{Supported: true, Values: []string{"1k", "2k"}, Default: "2k"}
		image.TransparentBackground = VideoBooleanConfig{Supported: false, Default: false}
		image.ResponseFormat = ParameterSupport{Supported: true}
		image.OutputFormat = ParameterSupport{Supported: false}
		image.MaxOutputs = 1
	case model.ChannelInterfaceVolcengineArkImage, model.ChannelInterfaceVolcengineArkAgentPlanImage:
		image.References.MaskSupported = false
		image.Quality.Supported = false
		image.TransparentBackground.Supported = false
		image.ResponseFormat.Supported = false
		image.OutputFormat.Supported = false
	case model.ChannelInterfaceVolcengineJiMengImage:
		image.References.MaxImages = 14
		image.References.MaskSupported = false
		image.Quality.Supported = false
		image.TransparentBackground.Supported = false
		image.ResponseFormat.Supported = false
		image.OutputFormat.Supported = false
	case model.ChannelInterfaceGeminiImage:
		image.References.MaskSupported = false
		// Gemini Images uses imageConfig.aspectRatio, not the OpenAI-style pixel size field.
		image.Size = ImageSizeConfig{Parameter: "aspect_ratio", Values: []string{"auto", "1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"}, Default: "1:1", AllowCustom: false}
		image.TransparentBackground.Supported = false
		image.ResponseFormat.Supported = false
		image.OutputFormat.Supported = false
		image.MaxOutputs = 4
	case model.ChannelInterfaceAPIMartImage:
		image.References.MaskSupported = false
		image.Size = ImageSizeConfig{Parameter: "aspect_ratio", Values: []string{"auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9", "9:21"}, Default: "1:1", AllowCustom: true}
		image.Quality = ImageQualityConfig{Supported: true, Values: []string{"1k", "2k", "4k"}, Default: "2k"}
		image.TransparentBackground.Supported = false
		image.ResponseFormat.Supported = false
		image.OutputFormat.Supported = false
		image.MaxOutputs = 4
	case model.ChannelInterfaceAPIMartMJ:
		// Midjourney 一次固定返回四张单图，垫图最多 4 张。局部重绘走上游 inpaint + modal，
		// 不使用画布蒙版；画布的 1k/2k/4k 档位也不是 MJ 的 --q，因此质量档位整体关闭。
		// 比例枚举必须与插件请求模板的白名单一致，否则画布选中的比例会被协议丢弃。
		// 画布 1K 预设会把 9:21 归一化成 3:7，因此这里用 3:7 而不是 9:21。
		image.References.MaskSupported = false
		image.References.MaxImages = 4
		image.Size = ImageSizeConfig{Parameter: "aspect_ratio", Values: []string{"1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "21:9", "3:7"}, Default: "1:1", AllowCustom: false}
		image.Quality.Supported = false
		image.TransparentBackground.Supported = false
		image.ResponseFormat.Supported = false
		image.OutputFormat.Supported = false
		image.MaxOutputs = 4
		// Midjourney 一次 imagine 固定返回四张单图，画布只能发一次请求。
		image.BatchOutputs = 4
	}
	if model.ChannelInterfaceType(protocol) != model.ChannelInterfaceGrokImage && strings.HasPrefix(strings.ToLower(strings.TrimSpace(modelName)), "grok-imagine-image") {
		image.References.MaxImages = 0
		image.References.MaskSupported = false
		image.Size = ImageSizeConfig{Parameter: "aspect_ratio", Values: []string{"1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2"}, Default: "1:1", AllowCustom: false}
		image.Quality = ImageQualityConfig{Supported: true, Values: []string{"1k", "2k"}, Default: "2k"}
		image.TransparentBackground = VideoBooleanConfig{Supported: false, Default: false}
		image.ResponseFormat = ParameterSupport{Supported: true}
		image.OutputFormat = ParameterSupport{Supported: false}
		image.MaxOutputs = 1
	}
	return image
}

func defaultImageSizeValues() []string {
	return []string{
		"auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "21:9", "9:16",
		"1024x1024", "1360x1024", "1024x1360", "1536x1024", "1024x1536", "1024x1280", "1280x1024", "2048x878", "1824x1024", "1024x1824",
		"2048x2048", "2304x1728", "1728x2304", "2496x1664", "1664x2496", "1792x2240", "2240x1792", "3136x1344", "2752x1536", "1536x2752",
		"2880x2880", "3264x2448", "2448x3264", "3504x2336", "2336x3504", "2560x3200", "3200x2560", "3808x1632", "3840x2160", "2160x3840",
	}
}

// legacyImageSizeValues 用于修复旧数据中仅保存了 "*" 的图片尺寸能力。
// 这组值是前后台共同展示的基础预设，不能让历史通配符配置继续污染用户生成参数。
func legacyImageSizeValues() []string {
	return []string{
		"1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "21:9", "9:16",
		"1024x1024", "1536x1024", "1024x1536",
	}
}

func DefaultModelCapabilityConfigForModel(protocol string, modelName string) *ModelCapabilityConfig {
	// 文本模型是否支持视觉输入不能从协议或模型名可靠推断，默认关闭，由管理员按真实上游能力开启。
	streaming := true
	text := &TextCapabilityConfig{Streaming: &streaming, ContextWindowTokens: 128000, MaxOutputTokens: 16384, References: TextReferenceConfig{PromptMaxChars: 32000}}
	video := &VideoCapabilityConfig{
		References:        VideoReferenceConfig{PromptMaxChars: DefaultVideoPromptMaxChars, MinImages: 0, MaxImages: 9, MaxImageBytes: 30 * 1024 * 1024, MaxVideos: 0, MaxVideoBytes: 0, MaxVideoDuration: 0, MaxAudios: 0, MaxAudioBytes: 0, MaxAudioDuration: 0, ImageRoles: []string{"first_frame"}},
		Duration:          VideoDurationConfig{Selection: "range", Min: 1, Max: 15, Step: 1, Default: 6},
		Ratios:            []string{"16:9", "9:16", "1:1", "4:3", "3:4", "21:9"},
		DefaultRatio:      "16:9",
		Resolutions:       []string{"480p", "720p", "1080p", "1440p", "2160p"},
		DefaultResolution: "720p",
		GenerateAudio:     VideoBooleanConfig{Supported: false, Default: false},
		Watermark:         VideoBooleanConfig{Supported: false, Default: false},
		Operations:        []string{"text_to_video", "image_to_video"},
		DefaultOperation:  "text_to_video",
	}
	switch model.ChannelInterfaceType(protocol) {
	case model.ChannelInterfaceVolcengineJiMengVideo:
		video.Duration = VideoDurationConfig{Selection: "enum", Values: []int{5, 10}, Default: 5}
		video.Resolutions = []string{"720p"}
	case model.ChannelInterfaceGeminiVeo:
		video.Duration = VideoDurationConfig{Selection: "enum", Values: []int{4, 6, 8}, Default: 6}
		video.Resolutions = []string{"720p", "1080p"}
	case model.ChannelInterfaceVolcengineArkVideo, model.ChannelInterfaceVolcengineArkAgentPlanVideo:
		video.Operations = append(video.Operations, "reference_to_video", "audio_to_video")
		video.References.ImageRoles = []string{"first_frame", "last_frame", "reference_image"}
		video.References.MaxVideos, video.References.MaxAudios = 3, 3
		video.References.MaxVideoBytes, video.References.MaxAudioBytes = 200*1024*1024, 15*1024*1024
		video.References.MaxVideoDuration, video.References.MaxAudioDuration = 15, 15
		video.GenerateAudio = VideoBooleanConfig{Supported: true, Default: true}
		video.Watermark = VideoBooleanConfig{Supported: true, Default: false}
		video.Resolutions = []string{"480p", "720p", "1080p"}
	case model.ChannelInterfaceNewAPIChannel1, model.ChannelInterfaceNewAPIChannel2, model.ChannelInterfaceAPIMartVideo:
		video.References.MaxVideos, video.References.MaxAudios = 3, 3
		video.References.MaxVideoBytes, video.References.MaxAudioBytes = 200*1024*1024, 15*1024*1024
		video.References.MaxVideoDuration, video.References.MaxAudioDuration = 15, 15
		video.GenerateAudio = VideoBooleanConfig{Supported: true, Default: true}
		if model.ChannelInterfaceType(protocol) == model.ChannelInterfaceAPIMartVideo {
			video = applyAPIMartVideoCapability(video, modelName)
		}
		if model.ChannelInterfaceType(protocol) == model.ChannelInterfaceNewAPIChannel1 {
			video.Resolutions = []string{"480p", "720p", "1080p"}
		}
	case model.ChannelInterfaceNewAPIVideo, model.ChannelInterfaceXAIVideo:
		video.GenerateAudio = VideoBooleanConfig{Supported: false, Default: false}
	case model.ChannelInterfaceNovitaVideo:
		video.References.MaxImages, video.References.MaxImageBytes = 1, 10*1024*1024
		video.Duration = VideoDurationConfig{Selection: "enum", Values: []int{5, 10}, Default: 5}
		video.Ratios = []string{"16:9", "9:16", "1:1"}
		video.Resolutions = []string{"1080p"}
		video.DefaultResolution = "1080p"
	case model.ChannelInterfaceMiniMaxVideo:
		video.Operations = append(video.Operations, "reference_to_video")
		video.References.ImageRoles = []string{"first_frame", "last_frame", "reference_image"}
		video.References.MaxImages = 9
		video.References.MaxImageBytes = 30 * 1024 * 1024
		video.References.MaxVideos = 3
		video.References.MaxVideoBytes = 50 * 1024 * 1024
		video.References.MaxVideoDuration = 15
		video.References.MaxAudios = 3
		video.References.MaxAudioBytes = 15 * 1024 * 1024
		video.References.MaxAudioDuration = 15
		video.Duration = VideoDurationConfig{Selection: "enum", Values: []int{4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15}, Default: 5}
		video.Ratios = []string{"adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"}
		video.DefaultRatio = "16:9"
		video.Resolutions = []string{"768P", "2K"}
		video.DefaultResolution = "768P"
		video.Watermark = VideoBooleanConfig{Supported: true, Default: false}
	case model.ChannelInterfaceAgnesVideo:
		video = applyModelSpecificVideoCapability(video, protocol, modelName)
	}
	if strings.EqualFold(strings.TrimSpace(protocol), "lk888-video") {
		applyLK888VideoCapability(video, modelName)
	}
	if strings.EqualFold(strings.TrimSpace(protocol), "lk888-seedance") || strings.EqualFold(strings.TrimSpace(protocol), "lk888-seedance-anmiao") {
		applyLK888SeedanceCapability(video, modelName)
	}
	return &ModelCapabilityConfig{Version: 1, Text: text, Image: DefaultImageCapabilityConfig(protocol, modelName), Video: video}
}

func applyLK888SeedanceCapability(video *VideoCapabilityConfig, modelName string) {
	key := strings.ToLower(strings.TrimSpace(modelName))
	video.Operations = []string{"text_to_video", "image_to_video", "reference_to_video"}
	video.References.ImageRoles = []string{"first_frame", "last_frame", "reference_image"}
	video.References.MaxImages, video.References.MaxVideos, video.References.MaxAudios = 9, 3, 3
	video.References.MaxVideoBytes, video.References.MaxAudioBytes = 200*1024*1024, 15*1024*1024
	video.References.MaxVideoDuration, video.References.MaxAudioDuration = 15, 15
	video.Duration = VideoDurationConfig{Selection: "range", Min: 4, Max: 15, Step: 1, Default: 5}
	video.Ratios = []string{"adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"}
	video.DefaultRatio = "adaptive"
	video.Resolutions = []string{"480p", "720p", "1080p", "4k"}
	if strings.Contains(key, "fast") || strings.Contains(key, "mini") {
		video.Resolutions = []string{"480p", "720p"}
	}
	video.DefaultResolution = "720p"
}

func applyLK888VideoCapability(video *VideoCapabilityConfig, modelName string) {
	switch strings.ToLower(strings.TrimSpace(modelName)) {
	case "minimax-h3":
		video.Operations = []string{"text_to_video", "image_to_video", "reference_to_video"}
		video.References.ImageRoles = []string{"first_frame", "last_frame", "reference_image"}
		video.References.MaxImages = 9
		video.References.MaxImageBytes = 30 * 1024 * 1024
		video.References.MaxVideos = 3
		video.References.MaxVideoBytes = 50 * 1024 * 1024
		video.References.MaxVideoDuration = 15
		video.References.MaxAudios = 3
		video.References.MaxAudioBytes = 15 * 1024 * 1024
		video.References.MaxAudioDuration = 15
		video.Duration = VideoDurationConfig{Selection: "range", Min: 4, Max: 15, Step: 1, Default: 5}
		video.Ratios = []string{"adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"}
		video.DefaultRatio = "adaptive"
		video.Resolutions = []string{"768P", "1080P", "2K", "4K"}
		video.DefaultResolution = "768P"
	case "kling-v3-video":
		video.Operations = []string{"text_to_video", "image_to_video"}
		video.References.ImageRoles = []string{"first_frame", "last_frame"}
		video.References.MaxImages = 2
		video.References.MaxVideos = 0
		video.References.MaxAudios = 0
		video.Duration = VideoDurationConfig{Selection: "enum", Values: []int{5, 10, 15}, Default: 5}
		video.Ratios = []string{"16:9", "9:16", "1:1"}
		video.DefaultRatio = "16:9"
		video.Resolutions = []string{"720p", "1080p"}
		video.DefaultResolution = "720p"
	case "wan3.0-video-cankaosheng":
		video.Operations = []string{"text_to_video", "image_to_video", "reference_to_video"}
		video.References.ImageRoles = []string{"first_frame", "reference_image"}
		video.References.MaxImages = 10
		video.References.MaxVideos = 0
		video.References.MaxAudios = 0
		video.Duration = VideoDurationConfig{Selection: "range", Min: 2, Max: 30, Step: 1, Default: 5}
		video.Ratios = []string{"adaptive", "16:9", "9:16", "1:1", "4:3", "3:4"}
		video.DefaultRatio = "adaptive"
		video.Resolutions = []string{"480P", "720P", "1080P"}
		video.DefaultResolution = "720P"
		video.GenerateAudio = VideoBooleanConfig{Supported: true, Default: false}
	case "video-enhance":
		video.Operations = []string{"video_to_video"}
		video.DefaultOperation = "video_to_video"
		video.References.MinImages = 0
		video.References.MaxImages = 0
		video.References.MaxVideos = 1
		video.References.MaxVideoBytes = 2 * 1024 * 1024 * 1024
		video.References.MaxVideoDuration = 600
		video.References.MaxAudios = 0
		video.Duration = VideoDurationConfig{Selection: "range", Min: 1, Max: 600, Step: 1, Default: 1}
		video.Ratios = nil
		video.DefaultRatio = ""
		video.Resolutions = []string{"720p", "1080p", "2k", "4k", "8k"}
		video.DefaultResolution = "1080p"
		video.GenerateAudio = VideoBooleanConfig{Supported: false, Default: false}
		video.Watermark = VideoBooleanConfig{Supported: false, Default: false}
	}
}
