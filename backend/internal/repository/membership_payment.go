package repository

import (
	"errors"
	"fmt"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// applyMembershipPayment 在支付订单入账事务内完成会员开通/续费/升级。
// 调用方已锁住支付订单；这里再锁用户唯一的 active 订阅，保证同一用户的会员变更串行。
func applyMembershipPayment(tx *gorm.DB, order *model.PaymentOrder) error {
	if order == nil || order.MembershipPlanID == "" || order.MembershipChange == "" {
		return ErrPaymentOrderStateConflict
	}
	if _, err := membershipPlanForPaymentTx(tx, order.MembershipPlanID); err != nil {
		return ErrPaymentOrderStateConflict
	}
	membership, err := lockOpenMembershipTx(tx, order.UserID)
	if err != nil {
		return err
	}
	now := time.Now()
	if err := clearExpiredMembershipPoolTx(tx, order.UserID, now); err != nil {
		return err
	}

	switch order.MembershipChange {
	case model.MembershipChangeNew:
		if order.MembershipMonths <= 0 {
			return ErrPaymentOrderStateConflict
		}
		if membership != nil && membership.PeriodEnd.After(now) {
			oldPlan, oldPlanErr := membershipPlanForPaymentTx(tx, membership.PlanID)
			if oldPlanErr == nil && oldPlan.Enabled {
				// 同一用户并发创建了两笔开通订单：同等级按续费处理，不同等级交给人工。
				if membership.PlanID != order.MembershipPlanID {
					return ErrPaymentOrderStateConflict
				}
				membership.PeriodEnd = membership.PeriodEnd.AddDate(0, order.MembershipMonths, 0)
				if err := updateMembershipPeriodTx(tx, membership); err != nil {
					return err
				}
				return grantDueMembershipWindowsTx(tx, membership, order.MembershipMonthlyGrantMicrocredits)
			}
			// 旧等级已停用或删除：结束旧周期，按新购处理。
		}
		if membership != nil {
			if err := closeMembershipTx(tx, membership.ID, now); err != nil {
				return err
			}
		}
		membership = &model.UserMembership{
			ID: newRepositoryID(), UserID: order.UserID, PlanID: order.MembershipPlanID,
			Status: model.MembershipStatusActive, PeriodStart: now,
			PeriodEnd: now.AddDate(0, order.MembershipMonths, 0), Note: "在线开通",
		}
		if err := tx.Create(membership).Error; err != nil {
			return err
		}
		return grantDueMembershipWindowsTx(tx, membership, order.MembershipMonthlyGrantMicrocredits)

	case model.MembershipChangeRenew:
		if order.MembershipMonths <= 0 || membership == nil || membership.PlanID != order.MembershipPlanID {
			return ErrPaymentOrderStateConflict
		}
		if membership.PeriodEnd.After(now) {
			membership.PeriodEnd = membership.PeriodEnd.AddDate(0, order.MembershipMonths, 0)
			if err := updateMembershipPeriodTx(tx, membership); err != nil {
				return err
			}
			return grantDueMembershipWindowsTx(tx, membership, order.MembershipMonthlyGrantMicrocredits)
		}
		// 支付完成时旧周期已结束：结束旧行，按新周期重新起算。
		if err := closeMembershipTx(tx, membership.ID, now); err != nil {
			return err
		}
		membership = &model.UserMembership{
			ID: newRepositoryID(), UserID: order.UserID, PlanID: order.MembershipPlanID,
			Status: model.MembershipStatusActive, PeriodStart: now,
			PeriodEnd: now.AddDate(0, order.MembershipMonths, 0), Note: "在线续费",
		}
		if err := tx.Create(membership).Error; err != nil {
			return err
		}
		return grantDueMembershipWindowsTx(tx, membership, order.MembershipMonthlyGrantMicrocredits)

	case model.MembershipChangeUpgrade:
		if membership == nil || !membership.PeriodEnd.After(now) || membership.PlanID != order.MembershipPreviousPlanID {
			return ErrPaymentOrderStateConflict
		}
		membership.PlanID = order.MembershipPlanID
		if err := tx.Model(&model.UserMembership{}).Where("id = ?", membership.ID).Update("plan_id", membership.PlanID).Error; err != nil {
			return err
		}
		if order.MembershipCreditDiffMicrocredits > 0 {
			expiresAt, err := membershipPoolExpiryTx(tx, membership)
			if err != nil {
				return err
			}
			referenceKey := "membership-upgrade:" + membership.ID + ":" + order.ID
			note := fmt.Sprintf("会员升级补差：%s → %s", order.MembershipPreviousPlanName, order.MembershipPlanName)
			if _, _, err := grantMembershipCreditsTx(tx, order.UserID, order.MembershipCreditDiffMicrocredits, expiresAt,
				model.CreditLedgerMembershipUpgradeDiff, referenceKey, note); err != nil {
				return err
			}
		}
		return nil

	default:
		return ErrPaymentOrderStateConflict
	}
}

func membershipPlanForPaymentTx(tx *gorm.DB, planID string) (*model.MembershipPlan, error) {
	var plan model.MembershipPlan
	if err := tx.First(&plan, "id = ?", planID).Error; err != nil {
		return nil, err
	}
	return &plan, nil
}

// lockOpenMembershipTx 锁定用户的 active 订阅（不按 period_end 过滤）：
// 过期后旧行仍是 active，必须先结束它才能创建新周期，否则会撞 partial unique index。
func lockOpenMembershipTx(tx *gorm.DB, userID string) (*model.UserMembership, error) {
	var membership model.UserMembership
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("user_id = ? AND status = ?", userID, model.MembershipStatusActive).
		First(&membership).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &membership, nil
}

func closeMembershipTx(tx *gorm.DB, id string, now time.Time) error {
	result := tx.Model(&model.UserMembership{}).
		Where("id = ? AND status = ?", id, model.MembershipStatusActive).
		Updates(map[string]any{"status": model.MembershipStatusCancelled, "updated_at": now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrPaymentOrderStateConflict
	}
	return nil
}

func updateMembershipPeriodTx(tx *gorm.DB, membership *model.UserMembership) error {
	result := tx.Model(&model.UserMembership{}).
		Where("id = ? AND status = ?", membership.ID, model.MembershipStatusActive).
		Updates(map[string]any{
			"plan_id": membership.PlanID, "period_start": membership.PeriodStart,
			"period_end": membership.PeriodEnd, "granted_months": membership.GrantedMonths,
			"updated_at": time.Now(),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrPaymentOrderStateConflict
	}
	return nil
}

// grantDueMembershipWindowsTx 按共享的 30 天锚点规则补发窗口；额度取订单快照，referenceKey 幂等。
func grantDueMembershipWindowsTx(tx *gorm.DB, membership *model.UserMembership, monthlyGrantMicrocredits int64) error {
	for _, window := range model.MembershipDueWindows(membership.PeriodStart, membership.PeriodEnd, membership.GrantedMonths, time.Now()) {
		referenceKey := fmt.Sprintf("membership-grant:%s:%d", membership.ID, window.Index)
		note := fmt.Sprintf("会员积分发放（第 %d 个 30 天窗口）", window.Index)
		if _, _, err := grantMembershipCreditsTx(tx, membership.UserID, monthlyGrantMicrocredits, window.End,
			model.CreditLedgerMembershipGrant, referenceKey, note); err != nil {
			return err
		}
		if err := updateMembershipGrantedMonthsTx(tx, membership.ID, membership.GrantedMonths, window.Index); err != nil {
			return err
		}
		membership.GrantedMonths = window.Index
	}
	return nil
}

func membershipPoolExpiryTx(tx *gorm.DB, membership *model.UserMembership) (time.Time, error) {
	var account model.CreditAccount
	err := tx.First(&account, "user_id = ?", membership.UserID).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return time.Time{}, err
	}
	if err == nil && !account.MembershipExpiresAt.IsZero() && account.MembershipExpiresAt.After(time.Now()) {
		return account.MembershipExpiresAt, nil
	}
	windowEnd := membership.PeriodStart.Add(time.Duration(membership.GrantedMonths) * model.MembershipWindowDays)
	if windowEnd.After(membership.PeriodEnd) {
		windowEnd = membership.PeriodEnd
	}
	return windowEnd, nil
}

// clearExpiredMembershipPoolTx 在发放新窗口前清掉已过期的会员池余额，
// 避免用户到期后立即续费时把上一期已过期积分“复活”。
func clearExpiredMembershipPoolTx(tx *gorm.DB, userID string, now time.Time) error {
	var account model.CreditAccount
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&account, "user_id = ?", userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if account.MembershipMicrocredits <= 0 || account.MembershipExpiresAt.IsZero() || account.MembershipExpiresAt.After(now) {
		return nil
	}
	result := tx.Model(&model.CreditAccount{}).
		Where("user_id = ? AND membership_microcredits = ?", userID, account.MembershipMicrocredits).
		Updates(map[string]any{
			"membership_microcredits": int64(0),
			"version":                 gorm.Expr("version + 1"),
			"updated_at":              now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		var latest model.CreditAccount
		if err := tx.First(&latest, "user_id = ?", userID).Error; err != nil {
			return err
		}
		if latest.MembershipMicrocredits <= 0 || latest.MembershipExpiresAt.IsZero() || latest.MembershipExpiresAt.After(now) {
			return nil
		}
		return ErrPaymentOrderStateConflict
	}
	return tx.Create(&model.CreditLedgerEntry{
		ID:                          newRepositoryID(),
		UserID:                      userID,
		Type:                        model.CreditLedgerMembershipExpireClear,
		AmountMicrocredits:          -account.MembershipMicrocredits,
		MembershipDeltaMicrocredits: -account.MembershipMicrocredits,
		AvailableAfterMicrocredits:  account.AvailableMicrocredits,
		MembershipAfterMicrocredits: 0,
		ReservedAfterMicrocredits:   account.ReservedMicrocredits,
		Note:                        "会员积分池到期清零",
	}).Error
}
