package repository

import (
	"errors"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

func openMembershipPaymentTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := openPaymentTestDB(t)
	if err := db.AutoMigrate(&model.MembershipPlan{}, &model.UserMembership{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_memberships_active_user ON user_memberships(user_id) WHERE status = 'active'").Error; err != nil {
		t.Fatal(err)
	}
	return db
}

func seedPaymentMembershipPlan(t *testing.T, db *gorm.DB, id, name string, level int, monthlyGrant int64) model.MembershipPlan {
	t.Helper()
	plan := model.MembershipPlan{ID: id, Name: name, Level: level, Enabled: true, MonthlyGrantMicrocredits: monthlyGrant}
	if err := db.Create(&plan).Error; err != nil {
		t.Fatal(err)
	}
	return plan
}

func insertMembershipPaymentOrder(t *testing.T, db *gorm.DB, order model.PaymentOrder) model.PaymentOrder {
	t.Helper()
	order.Kind = model.PaymentOrderKindMembership
	order.Status = model.PaymentOrderPending
	if order.Currency == "" {
		order.Currency = "CNY"
	}
	if order.ProviderID == "" {
		order.ProviderID = "wechat-native"
	}
	if order.PluginID == "" {
		order.PluginID = "plugin"
	}
	if order.ProviderConfigID == "" {
		order.ProviderConfigID = "config"
	}
	if order.ProviderConfigVersion == 0 {
		order.ProviderConfigVersion = 1
	}
	if order.ExpiresAt.IsZero() {
		order.ExpiresAt = time.Now().Add(time.Hour)
	}
	if err := db.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	return order
}

func membershipPaymentEvidence(order model.PaymentOrder, tradeNo string) PaymentEvidence {
	return PaymentEvidence{ProviderTradeNo: tradeNo, ProviderStatus: "SUCCESS", AmountFen: order.AmountFen, Currency: order.Currency, PaidAt: time.Now()}
}

func TestCompletePaymentOrderMembershipNewActivatesAndGrantsFirstWindow(t *testing.T) {
	db := openMembershipPaymentTestDB(t)
	repo := New(db)
	plan := seedPaymentMembershipPlan(t, db, "plan-1", "1级会员", 1, 950_000_000)
	order := insertMembershipPaymentOrder(t, db, model.PaymentOrder{
		ID: "po-new", UserID: "user-1", IdempotencyKey: "idem-new", MerchantOrderNo: "merchant-new",
		ProductName: "1级会员会员 · 1 个月", MembershipPlanID: plan.ID, MembershipPlanName: plan.Name,
		MembershipLevel: plan.Level, MembershipMonths: 1, MembershipChange: model.MembershipChangeNew,
		MembershipMonthlyGrantMicrocredits: plan.MonthlyGrantMicrocredits,
		AmountFen:                          8800,
	})

	completed, granted, err := repo.CompletePaymentOrder(order.ProviderID, order.MerchantOrderNo, membershipPaymentEvidence(order, "trade-new"))
	if err != nil {
		t.Fatal(err)
	}
	if !granted || completed.Status != model.PaymentOrderCredited {
		t.Fatalf("completion = %+v, granted=%v", completed, granted)
	}
	var membership model.UserMembership
	if err := db.First(&membership, "user_id = ? AND status = ?", "user-1", model.MembershipStatusActive).Error; err != nil {
		t.Fatal(err)
	}
	if membership.PlanID != plan.ID || membership.GrantedMonths != 1 {
		t.Fatalf("membership = %+v", membership)
	}
	if !membership.PeriodEnd.After(time.Now().Add(27 * 24 * time.Hour)) {
		t.Fatalf("period end = %v, want about one month", membership.PeriodEnd)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "user-1").Error; err != nil {
		t.Fatal(err)
	}
	if account.MembershipMicrocredits != plan.MonthlyGrantMicrocredits {
		t.Fatalf("membership credits = %d", account.MembershipMicrocredits)
	}
	var grant model.CreditLedgerEntry
	if err := db.First(&grant, "user_id = ? AND type = ?", "user-1", model.CreditLedgerMembershipGrant).Error; err != nil {
		t.Fatal(err)
	}
	if grant.ReferenceKey == nil || *grant.ReferenceKey != "membership-grant:"+membership.ID+":1" {
		t.Fatalf("grant reference = %v", grant.ReferenceKey)
	}
	var topupLedgers int64
	if err := db.Model(&model.CreditLedgerEntry{}).Where("payment_order_id = ? AND type = ?", order.ID, model.CreditLedgerPaymentTopup).Count(&topupLedgers).Error; err != nil {
		t.Fatal(err)
	}
	if topupLedgers != 0 {
		t.Fatalf("membership order must not write payment_topup ledger, got %d", topupLedgers)
	}

	repeated, repeatedGranted, err := repo.CompletePaymentOrder(order.ProviderID, order.MerchantOrderNo, membershipPaymentEvidence(order, "trade-new"))
	if err != nil {
		t.Fatal(err)
	}
	if repeatedGranted || repeated.Status != model.PaymentOrderCredited {
		t.Fatalf("duplicate completion = %+v, granted=%v", repeated, repeatedGranted)
	}
	var grantCount int64
	if err := db.Model(&model.CreditLedgerEntry{}).Where("user_id = ? AND type = ?", "user-1", model.CreditLedgerMembershipGrant).Count(&grantCount).Error; err != nil {
		t.Fatal(err)
	}
	if grantCount != 1 {
		t.Fatalf("duplicate completion wrote extra membership grants: %d", grantCount)
	}
}

func TestCompletePaymentOrderMembershipUsesOrderGrantSnapshot(t *testing.T) {
	db := openMembershipPaymentTestDB(t)
	repo := New(db)
	plan := seedPaymentMembershipPlan(t, db, "plan-1", "1级会员", 1, 950_000_000)
	order := insertMembershipPaymentOrder(t, db, model.PaymentOrder{
		ID: "po-snapshot", UserID: "user-1", IdempotencyKey: "idem-snapshot", MerchantOrderNo: "merchant-snapshot",
		ProductName: "1级会员会员 · 1 个月", MembershipPlanID: plan.ID, MembershipPlanName: plan.Name,
		MembershipLevel: plan.Level, MembershipMonths: 1, MembershipChange: model.MembershipChangeNew,
		MembershipMonthlyGrantMicrocredits: 300_000_000, AmountFen: 8800,
	})
	// 下单后管理员改高等级额度，履约必须使用订单快照而不是最新配置。
	if err := db.Model(&model.MembershipPlan{}).Where("id = ?", plan.ID).Update("monthly_grant_microcredits", int64(100_000_000)).Error; err != nil {
		t.Fatal(err)
	}

	if _, _, err := repo.CompletePaymentOrder(order.ProviderID, order.MerchantOrderNo, membershipPaymentEvidence(order, "trade-snapshot")); err != nil {
		t.Fatal(err)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "user-1").Error; err != nil {
		t.Fatal(err)
	}
	if account.MembershipMicrocredits != 300_000_000 {
		t.Fatalf("membership credits = %d, want order snapshot 300000000", account.MembershipMicrocredits)
	}
}

func TestCompletePaymentOrderMembershipRenewExtendsPeriod(t *testing.T) {
	db := openMembershipPaymentTestDB(t)
	repo := New(db)
	plan := seedPaymentMembershipPlan(t, db, "plan-1", "1级会员", 1, 950_000_000)
	oldEnd := time.Now().Add(20 * 24 * time.Hour)
	membership := model.UserMembership{
		ID: "membership-1", UserID: "user-1", PlanID: plan.ID, Status: model.MembershipStatusActive,
		PeriodStart: time.Now().Add(-10 * 24 * time.Hour), PeriodEnd: oldEnd, GrantedMonths: 1,
	}
	if err := db.Create(&membership).Error; err != nil {
		t.Fatal(err)
	}
	order := insertMembershipPaymentOrder(t, db, model.PaymentOrder{
		ID: "po-renew", UserID: "user-1", IdempotencyKey: "idem-renew", MerchantOrderNo: "merchant-renew",
		ProductName: "1级会员会员续费 · 1 个月", MembershipPlanID: plan.ID, MembershipPlanName: plan.Name,
		MembershipLevel: plan.Level, MembershipMonths: 1, MembershipChange: model.MembershipChangeRenew,
		MembershipMonthlyGrantMicrocredits: plan.MonthlyGrantMicrocredits,
		AmountFen:                          8800,
	})

	if _, _, err := repo.CompletePaymentOrder(order.ProviderID, order.MerchantOrderNo, membershipPaymentEvidence(order, "trade-renew")); err != nil {
		t.Fatal(err)
	}
	var renewed model.UserMembership
	if err := db.First(&renewed, "id = ?", membership.ID).Error; err != nil {
		t.Fatal(err)
	}
	if renewed.GrantedMonths != 1 {
		t.Fatalf("renewal must not grant a future window, granted=%d", renewed.GrantedMonths)
	}
	if renewed.PeriodEnd.Before(oldEnd.AddDate(0, 1, 0).Add(-time.Hour)) {
		t.Fatalf("period end = %v, want about %v", renewed.PeriodEnd, oldEnd.AddDate(0, 1, 0))
	}
	var grants int64
	if err := db.Model(&model.CreditLedgerEntry{}).Where("user_id = ? AND type = ?", "user-1", model.CreditLedgerMembershipGrant).Count(&grants).Error; err != nil {
		t.Fatal(err)
	}
	if grants != 0 {
		t.Fatalf("renewal without a due window wrote %d grants", grants)
	}
}

func TestCompletePaymentOrderMembershipUpgradeSwitchesPlanAndGrantsDiff(t *testing.T) {
	db := openMembershipPaymentTestDB(t)
	repo := New(db)
	oldPlan := seedPaymentMembershipPlan(t, db, "plan-1", "1级会员", 1, 950_000_000)
	newPlan := seedPaymentMembershipPlan(t, db, "plan-2", "2级会员", 2, 2_080_000_000)
	periodEnd := time.Now().Add(10 * 24 * time.Hour)
	membership := model.UserMembership{
		ID: "membership-1", UserID: "user-1", PlanID: oldPlan.ID, Status: model.MembershipStatusActive,
		PeriodStart: time.Now().Add(-20 * 24 * time.Hour), PeriodEnd: periodEnd, GrantedMonths: 1,
	}
	if err := db.Create(&membership).Error; err != nil {
		t.Fatal(err)
	}
	diff := newPlan.MonthlyGrantMicrocredits - oldPlan.MonthlyGrantMicrocredits
	order := insertMembershipPaymentOrder(t, db, model.PaymentOrder{
		ID: "po-upgrade", UserID: "user-1", IdempotencyKey: "idem-upgrade", MerchantOrderNo: "merchant-upgrade",
		ProductName: "2级会员会员升级", MembershipPlanID: newPlan.ID, MembershipPlanName: newPlan.Name,
		MembershipLevel: newPlan.Level, MembershipChange: model.MembershipChangeUpgrade,
		MembershipPreviousPlanID: oldPlan.ID, MembershipPreviousPlanName: oldPlan.Name,
		MembershipRemainingDays: 10, MembershipCreditDiffMicrocredits: diff,
		AmountFen: 3667,
	})

	if _, _, err := repo.CompletePaymentOrder(order.ProviderID, order.MerchantOrderNo, membershipPaymentEvidence(order, "trade-upgrade")); err != nil {
		t.Fatal(err)
	}
	var upgraded model.UserMembership
	if err := db.First(&upgraded, "id = ?", membership.ID).Error; err != nil {
		t.Fatal(err)
	}
	if upgraded.PlanID != newPlan.ID {
		t.Fatalf("upgraded plan = %s", upgraded.PlanID)
	}
	if !upgraded.PeriodEnd.Equal(periodEnd) {
		t.Fatalf("upgrade must not change period end: %v != %v", upgraded.PeriodEnd, periodEnd)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "user-1").Error; err != nil {
		t.Fatal(err)
	}
	if account.MembershipMicrocredits != diff {
		t.Fatalf("upgrade diff credits = %d, want %d", account.MembershipMicrocredits, diff)
	}
	var entry model.CreditLedgerEntry
	if err := db.First(&entry, "user_id = ? AND type = ?", "user-1", model.CreditLedgerMembershipUpgradeDiff).Error; err != nil {
		t.Fatal(err)
	}
	if entry.ReferenceKey == nil || *entry.ReferenceKey != "membership-upgrade:"+membership.ID+":"+order.ID {
		t.Fatalf("upgrade reference = %v", entry.ReferenceKey)
	}
}

func TestCompletePaymentOrderMembershipNewStartsNewCycleAfterExpiry(t *testing.T) {
	db := openMembershipPaymentTestDB(t)
	repo := New(db)
	plan := seedPaymentMembershipPlan(t, db, "plan-1", "1级会员", 1, 950_000_000)
	expired := model.UserMembership{
		ID: "membership-expired", UserID: "user-1", PlanID: plan.ID, Status: model.MembershipStatusActive,
		PeriodStart: time.Now().Add(-40 * 24 * time.Hour), PeriodEnd: time.Now().Add(-10 * 24 * time.Hour), GrantedMonths: 2,
	}
	if err := db.Create(&expired).Error; err != nil {
		t.Fatal(err)
	}
	order := insertMembershipPaymentOrder(t, db, model.PaymentOrder{
		ID: "po-expired", UserID: "user-1", IdempotencyKey: "idem-expired", MerchantOrderNo: "merchant-expired",
		ProductName: "1级会员会员 · 1 个月", MembershipPlanID: plan.ID, MembershipPlanName: plan.Name,
		MembershipLevel: plan.Level, MembershipMonths: 1, MembershipChange: model.MembershipChangeNew,
		MembershipMonthlyGrantMicrocredits: plan.MonthlyGrantMicrocredits,
		AmountFen:                          8800,
	})

	if _, _, err := repo.CompletePaymentOrder(order.ProviderID, order.MerchantOrderNo, membershipPaymentEvidence(order, "trade-expired")); err != nil {
		t.Fatal(err)
	}
	var membership model.UserMembership
	if err := db.First(&membership, "user_id = ? AND status = ?", "user-1", model.MembershipStatusActive).Error; err != nil {
		t.Fatal(err)
	}
	if membership.ID == expired.ID {
		t.Fatal("expired row must be closed and a new cycle created")
	}
	if membership.GrantedMonths != 1 || !membership.PeriodEnd.After(time.Now().Add(27*24*time.Hour)) {
		t.Fatalf("new membership = %+v", membership)
	}
	var closed model.UserMembership
	if err := db.First(&closed, "id = ?", expired.ID).Error; err != nil {
		t.Fatal(err)
	}
	if closed.Status != model.MembershipStatusCancelled {
		t.Fatalf("expired row status = %s", closed.Status)
	}
}

func TestCompletePaymentOrderMembershipNewReplacesDisabledPlan(t *testing.T) {
	db := openMembershipPaymentTestDB(t)
	repo := New(db)
	oldPlan := model.MembershipPlan{ID: "plan-old", Name: "旧等级", Level: 1, Enabled: false, MonthlyGrantMicrocredits: 100}
	if err := db.Create(&oldPlan).Error; err != nil {
		t.Fatal(err)
	}
	newPlan := seedPaymentMembershipPlan(t, db, "plan-new", "新等级", 2, 950_000_000)
	membership := model.UserMembership{
		ID: "membership-old", UserID: "user-1", PlanID: oldPlan.ID, Status: model.MembershipStatusActive,
		PeriodStart: time.Now().Add(-10 * 24 * time.Hour), PeriodEnd: time.Now().Add(20 * 24 * time.Hour), GrantedMonths: 1,
	}
	if err := db.Create(&membership).Error; err != nil {
		t.Fatal(err)
	}
	order := insertMembershipPaymentOrder(t, db, model.PaymentOrder{
		ID: "po-disabled-plan", UserID: "user-1", IdempotencyKey: "idem-disabled-plan", MerchantOrderNo: "merchant-disabled-plan",
		ProductName: "新等级会员 · 1 个月", MembershipPlanID: newPlan.ID, MembershipPlanName: newPlan.Name,
		MembershipLevel: newPlan.Level, MembershipMonths: 1, MembershipChange: model.MembershipChangeNew,
		MembershipMonthlyGrantMicrocredits: newPlan.MonthlyGrantMicrocredits,
		AmountFen:                          8800,
	})

	if _, _, err := repo.CompletePaymentOrder(order.ProviderID, order.MerchantOrderNo, membershipPaymentEvidence(order, "trade-disabled-plan")); err != nil {
		t.Fatal(err)
	}
	var active model.UserMembership
	if err := db.First(&active, "user_id = ? AND status = ?", "user-1", model.MembershipStatusActive).Error; err != nil {
		t.Fatal(err)
	}
	if active.PlanID != newPlan.ID || active.ID == membership.ID {
		t.Fatalf("active membership = %+v", active)
	}
	var closed model.UserMembership
	if err := db.First(&closed, "id = ?", membership.ID).Error; err != nil {
		t.Fatal(err)
	}
	if closed.Status != model.MembershipStatusCancelled {
		t.Fatalf("old membership status = %s", closed.Status)
	}
}

func TestCompletePaymentOrderMembershipNewClearsExpiredPool(t *testing.T) {
	db := openMembershipPaymentTestDB(t)
	repo := New(db)
	plan := seedPaymentMembershipPlan(t, db, "plan-1", "1级会员", 1, 950_000_000)
	if err := db.Create(&model.CreditAccount{
		UserID: "user-1", MembershipMicrocredits: 100, MembershipExpiresAt: time.Now().Add(-time.Hour),
	}).Error; err != nil {
		t.Fatal(err)
	}
	order := insertMembershipPaymentOrder(t, db, model.PaymentOrder{
		ID: "po-expired-pool", UserID: "user-1", IdempotencyKey: "idem-expired-pool", MerchantOrderNo: "merchant-expired-pool",
		ProductName: "1级会员会员 · 1 个月", MembershipPlanID: plan.ID, MembershipPlanName: plan.Name,
		MembershipLevel: plan.Level, MembershipMonths: 1, MembershipChange: model.MembershipChangeNew,
		MembershipMonthlyGrantMicrocredits: plan.MonthlyGrantMicrocredits,
		AmountFen:                          8800,
	})

	if _, _, err := repo.CompletePaymentOrder(order.ProviderID, order.MerchantOrderNo, membershipPaymentEvidence(order, "trade-expired-pool")); err != nil {
		t.Fatal(err)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "user-1").Error; err != nil {
		t.Fatal(err)
	}
	if account.MembershipMicrocredits != plan.MonthlyGrantMicrocredits {
		t.Fatalf("membership credits = %d, want %d (expired pool must be cleared)", account.MembershipMicrocredits, plan.MonthlyGrantMicrocredits)
	}
	var clear model.CreditLedgerEntry
	if err := db.First(&clear, "user_id = ? AND type = ?", "user-1", model.CreditLedgerMembershipExpireClear).Error; err != nil {
		t.Fatal(err)
	}
	if clear.AmountMicrocredits != -100 {
		t.Fatalf("expire clear amount = %d", clear.AmountMicrocredits)
	}
}

func TestCompletePaymentOrderMembershipRollsBackOnStateConflict(t *testing.T) {
	db := openMembershipPaymentTestDB(t)
	repo := New(db)
	oldPlan := seedPaymentMembershipPlan(t, db, "plan-1", "1级会员", 1, 950_000_000)
	newPlan := seedPaymentMembershipPlan(t, db, "plan-2", "2级会员", 2, 2_080_000_000)
	order := insertMembershipPaymentOrder(t, db, model.PaymentOrder{
		ID: "po-conflict", UserID: "user-1", IdempotencyKey: "idem-conflict", MerchantOrderNo: "merchant-conflict",
		ProductName: "2级会员会员升级", MembershipPlanID: newPlan.ID, MembershipPlanName: newPlan.Name,
		MembershipLevel: newPlan.Level, MembershipChange: model.MembershipChangeUpgrade,
		MembershipPreviousPlanID: oldPlan.ID, MembershipPreviousPlanName: oldPlan.Name,
		AmountFen: 3667,
	})

	if _, _, err := repo.CompletePaymentOrder(order.ProviderID, order.MerchantOrderNo, membershipPaymentEvidence(order, "trade-conflict")); !errors.Is(err, ErrPaymentOrderStateConflict) {
		t.Fatalf("error = %v, want %v", err, ErrPaymentOrderStateConflict)
	}
	var reloaded model.PaymentOrder
	if err := db.First(&reloaded, "id = ?", order.ID).Error; err != nil {
		t.Fatal(err)
	}
	if reloaded.Status == model.PaymentOrderCredited {
		t.Fatalf("conflicting fulfillment must roll back order credit, got %s", reloaded.Status)
	}
}
