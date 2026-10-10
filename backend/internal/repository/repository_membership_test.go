package repository

import (
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newMembershipTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:membership-repo-"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.MembershipPlan{}, &model.UserMembership{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_memberships_active_user ON user_memberships(user_id) WHERE status = 'active'").Error; err != nil {
		t.Fatal(err)
	}
	return db
}

func TestActiveUserMembershipReturnsNilWithoutRow(t *testing.T) {
	db := newMembershipTestDB(t)
	repo := New(db)

	membership, err := repo.ActiveUserMembership("user-1")
	if err != nil {
		t.Fatal(err)
	}
	if membership != nil {
		t.Fatalf("expected nil membership, got %+v", membership)
	}
}

func TestActiveUserMembershipReturnsActiveRow(t *testing.T) {
	db := newMembershipTestDB(t)
	repo := New(db)
	now := time.Now()
	row := model.UserMembership{ID: "m-1", UserID: "user-1", PlanID: "plan-pro", Status: model.MembershipStatusActive, PeriodStart: now.AddDate(0, 0, -10), PeriodEnd: now.AddDate(0, 0, 20)}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.UserMembership{ID: "m-2", UserID: "user-2", PlanID: "plan-pro", Status: model.MembershipStatusActive}).Error; err != nil {
		t.Fatal(err)
	}

	membership, err := repo.ActiveUserMembership("user-1")
	if err != nil {
		t.Fatal(err)
	}
	if membership == nil || membership.ID != "m-1" {
		t.Fatalf("expected m-1, got %+v", membership)
	}
}

func TestUserMembershipPartialUniqueIndexRejectsSecondActiveRow(t *testing.T) {
	db := newMembershipTestDB(t)
	first := model.UserMembership{ID: "m-1", UserID: "user-1", PlanID: "plan-pro", Status: model.MembershipStatusActive}
	if err := db.Create(&first).Error; err != nil {
		t.Fatal(err)
	}
	second := model.UserMembership{ID: "m-2", UserID: "user-1", PlanID: "plan-basic", Status: model.MembershipStatusActive}
	if err := db.Create(&second).Error; err == nil {
		t.Fatal("second active membership for same user should violate the partial unique index")
	}
	// 作废后允许重新开通一条 active。
	if err := db.Model(&model.UserMembership{}).Where("id = ?", "m-1").Update("status", model.MembershipStatusCancelled).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&second).Error; err != nil {
		t.Fatalf("active membership after cancel should be allowed: %v", err)
	}
}
