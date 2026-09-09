package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"math"
	"os"
	"strconv"
	"strings"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

type pricingDocument struct {
	Data struct {
		Models struct {
			Video []pricingModel `json:"video"`
		} `json:"models"`
	} `json:"data"`
}

type pricingModel struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Alias       string      `json:"alias"`
	BillingType string      `json:"billing_type"`
	FixedPrices fixedPrices `json:"fixed_prices"`
}

type fixedPrices struct {
	Unit  string        `json:"unit"`
	Items []pricingItem `json:"items"`
}

type pricingItem struct {
	Key           string  `json:"key"`
	AfterDiscount float64 `json:"after_discount"`
}

type importResult struct {
	ModelID string
	Model   *model.ChannelModel
	Tiers   []model.ChannelModelPriceTier
	Skipped []string
}

func main() {
	pricingPath := flag.String("pricing", "/app/apimart-pricing.json", "APIMart pricing JSON")
	channelName := flag.String("channel-name", "apimart", "system channel name")
	channelID := flag.String("channel-id", "", "system channel ID; takes precedence over channel-name")
	apply := flag.Bool("apply", false, "write matched model prices")
	flag.Parse()

	db, err := database.Open(database.Config{Driver: "postgres", DSN: os.Getenv("DATABASE_URL"), DataDir: os.Getenv("CANVAS_BACKEND_DATA_DIR")})
	if err != nil {
		log.Fatal(err)
	}
	if err := database.ConfigurePool(db); err != nil {
		log.Fatal(err)
	}
	if err := database.RequireSchemaVersion(db); err != nil {
		log.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatal(err)
	}
	defer sqlDB.Close()

	var document pricingDocument
	content, err := os.ReadFile(*pricingPath)
	if err != nil {
		log.Fatalf("读取价格文件失败：%v", err)
	}
	if err := json.Unmarshal(content, &document); err != nil {
		log.Fatalf("解析价格文件失败：%v", err)
	}
	if len(document.Data.Models.Video) == 0 {
		log.Fatal("价格文件没有视频模型")
	}

	repo := repository.New(db)
	channel, err := findChannel(repo, strings.TrimSpace(*channelID), strings.TrimSpace(*channelName))
	if err != nil {
		log.Fatal(err)
	}
	models, err := repo.ChannelModels(channel.ID, true)
	if err != nil {
		log.Fatal(err)
	}
	pricingByKey := make(map[string]pricingModel, len(document.Data.Models.Video))
	for _, item := range document.Data.Models.Video {
		pricingByKey[normalizeKey(item.ID)] = item
		if item.Alias != "" {
			pricingByKey[normalizeKey(item.Alias)] = item
		}
	}

	matched := 0
	for index := range models {
		item := &models[index]
		pricing, ok := pricingByKey[normalizeKey(item.ModelKey)]
		if !ok {
			pricing, ok = pricingByKey[normalizeKey(item.ProviderModelKey)]
		}
		if !ok {
			continue
		}
		initialized := false
		if item.Capability != "video" {
			if strings.TrimSpace(item.Capability) != "" || strings.TrimSpace(string(item.Protocol)) != "" {
				continue
			}
			configureAPIMartVideoModel(item)
			initialized = true
		}
		matched++
		result, err := buildImportResult(item, pricing, repo, *apply)
		if err != nil {
			log.Fatalf("模型 %s 处理失败：%v", item.ModelKey, err)
		}
		printResult(result, *apply)
		if initialized {
			log.Printf("  initialize capability=video protocol=%s providerModelKey=%s enabled=true", item.Protocol, item.ProviderModelKey)
		}
		if *apply {
			if err := repo.SaveChannelModelWithPriceTiers(result.Model, result.Tiers); err != nil {
				log.Fatalf("模型 %s 保存失败：%v", item.ModelKey, err)
			}
		}
	}
	if matched == 0 {
		log.Fatalf("渠道 %q 中没有匹配到已添加的视频模型；只按 modelKey/providerModelKey 精确匹配，不会自动创建模型", channel.Name)
	}
	if *apply {
		log.Printf("导入完成：渠道=%s(%s)，匹配模型=%d", channel.Name, channel.ID, matched)
	} else {
		log.Printf("dry-run 完成：渠道=%s(%s)，匹配模型=%d；确认后使用 --apply 写入", channel.Name, channel.ID, matched)
	}
}

