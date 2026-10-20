package app

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/payment"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

type membershipTestProvider struct{}

func (p *membershipTestProvider) Descriptor() payment.Descriptor {
	return payment.Descriptor{
		ID: PaymentProviderWeChat, PluginID: PaymentPluginWeChatNative, PluginVersion: "1.0.0",
		Name: "微信支付", CheckoutMode: "qr_code",
	}
}

func (p *membershipTestProvider) ValidateConfig(payment.Config) error { return nil }

func (p *membershipTestProvider) CreateOrder(_ context.Context, _ payment.Config, request payment.CreateRequest) (payment.Checkout, error) {
	return payment.Checkout{Mode: "qr_code", Value: "weixin://pay/" + request.MerchantOrderNo, ExpiresAt: request.ExpiresAt}, nil
}

func (p *membershipTestProvider) QueryOrder(context.Context, payment.Config, payment.QueryRequest) (payment.Result, error) {
	return payment.Result{}, payment.ErrOrderNotFound
}

func (p *membershipTestProvider) CloseOrder(context.Context, payment.Config, payment.CloseRequest) (payment.Result, error) {
	return payment.Result{}, payment.ErrOrderNotFound
}

func (p *membershipTestProvider) VerifyNotification(context.Context, payment.Config, http.Header, []byte) (payment.Notification, error) {
	return payment.Notification{}, errors.New("not implemented")
}

func (p *membershipTestProvider) DownloadTradeBill(context.Context, payment.Config, time.Time) ([]payment.BillRecord, error) {
	return nil, errors.New("not implemented")
}

func newMembershipPurchaseFixture(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db := newMembershipAdminDB(t)
	if err := db.AutoMigrate(&model.PaymentOrder{}, &model.PaymentProviderConfig{}, &model.PluginPlatformState{}); err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	registry, err := payment.NewRegistry(&membershipTestProvider{})
	if err != nil {
		t.Fatal(err)
	}
	svc.paymentRegistry = registry
	if err := db.Create(&model.PluginPlatformState{PluginID: PaymentPluginWeChatNative, Available: true}).Error; err != nil {
		t.Fatal(err)
	}
	cipher, err := svc.encryptSettingSecret(`{"publicBaseUrl":"https://pay.example.com"}`)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.PaymentProviderConfig{
		ID: "cfg-1", ProviderID: PaymentProviderWeChat, PluginID: PaymentPluginWeChatNative,
		PluginVersion: "1.0.0", Version: 1, Enabled: true, CloseAfterMinutes: 30,
		ConfigCipher: cipher, ConfigDigest: "digest",
	}).Error; err != nil {
		t.Fatal(err)
	}
	return svc, db
}

func createMembershipTestPlan(t *testing.T, svc *Service, name string, level int, monthlyCredits, monthPrice, quarterPrice, yearPrice int64) *model.MembershipPlan {
	t.Helper()
	plan, err := svc.AdminSaveMembershipPlan(adminActor(), AdminMembershipPlanRequest{
		Name: name, Level: level, Enabled: true, MonthlyGrantMicrocredits: monthlyCredits,
		MonthPriceFen: monthPrice, QuarterPriceFen: quarterPrice, YearPriceFen: yearPrice,
	})
	if err != nil {
		t.Fatal(err)
	}
	return plan
}

func createActiveMembership(t *testing.T, db *gorm.DB, userID, planID string, periodEnd time.Time) *model.UserMembership {
	t.Helper()
	membership := &model.UserMembership{
		ID: "membership-" + userID, UserID: userID, PlanID: planID, Status: model.MembershipStatusActive,
		PeriodStart: time.Now().AddDate(0, 0, -20), PeriodEnd: periodEnd, GrantedMonths: 1,
	}
	if err := db.Create(membership).Error; err != nil {
		t.Fatal(err)
	}
	return membership
}

