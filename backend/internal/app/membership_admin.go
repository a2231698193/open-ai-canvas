package app

import (
	"fmt"
	"log/slog"
	"strings"
	"time"

	"yingce/backend/internal/model"
)

// membershipWindowDays 是发放锚点窗口长度：开通日起每 30 天一个窗口。
const membershipWindowDays = 30 * 24 * time.Hour

type AdminMembershipPlanRequest struct {
	ID                               string `json:"id,omitempty"`
	Name                             string `json:"name"`
	Level                            int    `json:"level"`
	Enabled                          bool   `json:"enabled"`
	SortOrder                        int    `json:"sortOrder"`
	MonthlyGrantMicrocredits         int64  `json:"monthlyGrantMicrocredits"`
	ActiveTaskLimit                  int    `json:"activeTaskLimit"`
	StorageGB                        int64  `json:"storageGB"`
	DailyUploadMB                    int64  `json:"dailyUploadMB"`
	CheckinBonusOverrideMicrocredits int64  `json:"checkinBonusOverrideMicrocredits"`
}

func (s *Service) AdminMembershipPlans(actor *model.User) ([]model.MembershipPlan, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.repo.MembershipPlans()
}

func (s *Service) AdminSaveMembershipPlan(actor *model.User, req AdminMembershipPlanRequest) (*model.MembershipPlan, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len([]rune(req.Name)) > 40 {
		return nil, BadAuthRequest("等级名称不能为空且不超过 40 字")
	}
	if req.Level < 1 || req.Level > 100 {
		return nil, BadAuthRequest("等级必须是 1-100 的整数")
	}
	if req.MonthlyGrantMicrocredits < 0 || req.StorageGB < 0 || req.DailyUploadMB < 0 || req.CheckinBonusOverrideMicrocredits < 0 {
		return nil, BadAuthRequest("等级额度不能为负数（-1 仅用于不限制类字段）")
	}
	plan := &model.MembershipPlan{
		ID:                               firstNonEmpty(strings.TrimSpace(req.ID), newID()),
		Name:                             req.Name,
		Level:                            req.Level,
		Enabled:                          req.Enabled,
		SortOrder:                        req.SortOrder,
		MonthlyGrantMicrocredits:         req.MonthlyGrantMicrocredits,
		ActiveTaskLimit:                  req.ActiveTaskLimit,
		StorageGB:                        req.StorageGB,
		DailyUploadMB:                    req.DailyUploadMB,
		CheckinBonusOverrideMicrocredits: req.CheckinBonusOverrideMicrocredits,
	}
	if err := s.repo.SaveMembershipPlan(plan); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "membership.plan.save", "membership_plan", plan.ID, "保存会员等级 "+plan.Name, map[string]any{"plan": plan}); err != nil {
		return nil, err
	}
	return s.repo.MembershipPlan(plan.ID)
}

// AdminGrantMembership 开通或续费会员，并按锚点规则补发当前应发放的窗口。
func (s *Service) AdminGrantMembership(actor *model.User, userID string, planID string, months int, note string) (*model.UserMembership, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	userID = strings.TrimSpace(userID)
	if months < 1 || months > 36 {
		return nil, BadAuthRequest("会员周期必须是 1-36 个月")
	}
	plan, err := s.repo.MembershipPlan(strings.TrimSpace(planID))
	if err != nil {
		return nil, BadAuthRequest("会员等级不存在")
	}
	if !plan.Enabled {
		return nil, BadAuthRequest("会员等级已停用")
	}
	membership, err := s.repo.ActiveUserMembership(userID)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	if membership == nil {
		membership = &model.UserMembership{
			ID: newID(), UserID: userID, PlanID: plan.ID, Status: model.MembershipStatusActive,
			PeriodStart: now, PeriodEnd: now.AddDate(0, months, 0), Note: strings.TrimSpace(note),
		}
		if err := s.repo.SaveUserMembership(membership); err != nil {
			return nil, err
		}
	} else {
		// 续费：周期顺延，等级跟随最新配置；锚点不变。
		newEnd := membership.PeriodEnd.AddDate(0, months, 0)
		if err := s.repo.ExtendUserMembership(membership.ID, newEnd, plan.ID, strings.TrimSpace(note)); err != nil {
			return nil, err
		}
		membership.PeriodEnd = newEnd
		membership.PlanID = plan.ID
	}
	if err := s.grantDueMembershipWindow(membership, plan); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "membership.grant", "user", userID,
		fmt.Sprintf("开通/续费会员 %s x %d 个月", plan.Name, months), map[string]any{"planId": plan.ID, "months": months, "note": note}); err != nil {
		return nil, err
	}
	return s.repo.UserMembershipByID(membership.ID)
}

