package app

import (
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestUserMembershipPlansReturnsEnabledPlansAndStatus(t *testing.T) {
	db := newMembershipAdminDB(t)
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	actor := adminActor()
	pro, err := svc.AdminSaveMembershipPlan(actor, AdminMembershipPlanRequest{Name: "专业", Level: 2, Enabled: true, MonthlyGrantMicrocredits: 30 * CreditScale, ActiveTaskLimit: 10, StorageGB: 100, DailyUploadMB: 4096, CheckinBonusOverrideMicrocredits: 20 * CreditScale})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AdminSaveMembershipPlan(actor, AdminMembershipPlanRequest{Name: "停用档", Level: 3, Enabled: false, MonthlyGrantMicrocredits: 50 * CreditScale}); err != nil {
		t.Fatal(err)
	}
	basic := &model.MembershipPlan{ID: "plan-basic", Name: "基础", Level: 1, Enabled: true, MonthlyGrantMicrocredits: 10 * CreditScale}
	if err := db.Create(basic).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AdminGrantMembership(actor, "user-1", pro.ID, 1, ""); err != nil {
		t.Fatal(err)
	}

	result, err := svc.UserMembershipPlans("user-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Plans) != 2 {
		t.Fatalf("enabled plans = %d, want 2", len(result.Plans))
	}
	if result.Plans[0].Level != 1 || result.Plans[1].Level != 2 {
		t.Fatalf("plans not level-ascending: %+v", result.Plans)
	}
	if result.Membership == nil || result.Membership.PlanID != pro.ID {
		t.Fatalf("membership = %+v", result.Membership)
	}
	if !result.Effective.Active || result.Effective.PlanName != "专业" {
		t.Fatalf("effective = %+v", result.Effective)
	}

	free, err := svc.UserMembershipPlans("user-none")
	if err != nil {
		t.Fatal(err)
	}
	if free.Membership != nil || free.Effective.Active {
		t.Fatalf("free user status = %+v", free)
	}
}