func TestCreateMembershipOrderNewPurchase(t *testing.T) {
	svc, db := newMembershipPurchaseFixture(t)
	plan := createMembershipTestPlan(t, svc, "1级会员", 1, 950*CreditScale, 8800, 21900, 78000)

	order, err := svc.CreateMembershipOrder(context.Background(), &model.User{ID: "user-1"}, CreateMembershipOrderRequest{
		PlanID: plan.ID, Months: 3, ProviderID: PaymentProviderWeChat, IdempotencyKey: "idem-new",
	})
	if err != nil {
		t.Fatal(err)
	}
	if order.Kind != model.PaymentOrderKindMembership || order.MembershipChange != model.MembershipChangeNew {
		t.Fatalf("order kind/change = %s/%s", order.Kind, order.MembershipChange)
	}
	if order.AmountFen != 21900 || order.MembershipMonths != 3 || order.CreditsMicrocredits != 0 {
		t.Fatalf("order amount/months/credits = %d/%d/%d", order.AmountFen, order.MembershipMonths, order.CreditsMicrocredits)
	}
	if order.MembershipPlanID != plan.ID || order.MembershipLevel != 1 {
		t.Fatalf("order plan snapshot = %+v", order)
	}
	if order.Status != model.PaymentOrderPending || order.Checkout.Mode != "qr_code" || order.Checkout.Value == "" {
		t.Fatalf("order status/checkout = %s/%+v", order.Status, order.Checkout)
	}
	var saved model.PaymentOrder
	if err := db.First(&saved, "id = ?", order.ID).Error; err != nil {
		t.Fatal(err)
	}
	if saved.Kind != model.PaymentOrderKindMembership || saved.MembershipMonths != 3 || saved.AmountFen != 21900 {
		t.Fatalf("persisted order = %+v", saved)
	}
}

func TestCreateMembershipOrderRenewal(t *testing.T) {
	svc, db := newMembershipPurchaseFixture(t)
	plan := createMembershipTestPlan(t, svc, "1级会员", 1, 950*CreditScale, 8800, 21900, 78000)
	createActiveMembership(t, db, "user-1", plan.ID, time.Now().AddDate(0, 0, 20))

	order, err := svc.CreateMembershipOrder(context.Background(), &model.User{ID: "user-1"}, CreateMembershipOrderRequest{
		PlanID: plan.ID, Months: 1, ProviderID: PaymentProviderWeChat, IdempotencyKey: "idem-renew",
	})
	if err != nil {
		t.Fatal(err)
	}
	if order.MembershipChange != model.MembershipChangeRenew || order.AmountFen != 8800 || order.MembershipMonths != 1 {
		t.Fatalf("renew order = %+v", order)
	}
}

func TestCreateMembershipOrderUpgradeChargesRemainingPeriodDiff(t *testing.T) {
	svc, db := newMembershipPurchaseFixture(t)
	oldPlan := createMembershipTestPlan(t, svc, "1级会员", 1, 950*CreditScale, 8800, 21900, 78000)
	newPlan := createMembershipTestPlan(t, svc, "2级会员", 2, 2080*CreditScale, 19800, 49900, 180000)
	// 剩余 10 天（向上取整）：(19800-8800)*10/30 = 3666.67 -> 3667 分。
	createActiveMembership(t, db, "user-1", oldPlan.ID, time.Now().Add(10*24*time.Hour-time.Minute))

	order, err := svc.CreateMembershipOrder(context.Background(), &model.User{ID: "user-1"}, CreateMembershipOrderRequest{
		PlanID: newPlan.ID, Months: 1, ProviderID: PaymentProviderWeChat, IdempotencyKey: "idem-upgrade",
	})
	if err != nil {
		t.Fatal(err)
	}
	if order.MembershipChange != model.MembershipChangeUpgrade || order.MembershipMonths != 0 {
		t.Fatalf("upgrade change/months = %s/%d", order.MembershipChange, order.MembershipMonths)
	}
	if order.MembershipRemainingDays != 10 || order.AmountFen != 3667 {
		t.Fatalf("upgrade days/amount = %d/%d", order.MembershipRemainingDays, order.AmountFen)
	}
	if order.MembershipPreviousPlanID != oldPlan.ID || order.MembershipCreditDiffMicrocredits != (2080-950)*CreditScale {
		t.Fatalf("upgrade snapshot = %+v", order)
	}
}

