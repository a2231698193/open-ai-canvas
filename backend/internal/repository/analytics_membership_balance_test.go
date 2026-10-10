package repository

import (
	"testing"

	"yingce/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestTotalCreditBalanceSumsBothPools(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:total-balance-"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CreditAccount{}); err != nil {
		t.Fatal(err)
	}
	rows := []model.CreditAccount{
		{UserID: "a", AvailableMicrocredits: 100, MembershipMicrocredits: 30},
		{UserID: "b", AvailableMicrocredits: 200, MembershipMicrocredits: 0},
	}
	for _, row := range rows {
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}

	total, err := New(db).TotalCreditBalance()
	if err != nil {
		t.Fatal(err)
	}
	if total != 330 {
		t.Fatalf("total balance = %d, want 330 (两池之和)", total)
	}
}
