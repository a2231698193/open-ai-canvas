package app

import (
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestValidateChannelModelPriceSupportsAllVideoTokens(t *testing.T) {
	const outputPrice = int64(16_000_000)
	if !ValidateChannelModelPrice("token", "video", model.ChannelInterfaceVolcengineArkVideo, 0, 0, outputPrice, 0) {
		t.Fatal("Volcengine Ark video Token price should be valid")
	}
	for _, protocol := range []model.ChannelInterfaceType{model.ChannelInterfaceVolcengineJiMengVideo, model.ChannelInterfaceNewAPIVideo} {
		if !ValidateChannelModelPrice("token", "video", protocol, 0, 0, outputPrice, 0) {
			t.Fatalf("video protocol %q should support Token pricing", protocol)
		}
	}
}

func TestHasValidPriceUsesChannelProtocolForTokenTiers(t *testing.T) {
	tier := model.ChannelModelPriceTier{Enabled: true, PriceConfigured: true, BillingMode: "token", OutputTokenPriceMicrocredits: 16_000_000}
	ark := &model.ChannelModel{Capability: "video", Protocol: model.ChannelInterfaceVolcengineArkVideo, PriceTiers: []model.ChannelModelPriceTier{tier}}
	if !HasValidPrice(ark) {
		t.Fatal("Volcengine Ark video Token tier should be valid")
	}

	jimeng := &model.ChannelModel{Capability: "video", Protocol: model.ChannelInterfaceVolcengineJiMengVideo, PriceTiers: []model.ChannelModelPriceTier{tier}}
	if !HasValidPrice(jimeng) {
		t.Fatal("JiMeng video Token tier should be valid")
	}
}

func TestValidateChannelModelPriceSupportsAudioInputTokens(t *testing.T) {
	// 豆包语音合成 2.0：514.8 积分 / 100 万输入 Token。
	const inputPrice = int64(514_800_000)
	if !ValidateChannelModelPrice("token", "audio", model.ChannelInterfaceAsyncAudio, inputPrice, 0, 0, 0) {
		t.Fatal("audio input-only Token price should be valid")
	}
	// 与视频一致：价格全为 0 表示免费，允许先建模型再调价。
	if !ValidateChannelModelPrice("token", "audio", model.ChannelInterfaceAsyncAudio, 0, 0, 0, 0) {
		t.Fatal("free audio Token price should be valid")
	}
	for _, prices := range [][3]int64{{inputPrice, 1, 0}, {inputPrice, 0, 1}, {inputPrice, 1, 1}} {
		if ValidateChannelModelPrice("token", "audio", model.ChannelInterfaceAsyncAudio, 0, prices[0], prices[1], prices[2]) {
			t.Fatalf("audio Token price accepted output/cached rates: %v", prices)
		}
	}
	if err := validateTokenPrices("audio", inputPrice, 0, 0); err != nil {
		t.Fatalf("validateTokenPrices(audio) error = %v", err)
	}
	if err := validateTokenPrices("audio", 0, inputPrice, 0); err == nil || !strings.Contains(err.Error(), "音频") {
		t.Fatalf("validateTokenPrices(audio) accepted an output price: %v", err)
	}
	tier := model.ChannelModelPriceTier{Enabled: true, PriceConfigured: true, BillingMode: "token", InputTokenPriceMicrocredits: inputPrice}
	audio := &model.ChannelModel{Capability: "audio", Protocol: model.ChannelInterfaceAsyncAudio, PriceTiers: []model.ChannelModelPriceTier{tier}}
	if !HasValidPrice(audio) {
		t.Fatal("audio input-only Token tier should be valid")
	}
}
