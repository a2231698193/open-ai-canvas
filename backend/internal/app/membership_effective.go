package app

import (
	"time"

	"yingce/backend/internal/model"
)

// EffectiveMembership 是扣费、限制与签到共同使用的会员解析结果。
// Active 为 false 时即 Free 兜底：所有限制字段为 0，表示沿用全局默认值。
type EffectiveMembership struct {
	Active      bool      `json:"active"`
	PlanID      string    `json:"planId,omitempty"`
	PlanName    string    `json:"planName,omitempty"`
	Level       int       `json:"level"`
	PeriodStart time.Time `json:"periodStart,omitempty"`
	PeriodEnd   time.Time `json:"periodEnd,omitempty"`

	MonthlyGrantMicrocredits         int64 `json:"monthlyGrantMicrocredits"`
	ActiveTaskLimit                  int   `json:"activeTaskLimit"`
	StorageGB                        int64 `json:"storageGB"`
	DailyUploadMB                    int64 `json:"dailyUploadMB"`
	CheckinBonusOverrideMicrocredits int64 `json:"checkinBonusOverrideMicrocredits"`
}

// effectiveMembership 解析用户当前生效的会员；无订阅、已作废或周期已结束都回退 Free。
func (s *Service) effectiveMembership(userID string) (EffectiveMembership, error) {
	effective := EffectiveMembership{}
	membership, err := s.repo.ActiveUserMembership(userID)
	if err != nil {
		return effective, err
	}
	if membership == nil {
		return effective, nil
	}
	var plan *model.MembershipPlan
	if plan, err = s.repo.MembershipPlan(membership.PlanID); err != nil {
		return effective, err
	}
	if !plan.Enabled {
		return effective, nil
	}
	return EffectiveMembership{
		Active:                           true,
		PlanID:                           plan.ID,
		PlanName:                         plan.Name,
		Level:                            plan.Level,
		PeriodStart:                      membership.PeriodStart,
		PeriodEnd:                        membership.PeriodEnd,
		MonthlyGrantMicrocredits:         plan.MonthlyGrantMicrocredits,
		ActiveTaskLimit:                  plan.ActiveTaskLimit,
		StorageGB:                        plan.StorageGB,
		DailyUploadMB:                    plan.DailyUploadMB,
		CheckinBonusOverrideMicrocredits: plan.CheckinBonusOverrideMicrocredits,
	}, nil
}
