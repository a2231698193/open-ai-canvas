import { Button, Skeleton } from "antd";
import { ArrowRight, Check, CreditCard, Minus, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router";

import { formatMembershipPrice, membershipDurationPrice, useMembershipPlans } from "@/components/membership/membership-plan-cards";
import { useMembershipPurchase } from "@/components/membership/use-membership-purchase";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/layout/workspace-state";
import { usePaymentOrderFlow } from "@/components/payment/use-payment-order-flow";
import { formatCredits } from "@/constant/credits";
import { creditStoreDiscountLabel, formatCreditStorePrice, normalizeCreditStoreAmount, quoteCreditStore } from "@/lib/credit-store";
import { cn } from "@/lib/utils";
import type { EffectiveMembership, MembershipPlan, MembershipUpgradeQuote } from "@/services/api/membership";
import { listPaymentProviders, listTopupProducts, type CreditStorePolicy, type PaymentProvider } from "@/services/api/payments";
import { useUserStore } from "@/stores/use-user-store";
import "./membership-center.css";

const DURATIONS = [
    { months: 1, label: "月卡", unit: "月" },
    { months: 3, label: "季卡", unit: "季" },
    { months: 12, label: "年卡", unit: "年" },
] as const;
const CREDIT_PRESETS = [500, 1_000, 3_000, 5_000, 10_000];

export default function MembershipPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const paymentOrderId = searchParams.get("paymentOrder") || "";
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const { data, loading, loadError, reload } = useMembershipPlans(true);
    const { onPurchase, purchaseModals } = useMembershipPurchase(data, reload, paymentOrderId);
    const plans = useMemo(() => data?.plans || [], [data?.plans]);
    const [duration, setDuration] = useState<(typeof DURATIONS)[number]>(DURATIONS[0]);

    const [creditStore, setCreditStore] = useState<CreditStorePolicy | null>(null);
    const [creditStoreLoading, setCreditStoreLoading] = useState(true);
    const [creditStoreError, setCreditStoreError] = useState("");
    const [creditAmount, setCreditAmount] = useState(1_000);
    const [providers, setProviders] = useState<PaymentProvider[]>([]);
    const [selectedProviderId, setSelectedProviderId] = useState("");
    const payment = usePaymentOrderFlow({
        onGranted: () => {
            window.dispatchEvent(new CustomEvent("wallet:updated"));
        },
    });

    const loadPaymentConfig = useCallback(async () => {
        if (!creditsEnabled) {
            setCreditStoreLoading(false);
            return;
        }
        setCreditStoreLoading(true);
        setCreditStoreError("");
        try {
            const [productResult, providerResult] = await Promise.all([listTopupProducts(), listPaymentProviders()]);
            const usableProviders = providerResult.providers.filter((item) => item.enabled && item.pluginEnabled && item.configured);
            setCreditStore(productResult.creditStore);
            setCreditAmount((current) => normalizeCreditStoreAmount(productResult.creditStore, current));
            setProviders(usableProviders);
            setSelectedProviderId((current) => (usableProviders.some((item) => item.id === current) ? current : usableProviders[0]?.id || ""));
        } catch (error) {
            setCreditStoreError(error instanceof Error ? error.message : "读取积分定价失败");
        } finally {
            setCreditStoreLoading(false);
        }
    }, [creditsEnabled]);

    useEffect(() => {
        void loadPaymentConfig();
    }, [loadPaymentConfig]);

    useEffect(() => {
        payment.resetIdempotency();
    }, [creditAmount, selectedProviderId]);

    useEffect(() => {
        if (!paymentOrderId) return;
        const next = new URLSearchParams(searchParams);
        next.delete("paymentOrder");
        setSearchParams(next, { replace: true });
    }, [paymentOrderId, searchParams, setSearchParams]);

    const quote = useMemo(() => (creditStore ? quoteCreditStore(creditStore, creditAmount) : null), [creditAmount, creditStore]);
    const presets = useMemo(() => (creditStore ? CREDIT_PRESETS.filter((amount) => amount >= creditStore.minCredits && amount <= creditStore.maxCredits) : []), [creditStore]);
    const discountNotes = useMemo(
        () =>
            (creditStore?.discounts || [])
                .slice()
                .sort((left, right) => left.minCredits - right.minCredits)
                .map((tier) => `满 ${tier.minCredits.toLocaleString("zh-CN")} 积分 ${creditStoreDiscountLabel(tier.basisPoints)}`),
        [creditStore],
    );
    const creditPercent = creditStore && creditStore.maxCredits > creditStore.minCredits ? ((creditAmount - creditStore.minCredits) / (creditStore.maxCredits - creditStore.minCredits)) * 100 : 0;
    const ticks = creditStore
        ? Array.from(new Set([creditStore.minCredits, 2_500, 5_000, 7_500, creditStore.maxCredits].filter((value) => value >= creditStore.minCredits && value <= creditStore.maxCredits))).sort((left, right) => left - right)
        : [];

    const startCreditPayment = async () => {
        if (!creditStore || !selectedProviderId) return;
        await payment.startCredit(normalizeCreditStoreAmount(creditStore, creditAmount), selectedProviderId);
    };

    return (
        <WorkspacePage fluid className="membership-page">
            <div className="mc-wrap">
                <header className="mc-head">
                    <div className="mc-eyebrow">MEMBERSHIP · 会员中心</div>
                    <h1>选择你的创作方式</h1>
                    <p>{creditsEnabled ? "积分按需购买、永久有效；会员按月订阅，每月额外赠送积分。" : "会员按月订阅，每月额外赠送积分。"}</p>
                    {data?.effective.active ? (
                        <div className="mc-current-line">
                            当前方案 <b>{data.effective.planName || "会员"}</b>
                            {data.effective.periodEnd ? <span>· {new Date(data.effective.periodEnd).toLocaleDateString("zh-CN")} 前有效</span> : null}
                        </div>
                    ) : null}
                </header>

                {loading && !data ? (
                    <WorkspaceLoadingState label="正在加载会员方案" detail="读取后台配置的等级与权益" rows={4} />
                ) : loadError ? (
                    <WorkspaceErrorState
                        title="会员方案加载失败"
                        description={loadError}
                        actionLabel="重试"
                        onRetry={() => void reload()}
                    />
                ) : (
                    <>
                        {creditsEnabled ? (
                            <section className="mc-points" aria-labelledby="mc-points-title">
                                <div className="mc-sec-head">
                                    <h2 id="mc-points-title">积分购买</h2>
                                    <span>按 100 积分为单位，单次最多 10,000</span>
                                </div>
                                {creditStoreLoading ? (
                                    <div className="mc-panel">
                                        <Skeleton active paragraph={{ rows: 5 }} />
                                    </div>
                                ) : creditStoreError ? (
                                    <div className="mc-panel mc-panel-error">
                                        <div>
                                            <strong>积分购买暂不可用</strong>
                                            <span>{creditStoreError}</span>
                                        </div>
                                        <Button icon={<RefreshCw />} onClick={() => void loadPaymentConfig()}>
                                            重试
                                        </Button>
                                    </div>
                                ) : creditStore && quote ? (
                                    <div className="mc-panel">
                                        <div className="mc-panel-left">
                                            <h3>选择数量</h3>
                                            <p className="mc-panel-sub">积分用于生成图片、视频与音频，也用于调用技能。买得越多，单价越低。</p>
                                            <div className="mc-amount-row">
                                                <button type="button" className="mc-step" aria-label={`减少 ${creditStore.step} 积分`} disabled={creditAmount <= creditStore.minCredits} onClick={() => setCreditAmount(normalizeCreditStoreAmount(creditStore, creditAmount - creditStore.step))}>
                                                    <Minus />
                                                </button>
                                                <div className="mc-amount">
                                                    <b>{creditAmount.toLocaleString("zh-CN")}</b> 积分
                                                </div>
                                                <button type="button" className="mc-step" aria-label={`增加 ${creditStore.step} 积分`} disabled={creditAmount >= creditStore.maxCredits} onClick={() => setCreditAmount(normalizeCreditStoreAmount(creditStore, creditAmount + creditStore.step))}>
                                                    <Plus />
                                                </button>
                                            </div>
                                            <div className="mc-slider-wrap">
                                                <input
                                                    type="range"
                                                    min={creditStore.minCredits}
                                                    max={creditStore.maxCredits}
                                                    step={creditStore.step}
                                                    value={creditAmount}
                                                    aria-label="积分数量"
                                                    style={{ "--mc-pct": `${creditPercent}%` } as CSSProperties}
                                                    onChange={(event) => setCreditAmount(normalizeCreditStoreAmount(creditStore, Number(event.target.value)))}
                                                />
                                                <div className="mc-ticks">
                                                    {ticks.map((tick) => (
                                                        <span key={tick}>{tick.toLocaleString("zh-CN")}</span>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="mc-presets" role="group" aria-label="快捷积分档位">
                                                {presets.map((amount) => (
                                                    <button key={amount} type="button" className={cn("mc-preset", creditAmount === amount && "is-on")} aria-pressed={creditAmount === amount} onClick={() => setCreditAmount(amount)}>
                                                        {amount.toLocaleString("zh-CN")} 积分
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="mc-sum">
                                            <div className="mc-sum-label">应付金额</div>
                                            <div className="mc-sum-price">
                                                <em>¥</em>
                                                <span>{formatFenNumber(quote.amountFen)}</span>
                                            </div>
                                            <div className="mc-orig-row">
                                                {quote.discountBasisPoints > 0 ? (
                                                    <>
                                                        <s>{formatCreditStorePrice(quote.originalAmountFen, { trimZero: true })}</s>
                                                        <span className="mc-save">已省 {formatCreditStorePrice(quote.originalAmountFen - quote.amountFen, { trimZero: true })}</span>
                                                    </>
                                                ) : (
                                                    <span className="mc-save">原价</span>
                                                )}
                                            </div>
                                            <div className="mc-pay-methods" role="radiogroup" aria-label="支付方式">
                                                {providers.length ? (
                                                    providers.map((provider) => (
                                                        <button key={provider.id} type="button" role="radio" aria-checked={selectedProviderId === provider.id} className={cn(selectedProviderId === provider.id && "is-selected")} onClick={() => setSelectedProviderId(provider.id)}>
                                                            <CreditCard />
                                                            {provider.name}
                                                        </button>
                                                    ))
                                                ) : (
                                                    <span className="mc-pay-empty">暂无可用支付渠道，请联系管理员</span>
                                                )}
                                            </div>
                                            <Button className="mc-buy" loading={payment.creating} disabled={!providers.length || !selectedProviderId} onClick={() => void startCreditPayment()}>
                                                立即购买
                                                <ArrowRight />
                                            </Button>
                                            <p className="mc-fine">
                                                单价 {formatCreditStorePrice(creditStore.unitPriceFen, { trimZero: true })} / 积分
                                                {discountNotes.length ? ` · ${discountNotes.join(" · ")}` : ""}
                                                <br />
                                                积分自购买起永久有效，不可退款。
                                            </p>
                                        </div>
                                    </div>
                                ) : null}
                            </section>
                        ) : null}

                        <section className="mc-plans-section" aria-labelledby="mc-plans-title">
                            <div className="mc-sec-head">
                                <h2 id="mc-plans-title">会员订阅</h2>
                                <div className="mc-duration" role="tablist" aria-label="会员时长">
                                    {DURATIONS.map((item) => (
                                        <button key={item.months} type="button" role="tab" aria-selected={duration.months === item.months} className={cn(duration.months === item.months && "is-selected")} onClick={() => setDuration(item)}>
                                            {item.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            {plans.length ? (
                                <MembershipPlanGrid plans={plans} effective={data?.effective} upgradeQuotes={data?.upgradeQuotes} duration={duration} onPurchase={onPurchase} />
                            ) : (
                                <WorkspaceErrorState title="暂无可选会员方案" description="管理员还没有配置启用中的会员等级，请稍后再来。" />
                            )}
                        </section>

                        {plans.length ? <MembershipBenefitComparison plans={plans} effective={data?.effective} duration={duration} /> : null}

                        <p className="mc-footnote">
                            支持在线开通、续费与升级；升级按剩余周期补差、到期日不变。支付渠道未开通时请联系管理员办理。会员积分在有效期内有效，到期未用完会自动清零并记录台账；通用积分（充值、兑换、签到）不受影响。
                        </p>
                    </>
                )}
            </div>

            {purchaseModals}
            {payment.dialog}
        </WorkspacePage>
    );
}

function MembershipPlanGrid({
    plans,
    effective,
    upgradeQuotes,
    duration,
    onPurchase,
}: {
    plans: MembershipPlan[];
    effective?: EffectiveMembership;
    upgradeQuotes?: Record<string, MembershipUpgradeQuote>;
    duration: (typeof DURATIONS)[number];
    onPurchase: (plan: MembershipPlan, months: number) => void;
}) {
    const topPlanId = plans.reduce((best, plan) => (plan.level > best.level ? plan : best), plans[0]).id;
    const active = Boolean(effective?.active);
    const currentPlanId = effective?.active ? effective.planId : undefined;
    const activeLevel = effective?.active ? effective.level : 0;
    return (
        <div className="mc-plans">
            {plans.map((plan) => {
                const current = plan.id === currentPlanId;
                const featured = plan.id === topPlanId && plans.length > 1;
                const isHigher = active && plan.level > activeLevel;
                const isLower = active && plan.level < activeLevel;
                const quote = isHigher ? upgradeQuotes?.[plan.id] : undefined;
                const priceFen = membershipDurationPrice(plan, duration.months);
                const action = planAction({ current, isHigher, isLower, quote, priceFen });
                return (
                    <article key={plan.id} className={cn("mc-plan", featured && "is-rec", current && "is-on")}>
                        {current ? <span className="mc-badge is-current">当前方案</span> : featured ? <span className="mc-badge">推荐方案</span> : null}
                        <div className="mc-plan-name">
                            <h3>{plan.name}</h3>
                            <span>LEVEL {String(plan.level).padStart(2, "0")}</span>
                        </div>
                        <div className="mc-price">
                            <em>¥</em>
                            <b>{priceFen > 0 ? formatFenNumber(priceFen) : "—"}</b>
                            <span>/ {duration.unit}</span>
                        </div>
                        <p className="mc-plan-desc">会员积分每月到账，生成扣费优先抵扣。</p>
                        <ul className="mc-perks">
                            <li>
                                <Check />
                                {plan.monthlyGrantMicrocredits > 0 ? `每月到账 ${formatCredits(plan.monthlyGrantMicrocredits)} 积分` : "不含每月会员积分"}
                            </li>
                            <li>
                                <Check />
                                {concurrencyLabel(plan.activeTaskLimit)}
                            </li>
                            <li>
                                <Check />
                                {storageLabel(plan.storageGB)}
                            </li>
                            {plan.dailyUploadMB !== 0 ? (
                                <li>
                                    <Check />
                                    {dailyUploadLabel(plan.dailyUploadMB)}
                                </li>
                            ) : null}
                        </ul>
                        <button type="button" className="mc-plan-btn" disabled={action.disabled} onClick={() => onPurchase(plan, duration.months)}>
                            {action.label}
                            {!action.disabled ? <ArrowRight /> : null}
                        </button>
                    </article>
                );
            })}
        </div>
    );
}

function MembershipBenefitComparison({ plans, effective, duration }: { plans: MembershipPlan[]; effective?: EffectiveMembership; duration: (typeof DURATIONS)[number] }) {
    const topPlanId = plans.reduce((best, plan) => (plan.level > best.level ? plan : best), plans[0]).id;
    const rows = [
        { key: "credits", label: "每月到账积分", value: (plan: MembershipPlan) => (plan.monthlyGrantMicrocredits > 0 ? `${formatCredits(plan.monthlyGrantMicrocredits)} 积分` : "—") },
        { key: "concurrency", label: "并发生成任务", value: (plan: MembershipPlan) => (plan.activeTaskLimit < 0 ? "不限" : plan.activeTaskLimit === 0 ? "平台默认" : `${plan.activeTaskLimit} 个`) },
        { key: "storage", label: "云存储空间", value: (plan: MembershipPlan) => (plan.storageGB < 0 ? "不限" : plan.storageGB === 0 ? "平台默认" : `${plan.storageGB} GB`) },
        { key: "upload", label: "每日上传", value: (plan: MembershipPlan) => (plan.dailyUploadMB < 0 ? "不限" : plan.dailyUploadMB === 0 ? "平台默认" : formatUploadSize(plan.dailyUploadMB)) },
    ];
    return (
        <section className="mc-compare" aria-labelledby="mc-compare-title">
            <div className="mc-sec-head">
                <h2 id="mc-compare-title">权益对比</h2>
                <span>仅展示后台已配置并生效的权益字段</span>
            </div>
            <div className="mc-table-scroll">
                <table>
                    <thead>
                        <tr>
                            <th scope="col" style={{ width: "26%" }}>
                                权益
                            </th>
                            {plans.map((plan) => {
                                const priceFen = membershipDurationPrice(plan, duration.months);
                                return (
                                    <th key={plan.id} scope="col" className={cn(plan.id === topPlanId && "mc-col-hi", plan.id === effective?.planId && "is-current")}>
                                        <b>{plan.name}</b>
                                        <i>{priceFen > 0 ? `${formatMembershipPrice(priceFen)} / ${duration.unit}` : "待定价"}</i>
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.key}>
                                <th scope="row">{row.label}</th>
                                {plans.map((plan) => (
                                    <td key={plan.id} className={cn(plan.id === topPlanId && "mc-col-hi", plan.id === effective?.planId && "is-current")}>
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

function planAction({ current, isHigher, isLower, quote, priceFen }: { current: boolean; isHigher: boolean; isLower: boolean; quote?: MembershipUpgradeQuote; priceFen: number }) {
    if (isLower) return { disabled: true, label: "暂不支持降级" };
    if (isHigher) {
        if (!quote?.canUpgrade) return { disabled: true, label: quote?.reason || "暂不可在线升级" };
        return { disabled: false, label: `升级补差价 ${formatMembershipPrice(quote.amountFen)}` };
    }
    if (priceFen <= 0) return { disabled: true, label: "暂未定价" };
    return { disabled: false, label: `${current ? "续费" : "立即开通"} ${formatMembershipPrice(priceFen)}` };
}

function concurrencyLabel(limit: number) {
    if (limit < 0) return "不限并发生成任务";
    if (limit === 0) return "并发任务沿用平台默认";
    return `${limit} 个并发生成任务`;
}

function storageLabel(gb: number) {
    if (gb < 0) return "云存储空间不设上限";
    if (gb === 0) return "云存储空间沿用平台默认";
    return `${gb} GB 云存储空间`;
}

function dailyUploadLabel(mb: number) {
    if (mb < 0) return "每日上传不设上限";
    return `每日上传至多 ${formatUploadSize(mb)}`;
}

function formatUploadSize(mb: number) {
    return mb % 1024 === 0 ? `${mb / 1024}GB` : `${mb}MB`;
}

function formatFenNumber(fen: number) {
    return (fen / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}