func findChannel(repo *repository.Repository, id string, name string) (*model.ModelChannel, error) {
	channels, err := repo.SystemChannels(true)
	if err != nil {
		return nil, err
	}
	if id != "" {
		for index := range channels {
			if channels[index].ID == id {
				return &channels[index], nil
			}
		}
		return nil, fmt.Errorf("找不到系统渠道 ID %q", id)
	}
	var matches []*model.ModelChannel
	for index := range channels {
		if strings.EqualFold(strings.TrimSpace(channels[index].Name), name) {
			matches = append(matches, &channels[index])
		}
	}
	if len(matches) != 1 {
		return nil, fmt.Errorf("按名称 %q 找到 %d 个系统渠道，请改用 --channel-id", name, len(matches))
	}
	return matches[0], nil
}

func configureAPIMartVideoModel(item *model.ChannelModel) {
	item.ProviderModelKey = item.ModelKey
	item.Capability = "video"
	item.Protocol = model.ChannelInterfaceAPIMartVideo
	item.Enabled = true
	item.CapabilityVersion++
	item.CapabilityConfigJSON = string(apimartVideoCapabilityJSON(item.ModelKey))
}

func apimartVideoCapabilityJSON(modelKey string) []byte {
	promptMaxChars, maxImages, maxVideos, maxAudios := 1000, 0, 0, 0
	maxImageBytes := 30 * 1024 * 1024
	maxVideoBytes, maxAudioBytes := 0, 0
	maxVideoDuration, maxAudioDuration := 0, 0
	resolutions, defaultResolution := []string{"480p", "720p", "1080p"}, "720p"
	ratios, defaultRatio := []string{"16:9", "9:16", "1:1"}, "16:9"
	minDuration, maxDuration := 1, 15
	generateAudioSupported, generateAudioDefault := false, false
	watermarkSupported := false
	operations := []string{"text_to_video", "image_to_video"}
	switch strings.ToLower(strings.TrimSpace(modelKey)) {
	case "minimax-h3":
		promptMaxChars, maxImages, maxVideos, maxAudios = 7000, 9, 3, 3
		maxVideoBytes, maxAudioBytes, maxVideoDuration, maxAudioDuration = 50*1024*1024, 15*1024*1024, 15, 15
		resolutions, defaultResolution, minDuration, maxDuration = []string{"768P", "2K"}, "2K", 4, 15
		ratios = []string{"adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"}
		watermarkSupported = true
		operations = append(operations, "reference_to_video")
	case "seedance-1-5-pro":
		maxImages, minDuration, maxDuration = 2, 4, 12
		resolutions = []string{"480p", "720p", "1080p"}
		ratios = []string{"16:9", "9:16", "1:1", "4:3", "3:4", "21:9"}
		generateAudioSupported, generateAudioDefault = true, true
	case "seedance-2.0", "seedance-2.0-mini":
		maxImages, maxVideos, maxAudios = 9, 3, 3
		maxVideoBytes, maxAudioBytes, maxVideoDuration, maxAudioDuration = 200*1024*1024, 15*1024*1024, 15, 15
		minDuration, maxDuration = 5, 15
		resolutions = []string{"480p", "720p"}
		if strings.EqualFold(modelKey, "seedance-2.0") {
			resolutions = append(resolutions, "1080p", "4k")
		}
		ratios = []string{"adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"}
		generateAudioSupported, generateAudioDefault = true, true
		operations = append(operations, "reference_to_video")
	case "seedance-2.5":
		maxImages, maxVideos, maxAudios = 30, 10, 10
		maxVideoBytes, maxAudioBytes, maxVideoDuration, maxAudioDuration = 200*1024*1024, 15*1024*1024, 30, 30
		minDuration, maxDuration = 4, 30
		resolutions = []string{"480p", "720p", "1080p"}
		ratios, defaultRatio = []string{"adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"}, "adaptive"
		generateAudioSupported, generateAudioDefault, watermarkSupported = true, true, true
		operations = append(operations, "reference_to_video", "audio_to_video")
	case "kling-3.0-turbo":
		promptMaxChars, maxImages, maxImageBytes = 3072, 1, 50*1024*1024
		resolutions, minDuration, maxDuration = []string{"720p", "1080p"}, 3, 15
		watermarkSupported = true
	case "kling-v3":
		maxImages = 2
		resolutions, minDuration, maxDuration = []string{"720p", "1080p", "4k"}, 3, 15
		generateAudioSupported, watermarkSupported = true, true
	}
	config := map[string]any{
		"version": 1,
		"video": map[string]any{
			"references": map[string]any{"promptMaxChars": promptMaxChars, "minImages": 0, "maxImages": maxImages, "maxImageBytes": maxImageBytes, "maxVideos": maxVideos, "maxVideoBytes": maxVideoBytes, "maxVideoDurationSeconds": maxVideoDuration, "maxAudios": maxAudios, "maxAudioBytes": maxAudioBytes, "maxAudioDurationSeconds": maxAudioDuration},
			"duration":   map[string]any{"selection": "range", "min": minDuration, "max": maxDuration, "step": 1, "default": 5},
			"ratios":     ratios, "defaultRatio": defaultRatio, "resolutions": resolutions, "defaultResolution": defaultResolution,
			"generateAudio": map[string]any{"supported": generateAudioSupported, "default": generateAudioDefault}, "watermark": map[string]any{"supported": watermarkSupported, "default": false},
			"operations": operations, "defaultOperation": "text_to_video",
		},
	}
	encoded, _ := json.Marshal(config)
	return encoded
}

