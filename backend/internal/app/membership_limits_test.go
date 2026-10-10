package app

import (
	"testing"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newMembershipLimitsDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:membership-limits-"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.MembershipPlan{}, &model.UserMembership{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.User{}, &model.SystemSetting{}, &model.Resource{}, &model.UserDailyUploadUsage{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_memberships_active_user ON user_memberships(user_id) WHERE status = 'active'").Error; err != nil {
		t.Fatal(err)
	}
	return db
}

func createMembershipFixture(t *testing.T, db *gorm.DB, userID string, plan model.MembershipPlan) {
	t.Helper()
	if err := db.Create(&plan).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.UserMembership{ID: "m-" + userID, UserID: userID, PlanID: plan.ID, Status: model.MembershipStatusActive, PeriodStart: time.Now().AddDate(0, 0, -1), PeriodEnd: time.Now().AddDate(0, 0, 29)}).Error; err != nil {
		t.Fatal(err)
	}
}

func TestApplyMembershipActiveTaskLimitOverrides(t *testing.T) {
	base := 5
	if got, err := applyMembershipActiveTaskLimit(repository.New(newMembershipLimitsDB(t)), "user-free", base); err != nil || got != int64(base) {
		t.Fatalf("free user limit = %d, err = %v", got, err)
	}

	db := newMembershipLimitsDB(t)
	createMembershipFixture(t, db, "user-cap", model.MembershipPlan{ID: "plan-cap", Name: "上限", Level: 1, Enabled: true, ActiveTaskLimit: 3})
	if got, err := applyMembershipActiveTaskLimit(repository.New(db), "user-cap", base); err != nil || got != 3 {
		t.Fatalf("plan cap limit = %d, err = %v", got, err)
	}

	db = newMembershipLimitsDB(t)
	createMembershipFixture(t, db, "user-unlimited", model.MembershipPlan{ID: "plan-max", Name: "无限", Level: 2, Enabled: true, ActiveTaskLimit: -1})
	got, err := applyMembershipActiveTaskLimit(repository.New(db), "user-unlimited", base)
	if err != nil || got != unlimitedActiveTasks {
		t.Fatalf("unlimited plan limit = %d, err = %v", got, err)
	}

	db = newMembershipLimitsDB(t)
	createMembershipFixture(t, db, "user-default", model.MembershipPlan{ID: "plan-default", Name: "默认", Level: 3, Enabled: true, ActiveTaskLimit: 0})
	if got, err := applyMembershipActiveTaskLimit(repository.New(db), "user-default", base); err != nil || got != int64(base) {
		t.Fatalf("plan 0 must fall back to global, limit = %d, err = %v", got, err)
	}
}

func TestApplyMembershipResourceLimitsOverrides(t *testing.T) {
	base := defaultRuntimePolicy().Resource
	free, err := applyMembershipResourceLimits(repository.New(newMembershipLimitsDB(t)), "user-free", base)
	if err != nil || free.StoredFileGB != base.StoredFileGB || free.DailyUploadMB != base.DailyUploadMB {
		t.Fatalf("free user resource limits changed: %+v", free)
	}

	db := newMembershipLimitsDB(t)
	createMembershipFixture(t, db, "user-cap", model.MembershipPlan{ID: "plan-cap", Name: "上限", Level: 1, Enabled: true, StorageGB: 100, DailyUploadMB: 4096})
	capped, err := applyMembershipResourceLimits(repository.New(db), "user-cap", base)
	if err != nil || capped.StoredFileGB != 100 || capped.DailyUploadMB != 4096 {
		t.Fatalf("plan caps = %+v, err = %v", capped, err)
	}

	db = newMembershipLimitsDB(t)
	createMembershipFixture(t, db, "user-unlimited", model.MembershipPlan{ID: "plan-max", Name: "无限", Level: 2, Enabled: true, StorageGB: -1, DailyUploadMB: -1})
	unlimited, err := applyMembershipResourceLimits(repository.New(db), "user-unlimited", base)
	if err != nil || unlimited.StoredFileGB != unlimitedStoredFileGB || unlimited.DailyUploadMB != unlimitedDailyUploadMB {
		t.Fatalf("unlimited plan limits = %+v, err = %v", unlimited, err)
	}

	db = newMembershipLimitsDB(t)
	createMembershipFixture(t, db, "user-default", model.MembershipPlan{ID: "plan-default", Name: "默认", Level: 3, Enabled: true})
	kept, err := applyMembershipResourceLimits(repository.New(db), "user-default", base)
	if err != nil || kept.StoredFileGB != base.StoredFileGB || kept.DailyUploadMB != base.DailyUploadMB {
		t.Fatalf("plan 0 must fall back to global: %+v, err = %v", kept, err)
	}
}

func TestReserveUserUploadQuotaAppliesMembershipDailyLimit(t *testing.T) {
	db := newMembershipLimitsDB(t)
	createMembershipFixture(t, db, "user-small", model.MembershipPlan{ID: "plan-small", Name: "小日限", Level: 1, Enabled: true, DailyUploadMB: 1})
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	if _, err := svc.reserveUserUploadQuota("user-small", 2<<20); err == nil {
		t.Fatal("2MB upload must exceed the 1MB daily membership limit")
	} else if appErr, ok := err.(*AppError); !ok || appErr.Reason != kernel.ReasonQuotaExceeded {
		t.Fatalf("expected quota error, got %v", err)
	}

	db = newMembershipLimitsDB(t)
	createMembershipFixture(t, db, "user-unlimited", model.MembershipPlan{ID: "plan-max", Name: "无限", Level: 2, Enabled: true, DailyUploadMB: -1})
	svc = &Service{repo: repository.New(db), dataDir: t.TempDir()}
	if _, err := svc.reserveUserUploadQuota("user-unlimited", 2<<20); err != nil {
		t.Fatalf("unlimited daily upload must pass: %v", err)
	}
}

func TestCheckinCreditsAppliesMembershipOverride(t *testing.T) {
	db := newMembershipLimitsDB(t)
	user := &model.User{ID: "user-member", Username: "member", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := db.Create(user).Error; err != nil {
		t.Fatal(err)
	}
	createMembershipFixture(t, db, user.ID, model.MembershipPlan{ID: "plan-bonus", Name: "高签到", Level: 1, Enabled: true, CheckinBonusOverrideMicrocredits: 20 * CreditScale})
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	account, _, err := svc.CheckinCredits(user)
	if err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != 20*CreditScale {
		t.Fatalf("membership checkin bonus = %d, want %d", account.AvailableMicrocredits, 20*CreditScale)
	}

	free := &model.User{ID: "user-free", Username: "free", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := db.Create(free).Error; err != nil {
		t.Fatal(err)
	}
	account, _, err = svc.CheckinCredits(free)
	if err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != 10*CreditScale {
		t.Fatalf("free checkin bonus = %d, want %d", account.AvailableMicrocredits, 10*CreditScale)
	}

	public, err := svc.publicCreditPolicy(user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if public.CheckinBonusMicrocredits != 20*CreditScale {
		t.Fatalf("public policy must show membership override, got %d", public.CheckinBonusMicrocredits)
	}
}
