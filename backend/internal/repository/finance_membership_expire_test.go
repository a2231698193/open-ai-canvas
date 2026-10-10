package repository

import (
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newMembershipExpireDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:membership-expire-"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CreditAccount{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestExpireMembershipPoolsClearsOnlyExpiredBalances(t *testing.T) {
	db := newMembershipExpireDB(t)
	past := time.Now().Add(-time.Hour)
	future := time.Now().Add(24 * time.Hour)
	rows := []model.CreditAccount{
		{UserID: "expired", MembershipMicrocredits: 30, MembershipExpiresAt: past},
		{UserID: "active", MembershipMicrocredits: 50, MembershipExpiresAt: future},
		{UserID: "expired-empty", MembershipMicrocredits: 0, MembershipExpiresAt: past},
		{UserID: "no-expiry", MembershipMicrocredits: 10, MembershipExpiresAt: time.Time{}},
	}
	for _, row := range rows {
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}

	cleared, err := New(db).ExpireMembershipPools(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if cleared != 1 {
		t.Fatalf("cleared accounts = %d, want 1", cleared)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "expired").Error; err != nil {
		t.Fatal(err)
	}
	if account.MembershipMicrocredits != 0 {
		t.Fatalf("expired balance = %d", account.MembershipMicrocredits)
	}
	var entry model.CreditLedgerEntry
	if err := db.First(&entry, "user_id = ? AND type = ?", "expired", model.CreditLedgerMembershipExpireClear).Error; err != nil {
		t.Fatal("expired clear must be recorded in ledger:", err)
	}
	if entry.AmountMicrocredits != -30 || entry.MembershipDeltaMicrocredits != -30 {
		t.Fatalf("clear ledger = %+v", entry)
	}
	// 未过期、零余额、无到期时间的账户不动。
	var active model.CreditAccount
	if err := db.First(&active, "user_id = ?", "active").Error; err != nil {
		t.Fatal(err)
	}
	if active.MembershipMicrocredits != 50 {
		t.Fatalf("active balance = %d", active.MembershipMicrocredits)
	}

	// 幂等：再次执行无新增清零。
	cleared, err = New(db).ExpireMembershipPools(time.Now())
	if err != nil || cleared != 0 {
		t.Fatalf("second clear = %d, err = %v", cleared, err)
	}
}
