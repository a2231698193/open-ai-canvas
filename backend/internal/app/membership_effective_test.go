package app

import (
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newMembershipServiceDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:membership-effective-"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.MembershipPlan{}, &model.UserMembership{}, &model.CreditAccount{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_memberships_active_user ON user_memberships(user_id) WHERE status = 'active'").Error; err != nil {
		t.Fatal(err)
	}
	return db
}

func TestEffectiveMembershipFallsBackToFreeWithoutRow(t *testing.T) {
	db := newMembershipServiceDB(t)
	svc := &Service{repo: repository.New(db)}

	effective, err := svc.effectiveMembership("user-none")
	if err != nil {
		t.Fatal(err)
	}
	if effective.Active {
		t.Fatalf("free fallback should be inactive, got %+v", effective)
	}
	if effective.MonthlyGrantMicrocredits != 0 || effective.ActiveTaskLimit != 0 || effective.StorageGB != 0 || effective.DailyUploadMB != 0 {
		t.Fatalf("free fallback limits must be 0 (全局默认值)，got %+v", effective)
	}
	if effective.CheckinBonusOverrideMicrocredits != 0 {
		t.Fatalf("free fallback must use global checkin bonus, got %+v", effective)
	}
}

func TestEffectiveMembershipResolvesActivePlan(t *testing.T) {
	db := newMembershipServiceDB(t)
	svc := &Service{repo: repository.New(db)}
	plan := model.MembershipPlan{ID: "plan-pro", Name: "专业版", Level: 3, Enabled: true, MonthlyGrantMicrocredits: 30 * CreditScale, ActiveTaskLimit: 10, StorageGB: 100, DailyUploadMB: 4096, CheckinBonusOverrideMicrocredits: 20 * CreditScale}
	if err := db.Create(&plan).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	if err := db.Create(&model.UserMembership{ID: "m-1", UserID: "user-1", PlanID: plan.ID, Status: model.MembershipStatusActive, PeriodStart: now.AddDate(0, 0, -5), PeriodEnd: now.AddDate(0, 0, 25)}).Error; err != nil {
		t.Fatal(err)
	}

	effective, err := svc.effectiveMembership("user-1")
	if err != nil {
		t.Fatal(err)
	}
	if !effective.Active || effective.PlanID != plan.ID || effective.PlanName != plan.Name || effective.Level != plan.Level {
		t.Fatalf("effective membership = %+v", effective)
	}
	if effective.MonthlyGrantMicrocredits != plan.MonthlyGrantMicrocredits || effective.ActiveTaskLimit != 10 || effective.StorageGB != 100 || effective.DailyUploadMB != 4096 {
		t.Fatalf("plan limits not propagated: %+v", effective)
	}
	if effective.CheckinBonusOverrideMicrocredits != 20*CreditScale {
		t.Fatalf("checkin override = %+v", effective)
	}
	if !effective.PeriodEnd.After(time.Now()) {
		t.Fatalf("period end should be in the future: %+v", effective)
	}
}

func TestEffectiveMembershipTreatsExpiredPeriodAsFree(t *testing.T) {
	db := newMembershipServiceDB(t)
	svc := &Service{repo: repository.New(db)}
	plan := model.MembershipPlan{ID: "plan-pro", Name: "专业版", Level: 3, Enabled: true, MonthlyGrantMicrocredits: 30 * CreditScale}
	if err := db.Create(&plan).Error; err != nil {
		t.Fatal(err)
	}
	// status 仍是 active 但周期已结束：按 Free 兜底。
	if err := db.Create(&model.UserMembership{ID: "m-1", UserID: "user-1", PlanID: plan.ID, Status: model.MembershipStatusActive, PeriodStart: time.Now().AddDate(0, 0, -40), PeriodEnd: time.Now().AddDate(0, 0, -10)}).Error; err != nil {
		t.Fatal(err)
	}

	effective, err := svc.effectiveMembership("user-1")
	if err != nil {
		t.Fatal(err)
	}
	if effective.Active {
		t.Fatalf("expired period should fall back to free, got %+v", effective)
	}
	if effective.MonthlyGrantMicrocredits != 0 {
		t.Fatalf("expired membership must not grant plan credits: %+v", effective)
	}
}

func TestEffectiveMembershipTreatsCancelledAsFree(t *testing.T) {
	db := newMembershipServiceDB(t)
	svc := &Service{repo: repository.New(db)}
	if err := db.Create(&model.UserMembership{ID: "m-1", UserID: "user-1", PlanID: "plan-pro", Status: model.MembershipStatusCancelled}).Error; err != nil {
		t.Fatal(err)
	}

	effective, err := svc.effectiveMembership("user-1")
	if err != nil {
		t.Fatal(err)
	}
	if effective.Active {
		t.Fatalf("cancelled membership should fall back to free, got %+v", effective)
	}
}