func buildImportResult(item *model.ChannelModel, pricing pricingModel, repo *repository.Repository, apply bool) (*importResult, error) {
	result := &importResult{ModelID: pricing.ID, Model: item}
	seen := map[string]bool{}
	for _, source := range pricing.FixedPrices.Items {
		selector, supported := selectorForVideoPrice(pricing.ID, source.Key)
		if !supported {
			result.Skipped = append(result.Skipped, source.Key)
			continue
		}
		_, selectorKey, err := model.CanonicalSKUSelector(selector)
		if err != nil {
			return nil, err
		}
		if seen[selectorKey] {
			result.Skipped = append(result.Skipped, source.Key+"(重复规格)")
			continue
		}
		seen[selectorKey] = true
		unitPrice := creditsToMicrocredits(source.AfterDiscount)
		billingMode := "fixed_request"
		if pricing.BillingType == "per_second" {
			billingMode = "per_second"
		}
		tierID := fmt.Sprintf("DRYRUN-%d", len(result.Tiers)+1)
		if apply {
			var err error
			tierID, err = repo.NextPrefixedID("PTIER")
			if err != nil {
				return nil, err
			}
		}
		resolution := "*"
		videoSeconds := 0
		if value := selector["vquality"]; value != "" {
			resolution = value
		}
		if value := selector["videoSeconds"]; value != "" {
			videoSeconds, _ = strconv.Atoi(value)
		}
		result.Tiers = append(result.Tiers, model.ChannelModelPriceTier{
			ID: tierID, ChannelModelID: item.ID, SelectorKey: selectorKey, SelectorJSON: selectorKey,
			Selector: selector, Resolution: resolution, VideoSeconds: videoSeconds,
			ProviderModelKey: item.ProviderModelKey, BillingMode: billingMode,
			UnitPriceMicrocredits: unitPrice, PriceConfigured: true, Enabled: true, PriceVersion: item.PriceVersion + 1,
		})
	}
	if len(result.Tiers) == 0 {
		return nil, errors.New("没有可映射到系统价格档的规格")
	}
	applyPriceSummary(item, result.Tiers)
	return result, nil
}

