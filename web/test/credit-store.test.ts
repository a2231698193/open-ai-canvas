import { describe, expect, test } from "bun:test";

import { creditStoreDiscountLabel, creditStoreQuickAmounts, formatCreditStorePrice, normalizeCreditStoreAmount, quoteCreditStore } from "@/lib/credit-store";
import type { CreditStorePolicy } from "@/services/api/payments";

const policy: CreditStorePolicy = {
    minCredits: 100,
    maxCredits: 10_000,
    step: 100,
    unitPriceFen: 10,
    discounts: [
        { minCredits: 5_000, basisPoints: 2_000 },
        { minCredits: 1_000, basisPoints: 1_000 },
    ],
};

describe("credit store", () => {
    test("按后端同一规则计算原价、折扣与应付金额", () => {
        expect(quoteCreditStore(policy, 100)).toMatchObject({ originalAmountFen: 1_000, discountBasisPoints: 0, amountFen: 1_000 });
        expect(quoteCreditStore(policy, 1_000)).toMatchObject({ originalAmountFen: 10_000, discountBasisPoints: 1_000, amountFen: 9_000 });
        expect(quoteCreditStore(policy, 5_000)).toMatchObject({ originalAmountFen: 50_000, discountBasisPoints: 2_000, amountFen: 40_000 });
    });

    test("折扣后金额按分四舍五入", () => {
        const quote = quoteCreditStore({ ...policy, unitPriceFen: 11 }, 1_000);
        expect(quote.originalAmountFen).toBe(11_000);
        expect(quote.amountFen).toBe(9_900);
    });

    test("输入数量按步进取整并限制在区间内", () => {
        expect(normalizeCreditStoreAmount(policy, 149)).toBe(100);
        expect(normalizeCreditStoreAmount(policy, 156)).toBe(200);
        expect(normalizeCreditStoreAmount(policy, 20_000)).toBe(10_000);
        expect(normalizeCreditStoreAmount(policy, null)).toBe(100);
    });

    test("快捷档位只保留后端区间内且符合步进的金额", () => {
        expect(creditStoreQuickAmounts(policy)).toEqual([100, 500, 1_000, 3_000, 5_000, 10_000]);
        expect(creditStoreQuickAmounts({ ...policy, minCredits: 500, maxCredits: 5_000 })).toEqual([500, 1_000, 3_000, 5_000]);
    });

    test("折扣文案与价格格式", () => {
        expect(creditStoreDiscountLabel(1_000)).toBe("9 折");
        expect(creditStoreDiscountLabel(2_000)).toBe("8 折");
        expect(creditStoreDiscountLabel(0)).toBe("");
        expect(formatCreditStorePrice(9_000)).toBe("¥90.00");
        expect(formatCreditStorePrice(10, { trimZero: true })).toBe("¥0.10");
    });
});
