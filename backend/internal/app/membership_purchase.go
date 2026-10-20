package app

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

const (
	membershipMonthsMonthly   = 1
	membershipMonthsQuarterly = 3
	membershipMonthsYearly    = 12
)

type CreateMembershipOrderRequest struct {
	PlanID         string `json:"planId"`
	Months         int    `json:"months"`
	ProviderID     string `json:"providerId"`
	IdempotencyKey string `json:"idempotencyKey"`
}

type MembershipUpgradeQuote struct {
	PlanID        string `json:"planId"`
	AmountFen     int64  `json:"amountFen"`
	RemainingDays int    `json:"remainingDays"`
	CanUpgrade    bool   `json:"canUpgrade"`
	Reason        string `json:"reason,omitempty"`
}

func membershipDurationPrice(plan *model.MembershipPlan, months int) int64 {
	switch months {
	case membershipMonthsMonthly:
		return plan.MonthPriceFen
	case membershipMonthsQuarterly:
		return plan.QuarterPriceFen
	case membershipMonthsYearly:
		return plan.YearPriceFen
	default:
		return 0
	}
}

func remainingMembershipDays(periodEnd, now time.Time) int {
	if !periodEnd.After(now) {
		return 0
	}
	return int(math.Ceil(periodEnd.Sub(now).Hours() / 24))
}

func ceilDiv(value, divisor int64) int64 {
	if value <= 0 {
		return 0
	}
	return (value + divisor - 1) / divisor
}

// membershipUpgradeQuote 按剩余天数折算升级差价；周期不变，旧等级月价为 0 时走管理员。
func membershipUpgradeQuote(oldPlan, newPlan *model.MembershipPlan, periodEnd, now time.Time) MembershipUpgradeQuote {
	quote := MembershipUpgradeQuote{PlanID: newPlan.ID, RemainingDays: remainingMembershipDays(periodEnd, now)}
	switch {
	case quote.RemainingDays <= 0:
		quote.Reason = "当前会员即将到期，请直接续费"
	case oldPlan.MonthPriceFen <= 0:
		quote.Reason = "当前会员由管理员开通，升级请联系管理员"
	case newPlan.MonthPriceFen <= 0:
		quote.Reason = "该等级暂未定价"
	case newPlan.MonthPriceFen <= oldPlan.MonthPriceFen:
		quote.Reason = "目标等级价格未高于当前等级"
	default:
		quote.AmountFen = ceilDiv((newPlan.MonthPriceFen-oldPlan.MonthPriceFen)*int64(quote.RemainingDays), 30)
		quote.CanUpgrade = true
	}
	return quote
}

func membershipMonthsLabel(months int) string {
	switch months {
	case membershipMonthsMonthly:
		return "1 个月"
	case membershipMonthsQuarterly:
		return "3 个月"
	case membershipMonthsYearly:
		return "12 个月"
	default:
		return fmt.Sprintf("%d 个月", months)
	}
}

func membershipOrderProductName(plan *model.MembershipPlan, change model.MembershipChangeType, months int) string {
	switch change {
	case model.MembershipChangeUpgrade:
		return plan.Name + "会员升级"
	case model.MembershipChangeRenew:
		return plan.Name + "会员续费 · " + membershipMonthsLabel(months)
	default:
		return plan.Name + "会员 · " + membershipMonthsLabel(months)
	}
}

func (s *Service) paymentPurchaseAvailable() bool {
	enabled, err := s.FeatureEnabled(FeatureCredits)
	if err != nil || !enabled {
		return false
	}
	for _, descriptor := range s.paymentRegistry.Descriptors() {
		view, _, err := s.paymentProviderView(descriptor)
		if err == nil && view.Enabled && view.Configured {
			return true
		}
	}
	return false
}

// ActiveMembershipOrder 返回当前用户未完成的会员订单；没有时返回 nil。
func (s *Service) ActiveMembershipOrder(actor *model.User) (*PaymentOrderView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	order, err := s.repo.ActiveMembershipPaymentOrder(actor.ID)
	if err != nil {
		return nil, err
	}
	if order == nil {
		return nil, nil
	}
	view := paymentOrderView(*order)
	return &view, nil
}

