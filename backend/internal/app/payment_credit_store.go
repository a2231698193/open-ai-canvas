package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

// 积分超市按 100 积分为一档售卖；单价与折扣只在后端计算，客户端只展示报价。
const (
	creditStoreSettingKey         = "payment_credit_store"
	creditStoreMinCredits   int64 = 100
	creditStoreMaxCredits   int64 = 10_000
	creditStoreStep         int64 = 100
	creditStoreUnitPriceFen int64 = 10
)

type CreditStoreDiscount struct {
	MinCredits  int64 `json:"minCredits"`
	BasisPoints int64 `json:"basisPoints"`
}

type CreditStorePolicy struct {
	MinCredits   int64                 `json:"minCredits"`
	MaxCredits   int64                 `json:"maxCredits"`
	Step         int64                 `json:"step"`
	UnitPriceFen int64                 `json:"unitPriceFen"`
	Discounts    []CreditStoreDiscount `json:"discounts"`
}

type CreditStoreSetting struct {
	UnitPriceFen int64 `json:"unitPriceFen"`
}

func defaultCreditStoreSetting() CreditStoreSetting {
	return CreditStoreSetting{UnitPriceFen: creditStoreUnitPriceFen}
}

func creditStorePolicyFor(setting CreditStoreSetting) CreditStorePolicy {
	unitPrice := setting.UnitPriceFen
	if unitPrice <= 0 {
		unitPrice = creditStoreUnitPriceFen
	}
	return CreditStorePolicy{
		MinCredits:   creditStoreMinCredits,
		MaxCredits:   creditStoreMaxCredits,
		Step:         creditStoreStep,
		UnitPriceFen: unitPrice,
		Discounts: []CreditStoreDiscount{
			{MinCredits: 5_000, BasisPoints: 2_000},
			{MinCredits: 1_000, BasisPoints: 1_000},
		},
	}
}

func (s *Service) creditStoreSetting() (CreditStoreSetting, error) {
	setting, err := s.repo.SystemSetting(creditStoreSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return defaultCreditStoreSetting(), nil
	}
	if err != nil {
		return CreditStoreSetting{}, err
	}
	value := defaultCreditStoreSetting()
	if strings.TrimSpace(setting.ValueJSON) == "" {
		return value, nil
	}
	if err := json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
		return CreditStoreSetting{}, fmt.Errorf("积分超市配置格式错误: %w", err)
	}
	if value.UnitPriceFen <= 0 {
		return defaultCreditStoreSetting(), nil
	}
	return value, nil
}

func (s *Service) CreditStorePolicy() (CreditStorePolicy, error) {
	setting, err := s.creditStoreSetting()
	if err != nil {
		return CreditStorePolicy{}, err
	}
	return creditStorePolicyFor(setting), nil
}

func (s *Service) AdminCreditStoreSetting(actor *model.User) (*CreditStoreSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	setting, err := s.creditStoreSetting()
	if err != nil {
		return nil, err
	}
	return &setting, nil
}

func (s *Service) UpdateCreditStoreSetting(actor *model.User, value CreditStoreSetting) (*CreditStoreSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if value.UnitPriceFen < 1 || value.UnitPriceFen > 100_000 {
		return nil, BadAuthRequest("积分单价必须是 1–100000 分/积分")
	}
	before, err := s.creditStoreSetting()
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	current, err := s.repo.SystemSetting(creditStoreSettingKey)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	setting := &model.SystemSetting{Key: creditStoreSettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	if current != nil {
		setting.CreatedAt = current.CreatedAt
	}
	if err := s.repo.SaveSystemSetting(setting); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "payment_credit_store.update", "system_setting", creditStoreSettingKey, "更新积分超市单价", map[string]any{"before": before, "after": value}); err != nil {
		return nil, err
	}
	return &value, nil
}

type creditStoreQuote struct {
	Credits             int64 `json:"credits"`
	UnitPriceFen        int64 `json:"unitPriceFen"`
	OriginalAmountFen   int64 `json:"originalAmountFen"`
	DiscountBasisPoints int64 `json:"discountBasisPoints"`
	AmountFen           int64 `json:"amountFen"`
}

func quoteCreditStore(policy CreditStorePolicy, credits int64) (creditStoreQuote, error) {
	if credits < creditStoreMinCredits || credits > creditStoreMaxCredits || credits%creditStoreStep != 0 {
		return creditStoreQuote{}, BadAuthRequest(fmt.Sprintf("积分数量必须是 %d 的整数倍，且在 %d–%d 之间", creditStoreStep, creditStoreMinCredits, creditStoreMaxCredits))
	}
	discount := int64(0)
	for _, tier := range policy.Discounts {
		if credits >= tier.MinCredits && tier.BasisPoints > discount {
			discount = tier.BasisPoints
		}
	}
	original := credits * policy.UnitPriceFen
	// 折扣后按分四舍五入，避免客户端自行计算与后端订单金额不一致。
	amount := (original*(10_000-discount) + 5_000) / 10_000
	return creditStoreQuote{
		Credits: credits, UnitPriceFen: policy.UnitPriceFen,
		OriginalAmountFen: original, DiscountBasisPoints: discount, AmountFen: amount,
	}, nil
}
