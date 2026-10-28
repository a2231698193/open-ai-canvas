import { Button } from "antd";
import { Check, Crown, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { MembershipCurrentStrip, MembershipPlanCards, useMembershipPlans } from "@/components/membership/membership-plan-cards";
import { useMembershipPurchase } from "@/components/membership/use-membership-purchase";
import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/layout/workspace-state";
import { CreditStorePanel } from "@/components/payment/credit-store-panel";
import { usePaymentOrderFlow } from "@/components/payment/use-payment-order-flow";
import { formatCredits } from "@/constant/credits";
import { normalizeCreditStoreAmount } from "@/lib/credit-store";
import { cn } from "@/lib/utils";
import type { MembershipPlan } from "@/services/api/membership";
import { listPaymentProviders, listTopupProducts, type CreditStorePolicy, type PaymentProvider } from "@/services/api/payments";
import { useUserStore } from "@/stores/use-user-store";

export default function MembershipPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const paymentOrderId = searchParams.get("paymentOrder") || "";
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const { data, loading, loadError, reload } = useMembershipPlans(true);
    const { onPurchase, purchaseModals } = useMembershipPurchase(data, reload, paymentOrderId);
    const plans = data?.plans || [];

    const [creditStore, setCreditStore] = useState<CreditStorePolicy | null>(null);
    const [creditStoreLoading, setCreditStoreLoading] = useState(true);
    const [creditAmount, setCreditAmount] = useState(500);
    const [providers, setProviders] = useState<PaymentProvider[]>([]);
    const [selectedProviderId, setSelectedProviderId] = useState("");
    const payment = usePaymentOrderFlow({
        onGranted: () => {
            window.dispatchEvent(new CustomEvent("wallet:updated"));
        },
    });

    useEffect(() => {
        if (!creditsEnabled) {
            setCreditStoreLoading(false);
            return;
        }
        let active = true;
        setCreditStoreLoading(true);
        Promise.all([listTopupProducts(), listPaymentProviders()])
            .then(([productResult, providerResult]) => {
                if (!active) return;
                const usableProviders = providerResult.providers.filter((item) => item.enabled && item.pluginEnabled && item.configured);
                setCreditStore(productResult.creditStore);
                setCreditAmount((current) => normalizeCreditStoreAmount(productResult.creditStore, current));
                setProviders(usableProviders);
                setSelectedProviderId((current) => current || usableProviders[0]?.id || "");
            })
            .catch(() => {
                // 支付配置读取失败时保留会员方案，积分超市展示不可用提示。
            })
            .finally(() => {
                if (active) setCreditStoreLoading(false);
            });
        return () => {
            active = false;
        };
    }, [creditsEnabled]);

    useEffect(() => {
        payment.resetIdempotency();
    }, [creditAmount, selectedProviderId]);

    useEffect(() => {
        if (!paymentOrderId) return;
        const next = new URLSearchParams(searchParams);
        next.delete("paymentOrder");
        setSearchParams(next, { replace: true });
    }, [paymentOrderId, searchParams, setSearchParams]);

    const startCreditPayment = async () => {
        if (!creditStore || !selectedProviderId) return;
        await payment.startCredit(normalizeCreditStoreAmount(creditStore, creditAmount), selectedProviderId);
    };

    return (
        <WorkspacePage>
            <PageHeader
                title="会员中心"
                description="购买积分按量使用，或开通会员获得每月专属积分、并发与存储权益。"
                actions={
                    <Button icon={<RefreshCw />} loading={loading} onClick={() => void reload()}>
                        刷新
                    </Button>
                }
            />

            {loading && !data ? (
                <WorkspaceLoadingState label="正在加载会员方案" detail="读取后台配置的等级与权益" rows={4} />
            ) : loadError ? (
                <WorkspaceErrorState title="会员方案加载失败" description={loadError} onRetry={() => void reload()} />
            ) : (
                <div className="membership-hub">
                    {creditsEnabled ? (
                        <section className="membership-hub-block" aria-label="积分超市">
                            <CreditStorePanel
                                loading={creditStoreLoading}
                                policy={creditStore}
                                credits={creditAmount}
                                onCreditsChange={setCreditAmount}
                                providers={providers}
                                selectedProviderId={selectedProviderId}
                                onSelectProvider={setSelectedProviderId}
                                creating={payment.creating}
                                onPay={() => void startCreditPayment()}
                            />
                        </section>
                    ) : null}

                    <section className="membership-hub-block" aria-label="当前会员">
                        <header className="membership-hub-heading">
                            <div>
                                <span className="membership-hub-kicker">
                                    <Crown />
                                    会员订阅
                                </span>
                                <h2>选择适合你的会员方案</h2>
                                <p>会员积分每月到账、当期未用完清零；生成扣费优先使用会员积分，不足时再扣通用积分。</p>
                            </div>
                            {data?.effective.active ? (
                                <span className="membership-hub-current">
                                    <Sparkles />
                                    当前 {data.effective.planName || "会员"} · {formatCredits(data.effective.monthlyGrantMicrocredits)} 积分/月
                                </span>
                            ) : null}
                        </header>
                        <MembershipCurrentStrip effective={data?.effective} membership={data?.membership} />
                        {plans.length ? (
                            <MembershipPlanCards plans={plans} effective={data?.effective} upgradeQuotes={data?.upgradeQuotes} onPurchase={onPurchase} />
                        ) : (
                            <WorkspaceErrorState title="暂无可选会员方案" description="管理员还没有配置启用中的会员等级，请稍后再来。" />
                        )}
                    </section>

                    {plans.length ? <MembershipBenefitComparison plans={plans} currentPlanId={data?.effective.active ? data.effective.planId : undefined} /> : null}

                    <p className="membership-footnote">支持在线开通、续费与升级；升级按剩余周期补差、到期日不变。支付渠道未开通时请联系管理员办理。会员积分在有效期内有效，到期未用完会自动清零并记录台账；通用积分（充值、兑换、签到）不受影响。</p>
                </div>
            )}

            {purchaseModals}
            {payment.dialog}
        </WorkspacePage>
    );
}