// AdminUpgradeMembership 立即升级到更高等级并整额补差（新月额度 − 旧月额度）。
func (s *Service) AdminUpgradeMembership(actor *model.User, userID string, planID string, note string) (*model.UserMembership, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	membership, err := s.repo.ActiveUserMembership(strings.TrimSpace(userID))
	if err != nil {
		return nil, err
	}
	if membership == nil {
		return nil, BadAuthRequest("该用户没有生效中的会员，请直接开通")
	}
	oldPlan, err := s.repo.MembershipPlan(membership.PlanID)
	if err != nil {
		return nil, err
	}
	newPlan, err := s.repo.MembershipPlan(strings.TrimSpace(planID))
	if err != nil {
		return nil, BadAuthRequest("会员等级不存在")
	}
	// 降级拒绝放在 service 层：未来开放在线购买时同一约束自动生效。
	if newPlan.Level < oldPlan.Level {
		return nil, BadAuthRequest("暂不支持降级，请选择更高等级")
	}
	if newPlan.Level == oldPlan.Level {
		return nil, BadAuthRequest("会员已是该等级")
	}
	diff := newPlan.MonthlyGrantMicrocredits - oldPlan.MonthlyGrantMicrocredits
	if err := s.repo.UpdateUserMembershipPlan(membership.ID, newPlan.ID, strings.TrimSpace(note)); err != nil {
		return nil, err
	}
	if diff > 0 {
		expiresAt := s.membershipPoolExpiryFallback(membership)
		if _, _, err := s.repo.GrantMembershipCredits(membership.UserID, diff, expiresAt, model.CreditLedgerMembershipUpgradeDiff,
			"membership-upgrade:"+membership.ID+":"+fmt.Sprint(membership.PeriodEnd.Unix()), "升级补差："+oldPlan.Name+" → "+newPlan.Name); err != nil {
			return nil, err
		}
	}
	if err := s.appendAdminAudit(actor, "membership.upgrade", "user", membership.UserID,
		fmt.Sprintf("会员升级 %s → %s", oldPlan.Name, newPlan.Name), map[string]any{"from": oldPlan.ID, "to": newPlan.ID, "diff": diff}); err != nil {
		return nil, err
	}
	return s.repo.UserMembershipByID(membership.ID)
}

func (s *Service) AdminCancelMembership(actor *model.User, userID string, note string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	userID = strings.TrimSpace(userID)
	affected, err := s.repo.CancelUserMembership(userID)
	if err != nil {
		return err
	}
	if affected != 1 {
		return BadAuthRequest("该用户没有生效中的会员")
	}
	// 已发放的会员积分保留到自然过期，由清零任务回收。
	return s.appendAdminAudit(actor, "membership.cancel", "user", userID, "作废会员", map[string]any{"note": note})
}

// grantDueMembershipWindow 按锚点发放下一个应发放的窗口：
// 窗口 k 覆盖 [periodStart+(k-1)*30d, periodStart+k*30d)，now 到达窗口起点且尚未发放时发放，
// 有效期 = min(窗口末, periodEnd)；周期末尾不足 30 天按实际剩余天数，额度仍为整月。
func (s *Service) grantDueMembershipWindow(membership *model.UserMembership, plan *model.MembershipPlan) error {
	for {
		next := membership.GrantedMonths + 1
		windowStart := membership.PeriodStart.Add(time.Duration(next-1) * membershipWindowDays)
		if !windowStart.Before(membership.PeriodEnd) || !windowStart.Before(time.Now()) {
			return nil
		}
		windowEnd := windowStart.Add(membershipWindowDays)
		if windowEnd.After(membership.PeriodEnd) {
			windowEnd = membership.PeriodEnd
		}
		if _, _, err := s.repo.GrantMembershipCredits(membership.UserID, plan.MonthlyGrantMicrocredits, windowEnd,
			model.CreditLedgerMembershipGrant, fmt.Sprintf("membership-grant:%s:%d", membership.ID, next),
			fmt.Sprintf("会员积分发放（第 %d 个 30 天窗口）", next)); err != nil {
			return err
		}
		if err := s.repo.UpdateMembershipGrantedMonths(membership.ID, membership.GrantedMonths, next); err != nil {
			return err
		}
		membership.GrantedMonths = next
	}
}

// runMembershipGrantSweep 每日任务：扫描全部生效会员，补发到期的锚点窗口。
func (s *Service) runMembershipGrantSweep() error {
	memberships, err := s.repo.ActiveUserMemberships()
	if err != nil {
		return err
	}
	for _, membership := range memberships {
		plan, err := s.repo.MembershipPlan(membership.PlanID)
		if err != nil || !plan.Enabled {
			continue
		}
		if err := s.grantDueMembershipWindow(&membership, plan); err != nil {
			slog.Warn("membership anchor grant failed", "membershipId", membership.ID, "error", err)
		}
	}
	return nil
}

// membershipPoolExpiryFallback 升级补差的有效期：跟随当前会员池到期时间；
// 池为空或已过期时退回当前窗口末（不超过周期末）。
func (s *Service) membershipPoolExpiryFallback(membership *model.UserMembership) time.Time {
	account, err := s.repo.CreditAccount(membership.UserID)
	if err == nil && !account.MembershipExpiresAt.IsZero() && account.MembershipExpiresAt.After(time.Now()) {
		return account.MembershipExpiresAt
	}
	windowEnd := membership.PeriodStart.Add(time.Duration(membership.GrantedMonths) * membershipWindowDays)
	if windowEnd.After(membership.PeriodEnd) {
		windowEnd = membership.PeriodEnd
	}
	return windowEnd
}
