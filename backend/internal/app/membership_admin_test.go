package app

import (
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newMembershipAdminDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:membership-admin-"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.MembershipPlan{}, &model.UserMembership{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.User{}, &model.SystemSetting{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_memberships_active_user ON user_memberships(user_id) WHERE status = 'active'").Error; err != nil {
		t.Fatal(err)
	}
	return db
}

func adminActor() *model.User {
	return &model.User{ID: "admin-1", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
}

func TestAdminSaveMembershipPlanCreatesAndUpdates(t *testing.T) {
	svc := &Service{repo: repository.New(newMembershipAdminDB(t)), dataDir: t.TempDir()}
	actor := adminActor()

	created, err := svc.AdminSaveMembershipPlan(actor, AdminMembershipPlanRequest{Name: "专业版", Level: 2, Enabled: true, MonthlyGrantMicrocredits: 30 * CreditScale, ActiveTaskLimit: 10, StorageGB: 100, DailyUploadMB: 4096, CheckinBonusOverrideMicrocredits: 20 * CreditScale})
	if err != nil {
		t.Fatal(err)
	}
	if created.ID == "" || created.Name != "专业版" || created.MonthlyGrantMicrocredits != 30*CreditScale {
		t.Fatalf("created plan = %+v", created)
	}

	updated, err := svc.AdminSaveMembershipPlan(actor, AdminMembershipPlanRequest{ID: created.ID, Name: "专业版 Pro", Level: 2, Enabled: false, MonthlyGrantMicrocredits: 40 * CreditScale})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Name != "专业版 Pro" || updated.Enabled || updated.MonthlyGrantMicrocredits != 40*CreditScale {
		t.Fatalf("updated plan = %+v", updated)
	}

	plans, err := svc.AdminMembershipPlans(actor)
	if err != nil || len(plans) != 1 {
		t.Fatalf("plans = %+v, err = %v", plans, err)
	}

	if _, err := svc.AdminSaveMembershipPlan(actor, AdminMembershipPlanRequest{Name: "  ", Level: 1, Enabled: true}); err == nil {
		t.Fatal("empty plan name must be rejected")
	}
	if _, err := svc.AdminSaveMembershipPlan(&model.User{ID: "u", Role: model.UserRoleUser}, AdminMembershipPlanRequest{Name: "x", Level: 1}); err == nil {
		t.Fatal("non-admin must be rejected")
	}
}

func TestAdminGrantMembershipOpensAndGrantsFirstWindow(t *testing.T) {
	db := newMembershipAdminDB(t)
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	actor := adminActor()
	plan, err := svc.AdminSaveMembershipPlan(actor, AdminMembershipPlanRequest{Name: "专业版", Level: 2, Enabled: true, MonthlyGrantMicrocredits: 30 * CreditScale})
	if err != nil {
		t.Fatal(err)
	}

	membership, err := svc.AdminGrantMembership(actor, "user-1", plan.ID, 3, "新开通")
	if err != nil {
		t.Fatal(err)
	}
	if membership.Status != model.MembershipStatusActive || membership.GrantedMonths != 1 {
		t.Fatalf("membership = %+v", membership)
	}
	if !membership.PeriodEnd.After(time.Now().Add(80 * 24 * time.Hour)) {
		t.Fatalf("period end = %v, want ~3 months", membership.PeriodEnd)
	}
	account, err := svc.repo.CreditAccount("user-1")
	if err != nil {
		t.Fatal(err)
	}
	if account.MembershipMicrocredits != 30*CreditScale {
		t.Fatalf("membership pool = %d", account.MembershipMicrocredits)
	}
	if account.MembershipExpiresAt.Before(time.Now().Add(29*24*time.Hour)) || account.MembershipExpiresAt.After(membership.PeriodEnd) {
		t.Fatalf("first window expiry = %v", account.MembershipExpiresAt)
	}
	var entry model.CreditLedgerEntry
	if err := db.First(&entry, "user_id = ? AND type = ?", "user-1", model.CreditLedgerMembershipGrant).Error; err != nil {
		t.Fatal("first window grant must be in ledger:", err)
	}
	if entry.ReferenceKey == nil || *entry.ReferenceKey != "membership-grant:"+membership.ID+":1" {
		t.Fatalf("grant reference key = %v", entry.ReferenceKey)
	}
	var audits int64
	db.Model(&model.AdminAuditEvent{}).Where("target_id = ?", "user-1").Count(&audits)
	if audits == 0 {
		t.Fatal("grant must write admin audit")
	}
}

func TestAdminGrantMembershipRenewsWithoutImmediateGrant(t *testing.T) {
	db := newMembershipAdminDB(t)
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	actor := adminActor()
	plan, _ := svc.AdminSaveMembershipPlan(actor, AdminMembershipPlanRequest{Name: "专业版", Level: 2, Enabled: true, MonthlyGrantMicrocredits: 30 * CreditScale})
	// 10 天前开通 1 个月：窗口 1 已发放，窗口 2 未到期。
	membership := model.UserMembership{ID: "m-1", UserID: "user-1", PlanID: plan.ID, Status: model.MembershipStatusActive, PeriodStart: time.Now().AddDate(0, 0, -10), PeriodEnd: time.Now().AddDate(0, 0, 20), GrantedMonths: 1}
	if err := db.Create(&membership).Error; err != nil {
		t.Fatal(err)
	}

	renewed, err := svc.AdminGrantMembership(actor, "user-1", plan.ID, 1, "续费")
	if err != nil {
		t.Fatal(err)
	}
	if !renewed.PeriodEnd.After(time.Now().Add(45 * 24 * time.Hour)) {
		t.Fatalf("period end not extended: %v", renewed.PeriodEnd)
	}
	if renewed.GrantedMonths != 1 {
		t.Fatalf("window 2 must not be granted yet, granted = %d", renewed.GrantedMonths)
	}
	account, _ := svc.repo.CreditAccount("user-1")
	if account.MembershipMicrocredits != 0 {
		t.Fatalf("no immediate grant expected, pool = %d", account.MembershipMicrocredits)
	}
}

func TestAdminUpgradeMembershipAddsDiffImmediately(t *testing.T) {
	db := newMembershipAdminDB(t)
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	actor := adminActor()
	basic, _ := svc.AdminSaveMembershipPlan(actor, AdminMembershipPlanRequest{Name: "基础", Level: 1, Enabled: true, MonthlyGrantMicrocredits: 10 * CreditScale})
	pro, _ := svc.AdminSaveMembershipPlan(actor, AdminMembershipPlanRequest{Name: "专业", Level: 2, Enabled: true, MonthlyGrantMicrocredits: 30 * CreditScale})
	if err := db.Create(&model.UserMembership{ID: "m-1", UserID: "user-1", PlanID: basic.ID, Status: model.MembershipStatusActive, PeriodStart: time.Now().AddDate(0, 0, -5), PeriodEnd: time.Now().AddDate(0, 0, 25), GrantedMonths: 1}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CreditAccount{UserID: "user-1", MembershipMicrocredits: 10 * CreditScale, MembershipExpiresAt: time.Now().Add(25 * 24 * time.Hour)}).Error; err != nil {
		t.Fatal(err)
	}

	membership, err := svc.AdminUpgradeMembership(actor, "user-1", pro.ID, "升级")
	if err != nil {
		t.Fatal(err)
	}
	if membership.PlanID != pro.ID {
		t.Fatalf("plan not switched: %+v", membership)
	}
	account, _ := svc.repo.CreditAccount("user-1")
	if account.MembershipMicrocredits != 30*CreditScale {
		t.Fatalf("pool after upgrade diff = %d, want 30 (10+20)", account.MembershipMicrocredits)
	}
	if !account.MembershipExpiresAt.After(time.Now().Add(24 * 24 * time.Hour)) {
		t.Fatalf("upgrade diff must follow current pool expiry: %v", account.MembershipExpiresAt)
	}
	var entry model.CreditLedgerEntry
	if err := db.First(&entry, "user_id = ? AND type = ?", "user-1", model.CreditLedgerMembershipUpgradeDiff).Error; err != nil {
		t.Fatal("upgrade diff must be in ledger:", err)
	}
	if entry.AmountMicrocredits != 20*CreditScale {
		t.Fatalf("diff amount = %d", entry.AmountMicrocredits)
	}
}

func TestAdminUpgradeMembershipRejectsDowngradeAndSameLevel(t *testing.T) {
	db := newMembershipAdminDB(t)
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	actor := adminActor()
	basic, _ := svc.AdminSaveMembershipPlan(actor, AdminMembershipPlanRequest{Name: "基础", Level: 1, Enabled: true, MonthlyGrantMicrocredits: 10 * CreditScale})
	pro, _ := svc.AdminSaveMembershipPlan(actor, AdminMembershipPlanRequest{Name: "专业", Level: 2, Enabled: true, MonthlyGrantMicrocredits: 30 * CreditScale})
	if err := db.Create(&model.UserMembership{ID: "m-1", UserID: "user-1", PlanID: pro.ID, Status: model.MembershipStatusActive, PeriodStart: time.Now(), PeriodEnd: time.Now().AddDate(0, 1, 0), GrantedMonths: 1}).Error; err != nil {
		t.Fatal(err)
	}

	if _, err := svc.AdminUpgradeMembership(actor, "user-1", basic.ID, "降级"); err == nil {
		t.Fatal("downgrade must be rejected at service layer")
	}
	if _, err := svc.AdminUpgradeMembership(actor, "user-1", pro.ID, "同等级"); err == nil {
		t.Fatal("same-level upgrade must be rejected")
	}
}

func TestAdminCancelMembershipFallsBackToFree(t *testing.T) {
	db := newMembershipAdminDB(t)
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	actor := adminActor()
	plan, _ := svc.AdminSaveMembershipPlan(actor, AdminMembershipPlanRequest{Name: "专业", Level: 2, Enabled: true, MonthlyGrantMicrocredits: 30 * CreditScale})
	if _, err := svc.AdminGrantMembership(actor, "user-1", plan.ID, 1, ""); err != nil {
		t.Fatal(err)
	}

	if err := svc.AdminCancelMembership(actor, "user-1", "作废"); err != nil {
		t.Fatal(err)
	}
	effective, err := svc.effectiveMembership("user-1")
	if err != nil {
		t.Fatal(err)
	}
	if effective.Active {
		t.Fatalf("cancelled membership must fall back to free: %+v", effective)
	}
	// 已发放的会员积分保留到自然过期。
	account, _ := svc.repo.CreditAccount("user-1")
	if account.MembershipMicrocredits != 30*CreditScale {
		t.Fatalf("cancel must not clear the pool: %d", account.MembershipMicrocredits)
	}
	if err := svc.AdminCancelMembership(actor, "user-none", "再次作废"); err == nil {
		t.Fatal("cancel without active membership must fail")
	}
}

func TestMembershipGrantSweepGrantsDueWindowsIdempotently(t *testing.T) {
	db := newMembershipAdminDB(t)
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	actor := adminActor()
	plan, _ := svc.AdminSaveMembershipPlan(actor, AdminMembershipPlanRequest{Name: "专业", Level: 2, Enabled: true, MonthlyGrantMicrocredits: 30 * CreditScale})
	// 40 天前开通 3 个月：窗口 1 已发，窗口 2（第 30 天起）已到期未发。
	if err := db.Create(&model.UserMembership{ID: "m-1", UserID: "user-1", PlanID: plan.ID, Status: model.MembershipStatusActive, PeriodStart: time.Now().AddDate(0, 0, -40), PeriodEnd: time.Now().AddDate(0, 0, 50), GrantedMonths: 1}).Error; err != nil {
		t.Fatal(err)
	}

	if err := svc.runMembershipGrantSweep(); err != nil {
		t.Fatal(err)
	}
	var membership model.UserMembership
	if err := db.First(&membership, "id = ?", "m-1").Error; err != nil {
		t.Fatal(err)
	}
	if membership.GrantedMonths != 2 {
		t.Fatalf("granted months = %d, want 2", membership.GrantedMonths)
	}
	account, _ := svc.repo.CreditAccount("user-1")
	if account.MembershipMicrocredits != 30*CreditScale {
		t.Fatalf("pool = %d", account.MembershipMicrocredits)
	}

	// 幂等：重复清扫不重复发放。
	if err := svc.runMembershipGrantSweep(); err != nil {
		t.Fatal(err)
	}
	db.First(&membership, "id = ?", "m-1")
	if membership.GrantedMonths != 2 {
		t.Fatalf("second sweep granted again: %d", membership.GrantedMonths)
	}
	account, _ = svc.repo.CreditAccount("user-1")
	if account.MembershipMicrocredits != 30*CreditScale {
		t.Fatalf("pool after second sweep = %d", account.MembershipMicrocredits)
	}
}