func TestCreateMembershipOrderRejectsDowngrade(t *testing.T) {
	svc, db := newMembershipPurchaseFixture(t)
	lower := createMembershipTestPlan(t, svc, "1级会员", 1, 950*CreditScale, 8800, 21900, 78000)
	higher := createMembershipTestPlan(t, svc, "2级会员", 2, 2080*CreditScale, 19800, 49900, 180000)
	createActiveMembership(t, db, "user-1", higher.ID, time.Now().AddDate(0, 0, 20))

	if _, err := svc.CreateMembershipOrder(context.Background(), &model.User{ID: "user-1"}, CreateMembershipOrderRequest{
		PlanID: lower.ID, Months: 1, ProviderID: PaymentProviderWeChat, IdempotencyKey: "idem-downgrade",
	}); err == nil {
		t.Fatal("downgrade must be rejected")
	}
}

func TestCreateMembershipOrderRejectsSecondPendingMembershipOrder(t *testing.T) {
	svc, _ := newMembershipPurchaseFixture(t)
	plan := createMembershipTestPlan(t, svc, "1级会员", 1, 950*CreditScale, 8800, 21900, 78000)
	if _, err := svc.CreateMembershipOrder(context.Background(), &model.User{ID: "user-1"}, CreateMembershipOrderRequest{
		PlanID: plan.ID, Months: 1, ProviderID: PaymentProviderWeChat, IdempotencyKey: "idem-first",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateMembershipOrder(context.Background(), &model.User{ID: "user-1"}, CreateMembershipOrderRequest{
		PlanID: plan.ID, Months: 1, ProviderID: PaymentProviderWeChat, IdempotencyKey: "idem-second",
	}); err == nil {
		t.Fatal("second pending membership order must be rejected")
	}
}

func TestActiveMembershipOrderResumesPendingOrder(t *testing.T) {
	svc, _ := newMembershipPurchaseFixture(t)
	plan := createMembershipTestPlan(t, svc, "1级会员", 1, 950*CreditScale, 8800, 21900, 78000)
	created, err := svc.CreateMembershipOrder(context.Background(), &model.User{ID: "user-1"}, CreateMembershipOrderRequest{
		PlanID: plan.ID, Months: 1, ProviderID: PaymentProviderWeChat, IdempotencyKey: "idem-active",
	})
	if err != nil {
		t.Fatal(err)
	}
	active, err := svc.ActiveMembershipOrder(&model.User{ID: "user-1"})
	if err != nil {
		t.Fatal(err)
	}
	if active == nil || active.ID != created.ID {
		t.Fatalf("active order = %+v, want %s", active, created.ID)
	}
	if active, err := svc.ActiveMembershipOrder(&model.User{ID: "user-2"}); err != nil || active != nil {
		t.Fatalf("other user active order = %+v, err = %v", active, err)
	}
}

func TestCreateMembershipOrderRejectsUnpricedDuration(t *testing.T) {
	svc, _ := newMembershipPurchaseFixture(t)
	plan := createMembershipTestPlan(t, svc, "1级会员", 1, 950*CreditScale, 8800, 0, 0)

	if _, err := svc.CreateMembershipOrder(context.Background(), &model.User{ID: "user-1"}, CreateMembershipOrderRequest{
		PlanID: plan.ID, Months: 3, ProviderID: PaymentProviderWeChat, IdempotencyKey: "idem-unpriced",
	}); err == nil {
		t.Fatal("unpriced duration must be rejected")
	}
}

func TestCreateMembershipOrderRejectsUnknownProvider(t *testing.T) {
	svc, _ := newMembershipPurchaseFixture(t)
	plan := createMembershipTestPlan(t, svc, "1级会员", 1, 950*CreditScale, 8800, 21900, 78000)

	if _, err := svc.CreateMembershipOrder(context.Background(), &model.User{ID: "user-1"}, CreateMembershipOrderRequest{
		PlanID: plan.ID, Months: 1, ProviderID: "unknown", IdempotencyKey: "idem-provider",
	}); err == nil {
		t.Fatal("unknown provider must be rejected")
	}
}

func TestPaymentReturnPathRoutesMembershipOrders(t *testing.T) {
	svc, db := newMembershipPurchaseFixture(t)
	orders := []model.PaymentOrder{
		{ID: "po-member", UserID: "user-1", IdempotencyKey: "ret-member", MerchantOrderNo: "merchant-member", Kind: model.PaymentOrderKindMembership, Status: model.PaymentOrderPending, ExpiresAt: time.Now().Add(time.Hour)},
		{ID: "po-topup", UserID: "user-1", IdempotencyKey: "ret-topup", MerchantOrderNo: "merchant-topup", Kind: model.PaymentOrderKindTopup, Status: model.PaymentOrderPending, ExpiresAt: time.Now().Add(time.Hour)},
	}
	if err := db.Create(&orders).Error; err != nil {
		t.Fatal(err)
	}
	if got := svc.PaymentReturnPath("po-member"); got != "/membership?paymentOrder=po-member" {
		t.Fatalf("membership return path = %q", got)
	}
	if got := svc.PaymentReturnPath("po-topup"); got != "/wallet?paymentOrder=po-topup" {
		t.Fatalf("topup return path = %q", got)
	}
	if got := svc.PaymentReturnPath("missing"); got != "/wallet?payment=invalid" {
		t.Fatalf("missing return path = %q", got)
	}
}

func TestUserMembershipPlansExposePricesAndUpgradeQuotes(t *testing.T) {
	svc, db := newMembershipPurchaseFixture(t)
	lower := createMembershipTestPlan(t, svc, "1级会员", 1, 950*CreditScale, 8800, 21900, 78000)
	higher := createMembershipTestPlan(t, svc, "2级会员", 2, 2080*CreditScale, 19800, 49900, 180000)
	createActiveMembership(t, db, "user-1", lower.ID, time.Now().Add(30*24*time.Hour-time.Minute))

	result, err := svc.UserMembershipPlans("user-1")
	if err != nil {
		t.Fatal(err)
	}
	if !result.PaymentAvailable {
		t.Fatal("payment should be available")
	}
	if len(result.Plans) != 2 || result.Plans[0].MonthPriceFen != 8800 || result.Plans[1].YearPriceFen != 180000 {
		t.Fatalf("plans = %+v", result.Plans)
	}
	quote, ok := result.UpgradeQuotes[higher.ID]
	if !ok || !quote.CanUpgrade || quote.RemainingDays != 30 || quote.AmountFen != 11000 {
		t.Fatalf("upgrade quote = %+v", quote)
	}
	if _, exists := result.UpgradeQuotes[lower.ID]; exists {
		t.Fatal("current plan must not have an upgrade quote")
	}
}

func TestUserMembershipPlansReportsPaymentUnavailable(t *testing.T) {
	svc, db := newMembershipPurchaseFixture(t)
	createMembershipTestPlan(t, svc, "1级会员", 1, 950*CreditScale, 8800, 21900, 78000)
	if err := db.Where("id = ?", "cfg-1").Delete(&model.PaymentProviderConfig{}).Error; err != nil {
		t.Fatal(err)
	}

	result, err := svc.UserMembershipPlans("user-1")
	if err != nil {
		t.Fatal(err)
	}
	if result.PaymentAvailable {
		t.Fatal("payment must be unavailable without a configured provider")
	}
}
