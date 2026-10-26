package app

import (
	"errors"
	"math"
	"strconv"
	"strings"

	"yingce/backend/internal/production"
)

var dramaCapabilities = []string{"text", "image", "video"}

func dramaModelIntent(capability string) *ModelRequestIntent {
	switch capability {
	case "image":
		return &ModelRequestIntent{Capability: "image", Operation: "image_to_image", Inputs: map[string]int{"image": 2}}
	case "video":
		return &ModelRequestIntent{Capability: "video", Operation: "image_to_video", Inputs: map[string]int{"image": 1}}
	}
	return &ModelRequestIntent{Capability: "text"}
}

// dramaModelOptions 列出某能力下可由服务端独立执行的模型，与创作端目录同源。
func (s *Service) dramaModelOptions(capability string) ([]DramaModelOption, error) {
	options := []DramaModelOption{}
	seen := map[string]bool{}
	appendOptions := func(intent *ModelRequestIntent) error {
		frontendEnabled, err := s.FeatureEnabled(FeatureFrontendModels)
		if err != nil {
			return err
		}
		if frontendEnabled {
			models, err := s.PublicLogicalModels(intent)
			if err != nil {
				return err
			}
			for _, item := range models {
				if !item.Available || normalizeCapability(item.Capability) != capability || seen["l:"+item.ID] {
					continue
				}
				seen["l:"+item.ID] = true
				choice := DramaModelChoice{LogicalModelID: item.ID, Label: item.Name, PriceLabel: item.PriceLabel}
				if capability == "video" {
					if _, err := s.dramaVideoProfile(choice); err != nil {
						continue
					}
				}
				options = append(options, s.dramaModelOption(choice, capability, item.Name, item.PriceLabel))
			}
		}
		catalog, err := s.ModelCatalog(intent)
		if err != nil {
			return err
		}
		for _, channel := range catalog.Channels {
			for _, item := range channel.Models {
				key := "c:" + channel.ID + ":" + item.ModelKey
				if !item.Available || normalizeCapability(item.Capability) != capability || seen[key] {
					continue
				}
				seen[key] = true
				label := firstNonEmpty(item.DisplayName, item.ModelKey)
				choice := DramaModelChoice{ChannelID: channel.ID, ModelKey: item.ModelKey, Label: label, PriceLabel: item.PriceLabel}
				if capability == "video" {
					if _, err := s.dramaVideoProfile(choice); err != nil {
						continue
					}
				}
				options = append(options, s.dramaModelOption(choice, capability, label, item.PriceLabel))
			}
		}
		return nil
	}
	if err := appendOptions(dramaModelIntent(capability)); err != nil {
		return nil, err
	}

	return options, nil
}

func (s *Service) DramaModelCatalog() (DramaModelCatalog, error) {
	result := DramaModelCatalog{Options: map[string][]DramaModelOption{}}
	for _, capability := range dramaCapabilities {
		options, err := s.dramaModelOptions(capability)
		if err != nil {
			return result, err
		}
		result.Options[capability] = options
		if len(options) > 0 {
			setDramaModelChoice(&result.Defaults, capability, options[0].Choice)
		}
	}
	return result, nil
}

func setDramaModelChoice(models *DramaModels, capability string, choice DramaModelChoice) {
	switch capability {
	case "text":
		models.Text = choice
	case "image":
		models.Image = choice
	case "video":
		models.Video = choice
	}
}

// resolveDramaModels 为未选择的能力补齐默认模型；新用户无需进入任何模型配置即可启动。
func (s *Service) resolveDramaModels(models DramaModels) (DramaModels, error) {
	for _, capability := range dramaCapabilities {
		if !models.choice(capability).Empty() {
			continue
		}
		options, err := s.dramaModelOptions(capability)
		if err != nil {
			return models, err
		}
		if len(options) > 0 {
			setDramaModelChoice(&models, capability, options[0].Choice)
		}
	}
	return models, nil
}

func missingDramaCapabilities(models DramaModels) []string {
	labels := map[string]string{"text": "文本", "image": "图片", "video": "视频"}
	missing := []string{}
	for _, capability := range dramaCapabilities {
		if models.choice(capability).Empty() {
			missing = append(missing, labels[capability])
		}
	}
	return missing
}

