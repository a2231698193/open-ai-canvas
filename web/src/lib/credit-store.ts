import type { CreditStorePolicy } from "@/services/api/payments";

const CREDIT_STORE_QUICK_AMOUNTS = [100, 500, 1_000, 3_000, 5_000, 10_000];

export type CreditStoreQuote = {
    credits: number;
    unitPriceFen: number;
    originalAmountFen: number;
    discountBasisPoints: number;
    amountFen: number;
};

export function creditStoreDiscountBasisPoints(policy: CreditStorePolicy, credits: number) {
    return policy.discounts.reduce((best, tier) => (credits >= tier.minCredits && tier.basisPoints > best ? tier.basisPoints : best), 0);
}

/** 与后端同一套规则：折扣后金额按分四舍五入。 */
export function quoteCreditStore(policy: CreditStorePolicy, credits: number): CreditStoreQuote {
    const discountBasisPoints = creditStoreDiscountBasisPoints(policy, credits);
    const originalAmountFen = credits * policy.unitPriceFen;
    const amountFen = Math.round((originalAmountFen * (10_000 - discountBasisPoints)) / 10_000);
    return { credits, unitPriceFen: policy.unitPriceFen, originalAmountFen, discountBasisPoints, amountFen };
}

export function normalizeCreditStoreAmount(policy: CreditStorePolicy, value: number | null | undefined) {
    if (value === null || value === undefined || !Number.isFinite(value)) return policy.minCredits;
    const step = policy.step > 0 ? policy.step : 100;
    const clamped = Math.min(policy.maxCredits, Math.max(policy.minCredits, Math.round(value)));
    return Math.round(clamped / step) * step;
}

export function creditStoreQuickAmounts(policy: CreditStorePolicy) {
    const step = policy.step > 0 ? policy.step : 100;
    return CREDIT_STORE_QUICK_AMOUNTS.filter((amount) => amount >= policy.minCredits && amount <= policy.maxCredits && amount % step === 0);
}

export function formatCreditStorePrice(fen: number, options: { trimZero?: boolean } = {}) {
    const value = fen / 100;
    const digits = options.trimZero && Number.isInteger(value) ? 0 : 2;
    return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function creditStoreDiscountLabel(basisPoints: number) {
    if (basisPoints <= 0) return "";
    const rate = (10_000 - basisPoints) / 1_000;
    return `${Number.isInteger(rate) ? rate : rate.toFixed(1)} 折`;
}
