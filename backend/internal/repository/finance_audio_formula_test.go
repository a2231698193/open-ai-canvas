package repository

import (
	"errors"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

// 音频（TTS）上游不返回 usage：结算必须回落到下单时按待合成文本字符数记录的输入量，
// 并标记 usage_source=audio_formula、usage_available=false，不能伪装成上游真实用量。
func TestAudioTokenSettlementUsesCharacterEstimateSnapshot(t *testing.T) {
	const available = int64(10_000_000)
	const characters = int64(1_000)
	const reserved = int64(514_800)
	for _, restore := range []bool{false, true} {
		mode := "settle"
		if restore {
			mode = "restore"
		}
		t.Run(mode, func(t *testing.T) {
			repo, db := newRefundedBillingRecoveryRepository(t)
			order := model.BillingOrder{
				ID: "order", UserID: "user", IdempotencyKey: "task", Capability: "audio", BillingMode: "token",
				Quantity: characters, InputTokens: characters, AmountMicrocredits: reserved,
				ReservedAmountMicrocredits: reserved, InputTokenPriceMicrocredits: 514_800_000,
				MultiplierBasisPoints: 10000, Status: model.BillingStatusRunning,
			}
			account := model.CreditAccount{UserID: "user", AvailableMicrocredits: available, ReservedMicrocredits: reserved}
			settle := repo.SettleBillingOrder
			if restore {
				settle = repo.RestoreRefundedBillingOrder
				order.Status = model.BillingStatusRefunded
				order.RefundedAmountMicrocredits = reserved
				account.ReservedMicrocredits = 0
				account.AvailableMicrocredits += reserved
			}
			if err := db.Create(&account).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Create(&order).Error; err != nil {
				t.Fatal(err)
			}
			if err := settle("order", "provider-id"); err != nil {
				t.Fatal(err)
			}
			if err := settle("order", "provider-id"); err != nil {
				t.Fatalf("repeat settlement: %v", err)
			}
			if err := db.First(&order, "id = ?", "order").Error; err != nil {
				t.Fatal(err)
			}
			if order.Status != model.BillingStatusSettled || order.ActualAmountMicrocredits != reserved ||
				order.InputTokens != characters || order.OutputTokens != 0 || order.CachedTokens != 0 ||
				order.UsageSource != "audio_formula" || order.UsageAvailable {
				t.Fatalf("unexpected settled audio order: %+v", order)
			}
			if err := db.First(&account, "user_id = ?", "user").Error; err != nil {
				t.Fatal(err)
			}
			if account.AvailableMicrocredits != available || account.ReservedMicrocredits != 0 {
				t.Fatalf("unexpected account after settlement: %+v", account)
			}
			var entries []model.CreditLedgerEntry
			if err := db.Where("billing_order_id = ? AND type = ?", "order", model.CreditLedgerConsume).Find(&entries).Error; err != nil {
				t.Fatal(err)
			}
			if len(entries) != 1 || entries[0].AmountMicrocredits != -reserved {
				t.Fatalf("settlement not idempotent: %+v", entries)
			}
			if !strings.Contains(entries[0].Note, "音频输入量估算") {
				t.Fatalf("audio formula source not recorded: %+v", entries[0])
			}
		})
	}
}

func TestAudioTokenSettlementPrefersProviderUsage(t *testing.T) {
	for _, restore := range []bool{false, true} {
		repo, db := newRefundedBillingRecoveryRepository(t)
		const reserved = int64(514_800)
		order := model.BillingOrder{
			ID: "order", UserID: "user", IdempotencyKey: "task", Capability: "audio", BillingMode: "token",
			Quantity: 1_000, InputTokens: 1_000, AmountMicrocredits: reserved,
			ReservedAmountMicrocredits: reserved, InputTokenPriceMicrocredits: 514_800_000,
			MultiplierBasisPoints: 10000, Status: model.BillingStatusRunning,
		}
		account := model.CreditAccount{UserID: "user", AvailableMicrocredits: 10_000_000, ReservedMicrocredits: reserved}
		settle := repo.SettleBillingOrder
		if restore {
			settle = repo.RestoreRefundedBillingOrder
			order.Status = model.BillingStatusRefunded
			order.RefundedAmountMicrocredits = reserved
			account.ReservedMicrocredits = 0
			account.AvailableMicrocredits += reserved
		}
		if err := db.Create(&account).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&order).Error; err != nil {
			t.Fatal(err)
		}
		log := model.ApiCallLog{ID: "log", BillingOrderID: "order", Status: model.ApiCallStatusSucceeded, UsageAvailable: true, InputTokens: 400}
		if err := db.Create(&log).Error; err != nil {
			t.Fatal(err)
		}
		if err := settle("order", "provider-id"); err != nil {
			t.Fatal(err)
		}
		if err := db.First(&order, "id = ?", "order").Error; err != nil {
			t.Fatal(err)
		}
		if order.InputTokens != 400 || order.UsageSource != "provider" || !order.UsageAvailable || order.ActualAmountMicrocredits != 205_920 {
			t.Fatalf("provider usage was not preferred: %+v", order)
		}
	}
}

func TestAudioTokenSettlementWithoutEstimateStaysUnavailable(t *testing.T) {
	repo, db := newRefundedBillingRecoveryRepository(t)
	order := model.BillingOrder{ID: "order", UserID: "user", IdempotencyKey: "task", Capability: "audio", BillingMode: "token", InputTokenPriceMicrocredits: 514_800_000, MultiplierBasisPoints: 10000, Status: model.BillingStatusRunning}
	if err := db.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	if err := repo.SettleBillingOrder("order", ""); !errors.Is(err, ErrBillingUsageUnavailable) {
		t.Fatalf("expected unavailable usage, got %v", err)
	}
	if err := db.First(&order, "id = ?", "order").Error; err != nil {
		t.Fatal(err)
	}
	if order.Status == model.BillingStatusSettled || order.UsageSource != "" || order.ActualAmountMicrocredits != 0 {
		t.Fatalf("missing estimate changed settlement: %+v", order)
	}
}