function MembershipBenefitComparison({ plans, currentPlanId }: { plans: MembershipPlan[]; currentPlanId?: string }) {
    const rows = [
        { key: "credits", label: "每月到账积分", value: (plan: MembershipPlan) => `${formatCredits(plan.monthlyGrantMicrocredits)} 积分` },
        { key: "concurrency", label: "并发生成任务", value: (plan: MembershipPlan) => (plan.activeTaskLimit < 0 ? "不限" : plan.activeTaskLimit === 0 ? "平台默认" : `${plan.activeTaskLimit} 个`) },
        { key: "storage", label: "云存储空间", value: (plan: MembershipPlan) => (plan.storageGB < 0 ? "不限" : plan.storageGB === 0 ? "平台默认" : `${plan.storageGB}GB`) },
        { key: "upload", label: "每日上传", value: (plan: MembershipPlan) => (plan.dailyUploadMB < 0 ? "不限" : plan.dailyUploadMB === 0 ? "平台默认" : formatUploadSize(plan.dailyUploadMB)) },
    ];
    return (
        <section className="membership-hub-block" aria-label="会员权益对比">
            <header className="membership-hub-heading">
                <div>
                    <span className="membership-hub-kicker">
                        <Check />
                        权益对比
                    </span>
                    <h2>各档权益一览</h2>
                    <p>仅展示当前已生效的会员权益字段，完整价格以结算时为准。</p>
                </div>
            </header>
            <div className="membership-compare-scroll">
                <table className="membership-compare">
                    <thead>
                        <tr>
                            <th scope="col">权益</th>
                            {plans.map((plan) => (
                                <th key={plan.id} scope="col" className={cn(plan.id === currentPlanId && "is-current")}>
                                    {plan.name}
                                    {plan.id === currentPlanId ? <span>当前</span> : null}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.key}>
                                <th scope="row">{row.label}</th>
                                {plans.map((plan) => (
                                    <td key={plan.id} className={cn(plan.id === currentPlanId && "is-current")}>
                                        {row.value(plan)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function formatUploadSize(mb: number) {
    return mb % 1024 === 0 ? `${mb / 1024}GB` : `${mb}MB`;
}
