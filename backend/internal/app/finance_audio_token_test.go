package app

import (
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

// 音频（TTS）Token 计费端到端：按输入量（字符数）下单、按输入价算预授权，
// 输出与缓存价必须为 0，没有待合成文本时不能编造用量。
func TestAudioTokenOrderBillsInputCharacters(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "channel", Scope: model.ChannelScopeSystem, Name: "音频渠道", Enabled: true, ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	request := ChannelModelRequest{
		ModelKey: "doubao-tts-2.0", DisplayName: "豆包语音合成 2.0", ChannelLabel: "火山引擎官方直连",
		Capability: "audio", Protocol: string(model.ChannelInterfaceAsyncAudio),
		PriceTiers: []ChannelModelPriceTierRequest{{
			BillingMode: "token", InputTokenPriceMicrocredits: 514_800_000, PriceConfigured: true,
			CostPricing: model.CreditCostPricing{Configured: true, InputTokenPriceMicrocredits: 300_000_000},
		}},
	}
	saved, err := svc.SaveAdminChannelModel(admin, channel.ID, "", request)
	if err != nil {
		t.Fatal(err)
	}
	order, err := svc.newBillingOrder("user", "task", "request", channel.ID, saved.ModelKey, "audio", "tts", 0,
		estimateTaskBillingTokens(map[string]any{"prompt": "你好，世界"}, "audio"))
	if err != nil {
		t.Fatal(err)
	}
	// 5 个字符 × 514.8 积分/百万 Token = 2574 微积分。
	if order.BillingMode != "token" || order.InputTokens != 5 || order.Quantity != 5 || order.AmountMicrocredits != 2_574 || order.ReservedAmountMicrocredits != 2_574 {
		t.Fatalf("unexpected audio order: %#v", order)
	}
	if order.InputTokenPriceMicrocredits != 514_800_000 || order.OutputTokenPriceMicrocredits != 0 || order.CachedTokenPriceMicrocredits != 0 || order.VideoFormulaTokens != 0 {
		t.Fatalf("unexpected audio order prices: %#v", order)
	}
	if _, err := svc.newBillingOrder("user", "task-blank", "request-blank", channel.ID, saved.ModelKey, "audio", "tts", 0, tokenBillingEstimate{}); err == nil {
		t.Fatal("audio order without synthesizable text was accepted")
	}
	request.PriceTiers[0].OutputTokenPriceMicrocredits = 1
	if _, err := svc.SaveAdminChannelModel(admin, channel.ID, saved.ID, request); err == nil || !strings.Contains(err.Error(), "音频") {
		t.Fatalf("audio output price was accepted: %v", err)
	}
}
