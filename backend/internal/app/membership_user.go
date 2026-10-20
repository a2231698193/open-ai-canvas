package app

import (
	"time"

	"yingce/backend/internal/model"
)

// UserMembershipPlansResult 是用户端会员页的一次性数据：可选购等级 + 当前订阅状态。
type UserMembershipPlansResult struct {
	Plans            []model.MembershipPlan            `json:"plans"`
	Membership       *model.UserMembership             `json:"membership,omitempty"`
	Effective        EffectiveMembership               `json:"effective"`
	PaymentAvailable bool                              `json:"paymentAvailable"`
	UpgradeQuotes    map[string]MembershipUpgradeQuote `json:"upgradeQuotes,omitempty"`
}

// UserMembershipPlans 返回启用中的会员等级（level 升序）与当前用户的订阅状态。
func (s *Service) UserMembershipPlans(userID string) (*UserMembershipPlansResult, error) {
	plans, err := s.repo.EnabledMembershipPlans()
	if err != nil {
		return nil, err
	}
	membership, err := s.repo.ActiveUserMembership(userID)
	if err != nil {
		return nil, err
	}
	effective, err := s.effectiveMembership(userID)
	if err != nil {
		return nil, err
	}
	var quotes map[string]MembershipUpgradeQuote
	if effective.Active {
		oldPlan, planErr := s.repo.MembershipPlan(effective.PlanID)
		if planErr != nil {
			return nil, planErr
		}
		for _, plan := range plans {
			if plan.Level <= effective.Level {
				continue
			}
			if quotes == nil {
				quotes = make(map[string]MembershipUpgradeQuote)
			}
			quotes[plan.ID] = membershipUpgradeQuote(oldPlan, &plan, effective.PeriodEnd, time.Now())
		}
	}
	return &UserMembershipPlansResult{
		Plans: plans, Membership: membership, Effective: effective,
		PaymentAvailable: s.paymentPurchaseAvailable(), UpgradeQuotes: quotes,
	}, nil
}