// dramaVideoProfile 是视频模型能力合同中短剧需要的部分：时长档位、支持的生成方式、参考图上限与是否可开启原声。
type dramaVideoProfile struct {
	Durations     production.DurationOptions
	Operations    []string
	MaxImages     int
	GenerateAudio bool
}

func (p dramaVideoProfile) supports(operation string) bool {

	for _, item := range p.Operations {
		if item == operation {
			return true
		}
	}
	return false
}

func (p dramaVideoProfile) maxSeconds() int {
	return dramaMaxVideoSeconds(p.Durations)
}

func (s *Service) dramaVideoProfile(choice DramaModelChoice) (dramaVideoProfile, error) {
	var capability *ModelCapabilityConfig
	if choice.LogicalModelID != "" {
		routed, err := s.ResolveLogicalModel(choice.LogicalModelID, *dramaModelIntent("video"))
		if err != nil {
			return dramaVideoProfile{}, err
		}
		if routed == nil {
			return dramaVideoProfile{}, errors.New("视频模型路由不存在")
		}
		var parseErr error
		capability, parseErr = normalizedChannelModelCapability(&routed.ChannelModel, s.protocolRegistry())
		if parseErr != nil {
			return dramaVideoProfile{}, parseErr
		}
	} else if choice.ChannelID != "" && choice.ModelKey != "" {
		row, err := s.repo.ChannelModelByKey(choice.ChannelID, choice.ModelKey)
		if err != nil {
			return dramaVideoProfile{}, err
		}
		capability, err = normalizedChannelModelCapability(row, s.protocolRegistry())
		if err != nil {
			return dramaVideoProfile{}, err
		}
	} else {
		return dramaVideoProfile{}, errors.New("请选择视频模型")
	}
	if capability == nil || capability.Video == nil {
		return dramaVideoProfile{}, errors.New("模型未声明视频能力")
	}
	video := capability.Video
	options := production.DurationOptions{Values: video.Duration.Values, Min: video.Duration.Min, Max: video.Duration.Max, Step: video.Duration.Step}
	profile := dramaVideoProfile{Durations: options, Operations: video.Operations, MaxImages: video.References.MaxImages, GenerateAudio: video.GenerateAudio.Supported}
	if profile.maxSeconds() <= 0 {
		return profile, errors.New("视频模型未声明生成时长")
	}
	if !profile.GenerateAudio {
		return profile, errors.New("短剧需要支持原声对白的视频模型")
	}
	if !profile.supports("image_to_video") || (!profile.supports("reference_to_video") && !profile.supports("text_to_video")) {
		return profile, errors.New("视频模型须支持开场生成及尾帧续接")
	}
	return profile, nil
}

func (s *Service) quoteDramaChoice(choice DramaModelChoice, intent ModelRequestIntent) (int64, bool) {
	if choice.Empty() {
		return 0, false
	}
	var quote *LogicalModelQuote
	var err error
	if choice.LogicalModelID != "" {
		quote, err = s.QuoteLogicalModel(choice.LogicalModelID, intent)
	} else {
		quote, err = s.QuoteChannelModel(ChannelModelQuoteRequest{ChannelID: choice.ChannelID, ModelKey: choice.ModelKey, Intent: intent})
	}
	if err != nil || quote == nil {
		return 0, false
	}
	return quote.AmountMicrocredits, true
}

