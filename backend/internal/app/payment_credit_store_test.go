package app

import (
	"context"
	"testing"

	"yingce/backend/internal/model"
)

func TestQuoteCreditStoreAppliesTierDiscounts(t *testing.T) {
	policy := creditStorePolicyFor(defaultCreditStoreSetting())
	cases := []struct {
		credits  int64
		original int64
		discount int64
		amount   int64
	}{
		{100, 1_000, 0, 1_000},
		{500, 5_000, 0, 5_000},
		{1_000, 10_000, 1_000, 9_000},
		{4_900, 49_000, 1_000, 44_100},
		{5_000, 50_000, 2_000, 40_000},
		{10_000, 100_000, 2_000, 80_000},
	}
	for _, test := range cases {
		quote, err := quoteCreditStore(policy, test.credits)
		if err != nil {
			t.Fatalf("quoteCreditStore(%d): %v", test.credits, err)
		}
		if quote.OriginalAmountFen != test.original || quote.DiscountBasisPoints != test.discount || quote.AmountFen != test.amount {
			t.Fatalf("quoteCreditStore(%d) = %#v, want original=%d discount=%d amount=%d", test.credits, quote, test.original, test.discount, test.amount)
		}
	}
}

func TestQuoteCreditStoreUsesConfiguredUnitPrice(t *testing.T) {
	policy := creditStorePolicyFor(CreditStoreSetting{UnitPriceFen: 12})
	quote, err := quoteCreditStore(policy, 1_000)
	if err != nil {
		t.Fatal(err)
	}
	if quote.UnitPriceFen != 12 || quote.OriginalAmountFen != 12_000 || quote.AmountFen != 10_800 {
		t.Fatalf("quote = %#v, want unit=12 original=12000 amount=10800", quote)
	}
}

func TestQuoteCreditStoreRejectsInvalidCredits(t *testing.T) {
	policy := creditStorePolicyFor(defaultCreditStoreSetting())
	for _, credits := range []int64{0, 50, 150, 10_100} {
		if _, err := quoteCreditStore(policy, credits); err == nil {
			t.Fatalf("quoteCreditStore(%d) accepted invalid amount", credits)
		}
	}
}

func TestCreatePaymentOrderWithCustomCredits(t *testing.T) {
	svc, db := newMembershipPurchaseFixture(t)
	user := &model.User{ID: "credit-order-user", Username: "credit-order-user", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := db.Create(user).Error; err != nil {
		t.Fatal(err)
	}
	request := CreatePaymentOrderRequest{Credits: 1_000, ProviderID: PaymentProviderWeChat, IdempotencyKey: "credit-order-key"}
	order, err := svc.CreatePaymentOrder(context.Background(), user, request)
	if err != nil {
		t.Fatal(err)
	}
	if order.AmountFen != 9_000 || order.CreditsMicrocredits != 1_000*CreditScale || order.ProductName != "积分超市 · 1000 积分" || order.ProductKind != model.TopupProductKindCredits {
		t.Fatalf("order = %+v", order)
	}
	if order.Checkout.Mode != "qr_code" || order.Checkout.Value == "" {
		t.Fatalf("checkout = %+v", order.Checkout)
	}
	replay, err := svc.CreatePaymentOrder(context.Background(), user, request)
	if err != nil {
		t.Fatal(err)
	}
	if replay.ID != order.ID {
		t.Fatalf("idempotent replay created %s, want %s", replay.ID, order.ID)
	}
	if _, err := svc.CreatePaymentOrder(context.Background(), user, CreatePaymentOrderRequest{Credits: 500, ProviderID: PaymentProviderWeChat, IdempotencyKey: "credit-order-key"}); err == nil {
		t.Fatal("reused idempotency key with a different credit amount")
	}
	if _, err := svc.CreatePaymentOrder(context.Background(), user, CreatePaymentOrderRequest{Credits: 150, ProviderID: PaymentProviderWeChat, IdempotencyKey: "credit-order-invalid"}); err == nil {
		t.Fatal("accepted credits outside the 100 step")
	}
}

func TestCreditStoreSettingRoundTrip(t *testing.T) {
	svc, _, _, admin := newAppearanceTestService(t)
	policy, err := svc.CreditStorePolicy()
	if err != nil {
		t.Fatal(err)
	}
	if policy.UnitPriceFen != creditStoreUnitPriceFen {
		t.Fatalf("default unit price = %d, want %d", policy.UnitPriceFen, creditStoreUnitPriceFen)
	}
	if _, err := svc.UpdateCreditStoreSetting(admin, CreditStoreSetting{UnitPriceFen: 0}); err == nil {
		t.Fatal("accepted zero unit price")
	}
	saved, err := svc.UpdateCreditStoreSetting(admin, CreditStoreSetting{UnitPriceFen: 25})
	if err != nil {
		t.Fatal(err)
	}
	if saved.UnitPriceFen != 25 {
		t.Fatalf("saved unit price = %d", saved.UnitPriceFen)
	}
	policy, err = svc.CreditStorePolicy()
	if err != nil {
		t.Fatal(err)
	}
	if policy.UnitPriceFen != 25 {
		t.Fatalf("policy unit price = %d, want 25", policy.UnitPriceFen)
	}
	user := &model.User{ID: "credit-store-user", Username: "credit-store-user", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if _, err := svc.UpdateCreditStoreSetting(user, CreditStoreSetting{UnitPriceFen: 30}); err == nil {
		t.Fatal("non-admin updated credit store setting")
	}
}
