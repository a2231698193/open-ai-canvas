package repository

import (
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func newMembershipBillingDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:membership-billing-"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.BillingOrder{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func seedMembershipAccount(t *testing.T, db *gorm.DB, userID string, general int64, membership int64, expiresAt time.Time) {
	t.Helper()
	account := model.CreditAccount{UserID: userID, AvailableMicrocredits: general, MembershipMicrocredits: membership, MembershipExpiresAt: expiresAt}
	if err := db.Clauses(clause.OnConflict{DoNothing: true}).Create(&account).Error; err != nil {
		t.Fatal(err)
	}
}

func reserveMembershipOrder(t *testing.T, db *gorm.DB, userID string, amount int64) (*model.BillingOrder, error) {
	t.Helper()
	repo := New(db)
	order := &model.BillingOrder{ID: newRepositoryID(), UserID: userID, IdempotencyKey: "key:" + newRepositoryID(), Model: "m", Capability: "image", BillingMode: "fixed_request", Quantity: 1, AmountMicrocredits: amount, ReservedAmountMicrocredits: amount, Status: model.BillingStatusReserved}
	err := repo.ReserveBillingOrder(order)
	return order, err
}

func accountOf(t *testing.T, db *gorm.DB, userID string) model.CreditAccount {
	t.Helper()
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", userID).Error; err != nil {
		t.Fatal(err)
	}
	return account
}

func TestReserveBillingOrderSplitsMembershipPoolFirst(t *testing.T) {
	db := newMembershipBillingDB(t)
	seedMembershipAccount(t, db, "user-1", 100, 30, time.Now().Add(24*time.Hour))

	order, err := reserveMembershipOrder(t, db, "user-1", 50)
	if err != nil {
		t.Fatal(err)
	}
	if order.MembershipAmountMicrocredits != 30 {
		t.Fatalf("membership part = %d, want 30", order.MembershipAmountMicrocredits)
	}
	account := accountOf(t, db, "user-1")
	if account.MembershipMicrocredits != 0 || account.AvailableMicrocredits != 80 || account.ReservedMicrocredits != 50 {
		t.Fatalf("account after reserve = %+v", account)
	}
	var entry model.CreditLedgerEntry
	if err := db.First(&entry, "user_id = ? AND type = ?", "user-1", model.CreditLedgerReserve).Error; err != nil {
		t.Fatal(err)
	}
	if entry.MembershipDeltaMicrocredits != -30 || entry.AvailableDeltaMicrocredits != -20 || entry.ReservedDeltaMicrocredits != 50 {
		t.Fatalf("reserve ledger deltas = %+v", entry)
	}
}

func TestReserveBillingOrderExpiredMembershipIsClearedAndSkipped(t *testing.T) {
	db := newMembershipBillingDB(t)
	seedMembershipAccount(t, db, "user-1", 100, 30, time.Now().Add(-time.Hour))

	order, err := reserveMembershipOrder(t, db, "user-1", 50)
	if err != nil {
		t.Fatal(err)
	}
	if order.MembershipAmountMicrocredits != 0 {
		t.Fatalf("expired membership must not be reserved, got %d", order.MembershipAmountMicrocredits)
	}
	account := accountOf(t, db, "user-1")
	if account.MembershipMicrocredits != 0 || account.AvailableMicrocredits != 50 || account.ReservedMicrocredits != 50 {
		t.Fatalf("account after lazy clear = %+v", account)
	}
	var clear model.CreditLedgerEntry
	if err := db.First(&clear, "user_id = ? AND type = ?", "user-1", model.CreditLedgerMembershipExpireClear).Error; err != nil {
		t.Fatal("expired membership pool must be cleared into ledger:", err)
	}
	if clear.AmountMicrocredits != -30 {
		t.Fatalf("clear ledger amount = %d", clear.AmountMicrocredits)
	}
}

func TestReserveBillingOrderInsufficientGeneralPool(t *testing.T) {
	db := newMembershipBillingDB(t)
	seedMembershipAccount(t, db, "user-1", 10, 0, time.Time{})

	if _, err := reserveMembershipOrder(t, db, "user-1", 50); err != ErrInsufficientCredits {
		t.Fatalf("expected ErrInsufficientCredits, got %v", err)
	}
}