// EstimateDrama 依据真实报价估算整部剧的费用区间；数量按经验比例推算，结果只用于预算决策。
func (s *Service) EstimateDrama(req DramaEstimateRequest) (DramaEstimate, error) {
	settings := req.Settings.normalized()
	models, err := s.resolveDramaModels(settings.Models)
	if err != nil {
		return DramaEstimate{}, err
	}
	chapters := max(req.ChapterCount, 1)
	words := max(req.WordCount, chapters*1000)
	// 竖屏短剧每集约 90 秒，对应原文 2000-3000 字；章节过短时按字数折算。
	episodes := int(math.Round(float64(words) / 2500 * 90 / float64(settings.EpisodeSeconds)))
	episodes = max(episodes, 1)
	shotsPerEpisode := settings.Storyboard.ShotTarget(settings.EpisodeSeconds)
	profile, err := s.dramaVideoProfile(models.Video)
	if err != nil {
		return DramaEstimate{}, err
	}
	// 一个剧情段一次视频调用；智能模式按模型上限估算，是调用次数的下限。
	segmentSeconds := max(settings.Storyboard.SegmentLimits(profile.maxSeconds()).TargetSeconds(), 1)
	segmentsPerEpisode := max(1, int(math.Ceil(float64(settings.EpisodeSeconds)/float64(segmentSeconds))))
	casts := min(60, 12+episodes/3)
	estimate := DramaEstimate{
		Episodes:        episodes,
		Shots:           episodes * shotsPerEpisode,
		Images:          casts,
		Videos:          episodes * segmentsPerEpisode,
		TextCalls:       1 + (chapters+9)/10 + episodes*(1+segmentsPerEpisode),
		DurationMinutes: episodes * settings.EpisodeSeconds / 60,
	}
	textCost, okText := s.quoteDramaChoice(models.Text, ModelRequestIntent{Capability: "text"})
	imageCost, okImage := s.quoteDramaChoice(models.Image, *dramaModelIntent("image"))
	videoCost, okVideo := s.quoteDramaChoice(models.Video, ModelRequestIntent{Capability: "video", Operation: "image_to_video", Inputs: map[string]int{"image": 1}, Options: map[string]any{"videoSeconds": itoa(production.SnapVideoSeconds(int64(segmentSeconds)*1000, profile.Durations))}})
	total := int64(estimate.TextCalls)*textCost + int64(estimate.Images)*imageCost + int64(estimate.Videos)*videoCost
	sample := textCost*int64(2+segmentsPerEpisode) + int64(casts)*imageCost + int64(segmentsPerEpisode)*videoCost
	estimate.Priced = okText || okImage || okVideo
	estimate.MinMicrocredits = total * 9 / 10
	// 上限包含失败重试与返工的余量。
	estimate.MaxMicrocredits = total * 14 / 10
	estimate.SampleMicrocredit = sample
	notes := []string{}
	if !(okText && okImage && okVideo) {
		notes = append(notes, "部分模型暂无报价，费用按已知部分估算")
	}
	if missing := missingDramaCapabilities(models); len(missing) > 0 {
		notes = append(notes, "尚无可用的"+strings.Join(missing, "、")+"模型")
	}
	estimate.Note = strings.Join(notes, "；")
	return estimate, nil
}

// dramaImageSpec 读取图片模型的能力合同；与云端 Agent 生图选项同一加载方式。
func (s *Service) dramaImageSpec(choice DramaModelChoice) (CapabilitySpec, map[string]any, bool) {
	defaults := map[string]any{}
	if choice.LogicalModelID != "" {
		snapshot, err := s.routeCatalogSnapshot()
		if err != nil {
			return CapabilitySpec{}, nil, false
		}
		cached, exists := snapshot.Models[choice.LogicalModelID]
		if !exists {
			return CapabilitySpec{}, nil, false
		}
		return cached.ProductSpec, cached.Defaults, true
	}
	if choice.ChannelID == "" {
		return CapabilitySpec{}, nil, false
	}
	item, err := s.repo.ChannelModelByKey(choice.ChannelID, choice.ModelKey)
	if err != nil {
		return CapabilitySpec{}, nil, false
	}
	profile, err := normalizedChannelModelCapability(item, s.protocolRegistry())
	if err != nil {
		return CapabilitySpec{}, nil, false
	}
	spec, err := CapabilitySpecFromModelCapabilityConfig(profile, item.Capability)
	if err != nil {
		return CapabilitySpec{}, nil, false
	}
	applyChannelCapabilityDefaults(defaults, "image", profile)
	return spec, defaults, true
}

// dramaImageSize 把期望画幅换算成所选模型真正接受的 size 值。
// 流水线无人值守，不能把模型不支持的比例（例如没有 3:4 档的模型）直接交给准入校验失败；
// 没有精确档位时取比例最接近的已声明档位，模型不声明尺寸时返回空串交给模型默认值。
func (s *Service) dramaImageSize(choice DramaModelChoice, ratio string) string {
	spec, defaults, ok := s.dramaImageSpec(choice)
	if !ok {
		return ratio
	}
	return dramaImageSizeFor(spec, defaults, ratio)
}