func selectorForVideoPrice(modelID string, raw string) (map[string]string, bool) {
	key := strings.ToLower(strings.TrimSpace(raw))
	if key == "" {
		return map[string]string{}, true
	}
	if strings.EqualFold(modelID, "kling-v3") {
		switch key {
		case "default":
			return map[string]string{"vquality": "720p"}, true
		case "pro":
			return map[string]string{"vquality": "1080p"}, true
		case "4k":
			return map[string]string{"vquality": "2160p"}, true
		case "sound":
			return map[string]string{"vquality": "720p", "videoGenerateAudio": "true"}, true
		case "pro-sound":
			return map[string]string{"vquality": "1080p", "videoGenerateAudio": "true"}, true
		case "4k-sound":
			return map[string]string{"vquality": "2160p", "videoGenerateAudio": "true"}, true
		}
	}
	if key == "default" {
		return map[string]string{}, true
	}
	selector := map[string]string{}
	parts := strings.Split(key, "-")
	for _, part := range parts {
		switch part {
		case "2k":
			selector["vquality"] = "1440p"
		case "4k":
			selector["vquality"] = "2160p"
		case "480p", "512p", "540p", "720p", "768p", "1080p", "1024p", "360p":
			selector["vquality"] = part
		case "4s", "5s", "6s", "8s", "10s", "12s", "15s", "30s":
			selector["videoSeconds"] = strings.TrimSuffix(part, "s")
		case "input":
			selector["operation"] = "image_to_video"
		case "refvideo", "vidref":
			selector["operation"] = "reference_to_video"
		case "extend":
			selector["operation"] = "extend"
		case "v2v":
			selector["operation"] = "video_to_video"
		case "audio":
			selector["videoGenerateAudio"] = "true"
		default:
			// APIMart uses names such as pro and sound for non-resolution variants.
			// Keep them as a size selector; the protocol maps the selected quality
			// to the provider's corresponding mode.
			selector["size"] = joinSelectorSize(selector["size"], part)
		}
	}
	return selector, len(selector) > 0
}

func joinSelectorSize(current string, next string) string {
	if current == "" {
		return next
	}
	return current + "-" + next
}

func creditsToMicrocredits(usd float64) int64 {
	// APIMart: 1 Credit = 0.10 USD ≈ ¥0.70; 灵感: ¥1 = 10 积分。
	// 价格档只保存成本，因此 1 APIMart Credit = 7 灵感积分，即折后 USD × 70。
	// 运营利润由系统的默认模型倍率统一叠加。
	return int64(math.Round(usd * 70 * 1_000_000))
}

func applyPriceSummary(item *model.ChannelModel, tiers []model.ChannelModelPriceTier) {
	first := tiers[0]
	item.BillingMode = first.BillingMode
	item.UnitPriceMicrocredits = first.UnitPriceMicrocredits
	item.PriceConfigured = true
	item.PriceVersion++
}

func printResult(result *importResult, apply bool) {
	prefix := "DRY-RUN"
	if apply {
		prefix = "APPLY"
	}
	log.Printf("%s model=%s matched=%d skipped=%v", prefix, result.ModelKey(), len(result.Tiers), result.Skipped)
	for _, tier := range result.Tiers {
		log.Printf("  %s => %s microcredits/%s", tier.SelectorKey, formatCredits(tier.UnitPriceMicrocredits), tier.BillingMode)
	}
}

func (r *importResult) ModelKey() string { return r.Model.ModelKey }

func formatCredits(value int64) string {
	return strconv.FormatInt(value, 10)
}

func normalizeKey(value string) string {
	return strings.ToLower(strings.TrimPrefix(strings.TrimSpace(value), "models/"))
}