func (s *Service) CreateMembershipOrder(ctx context.Context, actor *model.User, request CreateMembershipOrderRequest) (*PaymentOrderView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return nil, err
	}
	idempotencyKey := strings.TrimSpace(request.IdempotencyKey)
	if idempotencyKey == "" {
		return nil, BadAuthRequest("支付幂等标识不能为空")
	}
	if len(idempotencyKey) > 120 {
		return nil, BadAuthRequest("支付幂等标识过长")
	}
	planID := strings.TrimSpace(request.PlanID)
	providerID := strings.TrimSpace(request.ProviderID)
	if existing, err := s.repo.PaymentOrderByIdempotency(actor.ID, idempotencyKey); err == nil {
		if existing.Kind != model.PaymentOrderKindMembership || existing.MembershipPlanID != planID || existing.ProviderID != providerID {
			return nil, NewAppError(http.StatusConflict, "支付幂等标识已用于不同的商品或支付渠道")
		}
		result := paymentOrderView(*existing)
		return &result, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	pendingOrders, err := s.repo.ActiveMembershipPaymentOrderCount(actor.ID)
	if err != nil {
		return nil, err
	}
	if pendingOrders > 0 {
		return nil, NewAppError(http.StatusConflict, "已有待支付的会员订单，请先完成或关闭")
	}

	plan, err := s.repo.MembershipPlan(planID)
	if err != nil {
		return nil, BadAuthRequest("会员等级不存在")
	}
	if !plan.Enabled {
		return nil, BadAuthRequest("会员等级已停用")
	}

	change := model.MembershipChangeNew
	months := request.Months
	var previousPlan *model.MembershipPlan
	var amountFen, creditDiff int64
	remainingDays := 0
	effective, err := s.effectiveMembership(actor.ID)
	if err != nil {
		return nil, err
	}
	if effective.Active {
		previousPlan, err = s.repo.MembershipPlan(effective.PlanID)
		if err != nil {
			return nil, BadAuthRequest("当前会员等级不存在")
		}
		switch {
		case plan.Level < previousPlan.Level:
			return nil, BadAuthRequest("暂不支持降级，请选择更高等级")
		case plan.Level == previousPlan.Level:
			change = model.MembershipChangeRenew
		default:
			change = model.MembershipChangeUpgrade
		}
	}

	switch change {
	case model.MembershipChangeNew, model.MembershipChangeRenew:
		amountFen = membershipDurationPrice(plan, months)
		if amountFen <= 0 {
			return nil, BadAuthRequest("该会员方案暂未开放购买")
		}
	case model.MembershipChangeUpgrade:
		quote := membershipUpgradeQuote(previousPlan, plan, effective.PeriodEnd, time.Now())
		if !quote.CanUpgrade {
			return nil, BadAuthRequest(firstNonEmpty(quote.Reason, "当前无法在线升级"))
		}
		months = 0
		amountFen = quote.AmountFen
		remainingDays = quote.RemainingDays
		creditDiff = plan.MonthlyGrantMicrocredits - previousPlan.MonthlyGrantMicrocredits
		if creditDiff < 0 {
			creditDiff = 0
		}
	}

	provider, ok := s.paymentRegistry.Get(providerID)
	if !ok {
		return nil, BadAuthRequest("未知支付渠道")
	}
	providerView, config, err := s.paymentProviderView(provider.Descriptor())
	if err != nil {
		return nil, err
	}
	if !providerView.Enabled || !providerView.Configured || config == nil {
		return nil, Forbidden("支付渠道未启用或尚未配置")
	}
	activeCount, err := s.repo.ActivePaymentOrderCount(actor.ID)
	if err != nil {
		return nil, err
	}
	if activeCount >= maxActivePaymentOrdersPerUser {
		return nil, NewAppError(http.StatusConflict, "未支付订单过多，请先完成或关闭已有订单")
	}

	now := time.Now()
	order := &model.PaymentOrder{
		ID: newID(), UserID: actor.ID, IdempotencyKey: idempotencyKey, MerchantOrderNo: newID(),
		Kind:                  model.PaymentOrderKindMembership,
		ProductName:           membershipOrderProductName(plan, change, months),
		ProviderID:            provider.Descriptor().ID,
		PluginID:              provider.Descriptor().PluginID,
		PluginVersion:         provider.Descriptor().PluginVersion,
		ProviderConfigID:      config.ID,
		ProviderConfigVersion: config.Version,
		AmountFen:             amountFen, Currency: "CNY", CreditsMicrocredits: 0,
		Status: model.PaymentOrderCreated, CheckoutMode: provider.Descriptor().CheckoutMode,
		ExpiresAt: now.Add(time.Duration(config.CloseAfterMinutes) * time.Minute),

		MembershipPlanID: plan.ID, MembershipPlanName: plan.Name, MembershipLevel: plan.Level,
		MembershipMonths: months, MembershipChange: change,
		MembershipRemainingDays:            remainingDays,
		MembershipMonthlyGrantMicrocredits: plan.MonthlyGrantMicrocredits,
		MembershipCreditDiffMicrocredits:   creditDiff,
	}
	if previousPlan != nil {
		order.MembershipPreviousPlanID = previousPlan.ID
		order.MembershipPreviousPlanName = previousPlan.Name
	}

	order, created, err := s.repo.CreateMembershipPaymentOrder(order)
	if err != nil {
		return nil, err
	}
	if !created {
		if order.Kind != model.PaymentOrderKindMembership || order.MembershipPlanID != planID || order.ProviderID != providerID {
			return nil, NewAppError(http.StatusConflict, "支付幂等标识已用于不同的商品或支付渠道")
		}
		result := paymentOrderView(*order)
		return &result, nil
	}
	return s.createPaymentCheckout(ctx, order, provider, config)
}
