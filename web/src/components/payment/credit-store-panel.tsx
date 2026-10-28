import { Button, Skeleton } from "antd";
import { CircleAlert, Coins, CreditCard, Minus, Plus, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { creditStoreDiscountLabel, creditStoreQuickAmounts, formatCreditStorePrice, normalizeCreditStoreAmount, quoteCreditStore } from "@/lib/credit-store";
import { cn } from "@/lib/utils";
import type { CreditStorePolicy, PaymentProvider } from "@/services/api/payments";

import "./credit-store-panel.css";

const FALLBACK_POLICY: CreditStorePolicy = { minCredits: 100, maxCredits: 10_000, step: 100, unitPriceFen: 10, discounts: [] };

export function CreditStorePanel({
    loading,
    policy,
    credits,
    onCreditsChange,
    providers,
    selectedProviderId,
    onSelectProvider,
    creating,
    onPay,
}: {
    loading?: boolean;
    policy: CreditStorePolicy | null;
    credits: number;
    onCreditsChange: (credits: number) => void;
    providers: PaymentProvider[];
    selectedProviderId: string;
    onSelectProvider: (id: string) => void;
    creating: boolean;
    onPay: () => void;
}) {
    const activePolicy = policy ?? FALLBACK_POLICY;
    const [draft, setDraft] = useState(String(credits));
    const quote = useMemo(() => quoteCreditStore(activePolicy, credits), [activePolicy, credits]);
    const quickAmounts = useMemo(() => creditStoreQuickAmounts(activePolicy), [activePolicy]);
    const discountTiers = useMemo(() => [...activePolicy.discounts].sort((left, right) => left.minCredits - right.minCredits), [activePolicy.discounts]);
    const step = activePolicy.step > 0 ? activePolicy.step : 100;

    useEffect(() => {
        setDraft(String(credits));
    }, [credits]);

    const applyCredits = (value: number) => {
        const next = normalizeCreditStoreAmount(activePolicy, value);
        setDraft(String(next));
        onCreditsChange(next);
    };

    const commitDraft = () => {
        applyCredits(Number(draft || "0"));
    };

    if (loading) {
        return (
            <section className="credit-store-panel">
                <Skeleton active paragraph={{ rows: 4 }} />
            </section>
        );
    }

    if (!policy) {
        return (
            <section className="credit-store-panel">
                <div className="workspace-wallet-inline-state">
                    <CircleAlert />
                    <div>
                        <strong>积分超市暂不可用</strong>
                        <span>读取积分定价失败，请稍后刷新或联系管理员。</span>
                    </div>
                </div>
            </section>
        );
    }

    const payDisabled = !providers.length || !selectedProviderId || creating;

    return (
        <section className="credit-store-panel" aria-labelledby="credit-store-title">
            <header className="credit-store-head">
                <span className="credit-store-emblem" aria-hidden="true">
                    <Coins />
                </span>
                <div className="credit-store-head-text">
                    <h3 id="credit-store-title">积分超市</h3>
                    <p>100 积分为一档，单次最多 {policy.maxCredits.toLocaleString("zh-CN")} 积分，支付成功后立即到账。</p>
                </div>
                <div className="credit-store-tiers" aria-label="积分折扣">
                    {discountTiers.map((tier) => (
                        <span key={tier.minCredits} className="credit-store-tier">
                            <Sparkles aria-hidden="true" />满 {tier.minCredits.toLocaleString("zh-CN")} 积分 {creditStoreDiscountLabel(tier.basisPoints)}
                        </span>
                    ))}
                </div>
            </header>

            <div className="credit-store-body">
                <div className="credit-store-picker">
                    <span className="credit-store-label">购买积分</span>
                    <div className="credit-store-amount" role="group" aria-label="购买积分数量">
                        <button type="button" aria-label={`减少 ${step} 积分`} disabled={credits <= policy.minCredits} onClick={() => applyCredits(credits - step)}>
                            <Minus />
                        </button>
                        <label className="credit-store-amount-field">
                            <input
                                value={draft}
                                inputMode="numeric"
                                aria-label="积分数量"
                                onChange={(event) => setDraft(event.target.value.replace(/\D/g, "").slice(0, 7))}
                                onBlur={commitDraft}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        event.currentTarget.blur();
                                    }
                                }}
                            />
                            <span>积分</span>
                        </label>
                        <button type="button" aria-label={`增加 ${step} 积分`} disabled={credits >= policy.maxCredits} onClick={() => applyCredits(credits + step)}>
                            <Plus />
                        </button>
                    </div>
                    <div className="credit-store-quick" role="group" aria-label="快捷积分档位">
                        {quickAmounts.map((amount) => (
                            <button key={amount} type="button" aria-pressed={credits === amount} className={cn(credits === amount && "is-selected")} onClick={() => applyCredits(amount)}>
                                {amount.toLocaleString("zh-CN")}
                            </button>
                        ))}
                    </div>
                    <p className="credit-store-unit">
                        单价 {formatCreditStorePrice(policy.unitPriceFen, { trimZero: true })}/积分 · {policy.minCredits}–{policy.maxCredits.toLocaleString("zh-CN")} 积分，按 {step} 递增
                    </p>
                </div>

                <div className="credit-store-quote" aria-live="polite">
                    <span>应付金额</span>
                    <strong>{formatCreditStorePrice(quote.amountFen)}</strong>
                    {quote.discountBasisPoints > 0 ? (
                        <div className="credit-store-quote-discount">
                            <s>{formatCreditStorePrice(quote.originalAmountFen)}</s>
                            <em>已享 {creditStoreDiscountLabel(quote.discountBasisPoints)}</em>
                        </div>
                    ) : (
                        <small>原价，无折扣</small>
                    )}
                    <small>
                        {quote.credits.toLocaleString("zh-CN")} 积分 · {formatCreditStorePrice(policy.unitPriceFen, { trimZero: true })}/积分
                    </small>
                </div>
            </div>

            <footer className="credit-store-checkout">
                {providers.length ? (
                    <div className="workspace-wallet-providers" role="radiogroup" aria-label="支付方式">
                        {providers.map((provider) => (
                            <button key={provider.id} type="button" role="radio" aria-checked={selectedProviderId === provider.id} className={selectedProviderId === provider.id ? "is-selected" : ""} onClick={() => onSelectProvider(provider.id)}>
                                <CreditCard />
                                {provider.name}
                            </button>
                        ))}
                    </div>
                ) : (
                    <span className="credit-store-checkout-hint">暂无可用支付渠道，请联系管理员</span>
                )}
                <Button type="primary" size="large" loading={creating} disabled={payDisabled} onClick={onPay}>
                    立即支付 {formatCreditStorePrice(quote.amountFen)}
                </Button>
            </footer>
        </section>
    );
}