func dramaImageSizeFor(spec CapabilitySpec, defaults map[string]any, ratio string) string {
	constraint, declared := spec.Options["size"]
	if !declared || (spec.ImageSize != nil && spec.ImageSize.Parameter == "none") {
		return ""
	}
	intent := resolveModelRequestIntent(spec, ModelRequestIntent{Capability: "image", Options: map[string]any{"size": ratio}}, defaults)
	if value := stringValue(intent.Options["size"]); value != "" && matchOptionConstraint("size", constraint, value) {
		return value
	}
	target, ok := dramaRatioValue(ratio)
	if !ok {
		return ""
	}
	defaultTier := ""
	candidates := []dramaSizeCandidate{}
	for _, value := range constraint.Values {
		if text := strings.TrimSpace(stringValue(value)); text != "" {
			candidates = append(candidates, dramaSizeCandidate{value: text})
		}
	}
	if spec.ImageSize != nil {
		defaultSize := stringValue(defaults["size"])
		for _, preset := range spec.ImageSize.Presets {
			value := strings.TrimSpace(preset.Ratio)
			if spec.ImageSize.Parameter == "size" {
				value = strings.TrimSpace(preset.Size)
			}
			if strings.EqualFold(preset.Size, defaultSize) {
				defaultTier = preset.Tier
			}
			candidates = append(candidates, dramaSizeCandidate{value: value, ratio: strings.TrimSpace(preset.Ratio), tier: preset.Tier})
		}
	}
	best, bestScore := "", math.Inf(1)
	for _, candidate := range candidates {
		if !matchOptionConstraint("size", constraint, candidate.value) {
			continue
		}
		value, ok := dramaRatioValue(firstNonEmpty(candidate.ratio, candidate.value))
		if !ok {
			continue
		}
		score := math.Abs(math.Log(value) - math.Log(target))
		// 同等接近时优先模型默认档位，避免无意中换到更贵的分辨率。
		if defaultTier != "" && candidate.tier != "" && candidate.tier != defaultTier {
			score += 1e-6
		}
		if score < bestScore {
			best, bestScore = candidate.value, score
		}
	}
	return best
}

type dramaSizeCandidate struct {
	value string
	ratio string
	tier  string
}

// dramaRatioValue 解析 "9:16" 或 "1024x1824" 为宽高比；auto 等非尺寸值返回 false。
func dramaRatioValue(value string) (float64, bool) {
	value = strings.TrimSpace(strings.ToLower(value))
	separator := ":"
	if !strings.Contains(value, ":") {
		separator = "x"
	}
	left, right, found := strings.Cut(value, separator)
	if !found {
		return 0, false
	}
	width, widthErr := strconv.ParseFloat(strings.TrimSpace(left), 64)
	height, heightErr := strconv.ParseFloat(strings.TrimSpace(right), 64)
	if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
		return 0, false
	}
	return width / height, true
}

// dramaSizeRejected 判断准入错误是否只因尺寸参数；只看结构化字段，不解析文案。

func (s *Service) dramaModelOption(choice DramaModelChoice, capability, label, priceLabel string) DramaModelOption {
	option := DramaModelOption{Choice: choice, Capability: capability, Label: label, PriceLabel: priceLabel}
	if capability == "video" {
		if profile, err := s.dramaVideoProfile(choice); err == nil {
			option.MaxVideoSeconds = profile.maxSeconds()
		}
	}
	return option
}

// dramaMaxVideoSeconds 是视频模型单次可生成的最长秒数，也是一个剧情段的时长上限。
func dramaMaxVideoSeconds(options production.DurationOptions) int {
	longest := options.Max
	for _, value := range options.Values {
		longest = max(longest, value)
	}
	return longest
}

// dramaWritingSkill 读取作品选定的视频提示词写作技能；技能不可读时报错，不悄悄退回内置格式。
func (s *Service) dramaWritingSkill(userID string, ref *DramaSkillRef) (*production.WritingSkill, error) {
	if ref == nil {
		return nil, nil
	}
	file, err := s.SkillPackageFile(userID, ref.SkillID, ref.Path)
	if err != nil {
		return nil, BadAuthRequest("视频提示词技能「" + firstNonEmpty(ref.SkillName, ref.SkillID) + "」不可用：" + err.Error())
	}
	if file.Binary || strings.TrimSpace(file.Content) == "" {
		return nil, BadAuthRequest("视频提示词技能文件 " + ref.Path + " 不是文本或为空")
	}
	return &production.WritingSkill{Name: firstNonEmpty(ref.SkillName, ref.SkillID), Path: ref.Path, Content: file.Content}, nil
}
