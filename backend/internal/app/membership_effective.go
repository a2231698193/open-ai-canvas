package app

import (
	"time"

	"yingce/backend/internal/repository"
)

// 会员覆盖语义：0=沿用全局默认，-1=不限制，>0=按等级上限。
// 哨兵值表达"不限制"，直接参与既有 >= 上限比较，不需要调用方分支处理。
const (
	unlimitedStoredFileGB  = int64(1) << 20 // 1 EiB
	unlimitedDailyUploadMB = int64(1) << 30
	unlimitedActiveTasks   = int64(1) << 31
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

// effectiveMembershipFor 解析用户当前生效的会员；无订阅、已作废或周期已结束都回退 Free。
func effectiveMembershipFor(repo *repository.Repository, userID string) (EffectiveMembership, error) {
	effective := EffectiveMembership{}
	membership, err := repo.ActiveUserMembership(userID)
	if err != nil {
		return effective, err
	}
	if membership == nil {
		return effective, nil
	}
	plan, err := repo.MembershipPlan(membership.PlanID)
	if err != nil {
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

func (s *Service) effectiveMembership(userID string) (EffectiveMembership, error) {
	return effectiveMembershipFor(s.repo, userID)
}

// applyMembershipActiveTaskLimit 返回会员覆盖后的并发任务上限。
func applyMembershipActiveTaskLimit(repo *repository.Repository, userID string, base int) (int64, error) {
	effective, err := effectiveMembershipFor(repo, userID)
	if err != nil || !effective.Active {
		return int64(base), err
	}
	switch {
	case effective.ActiveTaskLimit < 0:
		return unlimitedActiveTasks, nil
	case effective.ActiveTaskLimit > 0:
		return int64(effective.ActiveTaskLimit), nil
	default:
		return int64(base), nil
	}
}

// applyMembershipResourceLimits 把生效会员的存储总量与日上传覆盖写入 resource。
func applyMembershipResourceLimits(repo *repository.Repository, userID string, resource RuntimeResourcePolicy) (RuntimeResourcePolicy, error) {
	effective, err := effectiveMembershipFor(repo, userID)
	if err != nil || !effective.Active {
		return resource, err
	}
	switch {
	case effective.StorageGB < 0:
		resource.StoredFileGB = unlimitedStoredFileGB
	case effective.StorageGB > 0:
		resource.StoredFileGB = effective.StorageGB
	}
	switch {
	case effective.DailyUploadMB < 0:
		resource.DailyUploadMB = unlimitedDailyUploadMB
	case effective.DailyUploadMB > 0:
		resource.DailyUploadMB = effective.DailyUploadMB
	}
	return resource, nil
}

// checkinBonusForMembership 返回签到奖励：生效会员的覆盖值优先（>0 才生效）。
func checkinBonusForMembership(policy CreditPolicy, effective EffectiveMembership) int64 {
	if effective.Active && effective.CheckinBonusOverrideMicrocredits > 0 {
		return effective.CheckinBonusOverrideMicrocredits
	}
	return policy.CheckinBonusMicrocredits
}
