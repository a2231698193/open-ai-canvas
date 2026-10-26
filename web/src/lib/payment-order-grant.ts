import { formatCredits } from "@/constant/credits";
import { formatStorageCapacity, formatStorageDuration } from "@/lib/account-storage-usage";
import type { PaymentOrder } from "@/services/api/payments";

/** 订单发放的权益描述：积分数量、扩容容量与有效期，或会员权益。 */
export function paymentOrderGrantLabel(order: Pick<PaymentOrder, "kind" | "productKind" | "creditsMicrocredits" | "storageBytes" | "storageDurationDays" | "membershipPlanName" | "membershipMonths">) {
    if (order.kind === "membership") return [order.membershipPlanName || "会员", order.membershipMonths ? `${order.membershipMonths} 个月` : ""].filter(Boolean).join(" · ");
    if (order.productKind === "storage") return `${formatStorageCapacity(order.storageBytes || 0)} 存储空间 · ${formatStorageDuration(order.storageDurationDays || 0)}`;
    return `${formatCredits(order.creditsMicrocredits, 6)} 积分`;
}