func TestSplitBillingSettlement(t *testing.T) {
	// 预留 50（会员 30 / 通用 20），实际消耗 20，多退 30：
	// 消耗先计会员 20，剩余会员份额 10 全额退会员池，其余 20 退通用池。
	split := splitBillingSettlement(30, 20, 30)
	if split.ConsumedFromMembership != 20 || split.RefundToMembership != 10 || split.RefundToGeneral != 20 {
		t.Fatalf("split = %+v", split)
	}
	// 实际消耗超过会员预留：消耗只到会员部分，退款全进通用池。
	split = splitBillingSettlement(30, 50, 0)
	if split.ConsumedFromMembership != 30 || split.RefundToMembership != 0 || split.RefundToGeneral != 0 {
		t.Fatalf("split = %+v", split)
	}
	// 会员预留未动、全部退款：会员部分整额回会员池。
	split = splitBillingSettlement(30, 0, 50)
	if split.ConsumedFromMembership != 0 || split.RefundToMembership != 30 || split.RefundToGeneral != 20 {
		t.Fatalf("split = %+v", split)
	}
}

func TestSettleBillingOrderConsumesMembershipPartFirst(t *testing.T) {
	db := newMembershipBillingDB(t)
	seedMembershipAccount(t, db, "user-1", 100, 30, time.Now().Add(24*time.Hour))
	order, err := reserveMembershipOrder(t, db, "user-1", 50)
	if err != nil {
		t.Fatal(err)
	}

	repo := New(db)
	if err := repo.SettleBillingOrder(order.ID, ""); err != nil {
		t.Fatal(err)
	}
	// 固定价足额结算：消耗 50（会员预留 30 + 通用预留 20），无退补。
	account := accountOf(t, db, "user-1")
	if account.MembershipMicrocredits != 0 || account.AvailableMicrocredits != 80 || account.ReservedMicrocredits != 0 {
		t.Fatalf("account after settle = %+v", account)
	}
	var settled model.BillingOrder
	if err := db.First(&settled, "id = ?", order.ID).Error; err != nil {
		t.Fatal(err)
	}
	if settled.ActualAmountMicrocredits != 50 || settled.RefundedAmountMicrocredits != 0 {
		t.Fatalf("settlement amounts = %d/%d", settled.ActualAmountMicrocredits, settled.RefundedAmountMicrocredits)
	}
	var entry model.CreditLedgerEntry
	if err := db.First(&entry, "user_id = ? AND type = ?", "user-1", model.CreditLedgerConsume).Error; err != nil {
		t.Fatal(err)
	}
	if entry.MembershipDeltaMicrocredits != -30 || entry.ReservedDeltaMicrocredits != -50 {
		t.Fatalf("consume ledger deltas = %+v", entry)
	}
}

func TestRefundBillingOrderRestoresBothPools(t *testing.T) {
	db := newMembershipBillingDB(t)
	seedMembershipAccount(t, db, "user-1", 100, 30, time.Now().Add(24*time.Hour))
	order, err := reserveMembershipOrder(t, db, "user-1", 50)
	if err != nil {
		t.Fatal(err)
	}

	repo := New(db)
	if err := repo.RefundBillingOrder(order.ID, "上游失败"); err != nil {
		t.Fatal(err)
	}
	account := accountOf(t, db, "user-1")
	if account.MembershipMicrocredits != 30 || account.AvailableMicrocredits != 100 || account.ReservedMicrocredits != 0 {
		t.Fatalf("account after refund = %+v", account)
	}
	var entry model.CreditLedgerEntry
	if err := db.First(&entry, "user_id = ? AND type = ?", "user-1", model.CreditLedgerRefund).Error; err != nil {
		t.Fatal(err)
	}
	if entry.MembershipDeltaMicrocredits != 30 || entry.AvailableDeltaMicrocredits != 20 {
		t.Fatalf("refund ledger deltas = %+v", entry)
	}
}

func TestRefundBillingOrderExpiredMembershipPartGoesToGeneral(t *testing.T) {
	db := newMembershipBillingDB(t)
	seedMembershipAccount(t, db, "user-1", 100, 30, time.Now().Add(24*time.Hour))
	order, err := reserveMembershipOrder(t, db, "user-1", 50)
	if err != nil {
		t.Fatal(err)
	}
	// 预留后会员过期（未被清零任务处理）：退款时会员部分并入通用池。
	if err := db.Model(&model.CreditAccount{}).Where("user_id = ?", "user-1").Update("membership_expires_at", time.Now().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}

	repo := New(db)
	if err := repo.RefundBillingOrder(order.ID, "上游失败"); err != nil {
		t.Fatal(err)
	}
	account := accountOf(t, db, "user-1")
	if account.MembershipMicrocredits != 0 || account.AvailableMicrocredits != 130 || account.ReservedMicrocredits != 0 {
		t.Fatalf("account after expired refund = %+v", account)
	}
}
