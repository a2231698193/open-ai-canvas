import { useCallback, useEffect, useState } from "react";

import { getActiveMembershipOrder, type MembershipPlan } from "@/services/api/membership";
import { MembershipCheckoutModal, type MembershipCheckoutTarget } from "./membership-checkout-modal";
import { MembershipContactModal, type MembershipPlansData } from "./membership-plan-cards";

/** 会员购买状态：有支付渠道走收银台，否则回退到联系管理员。 */
export function useMembershipPurchase(data: MembershipPlansData | null, reload: () => Promise<void> | void, pendingOrderId?: string) {
    const [checkout, setCheckout] = useState<MembershipCheckoutTarget | null>(null);
    const [pendingOrder, setPendingOrder] = useState("");
    const [contactPlan, setContactPlan] = useState<MembershipPlan | null>(null);
    const [contactMessage, setContactMessage] = useState("");

    useEffect(() => {
        if (pendingOrderId) setPendingOrder(pendingOrderId);
    }, [pendingOrderId]);

    const onPurchase = useCallback(
        async (plan: MembershipPlan, months: number) => {
            if (!data?.paymentAvailable) {
                setContactMessage("暂时不支持在线购买，请联系管理员开通。");
                setContactPlan(plan);
                return;
            }
            try {
                const { order } = await getActiveMembershipOrder();
                if (order) {
                    setPendingOrder(order.id);
                    return;
                }
            } catch {
                // 读取失败时继续创建新订单，由服务端未完成订单校验兜底。
            }
            setCheckout({ plan, months });
        },
        [data?.paymentAvailable],
    );

    const onPaid = useCallback(async () => {
        await reload();
    }, [reload]);

    const purchaseModals = (
        <>
            <MembershipCheckoutModal
                target={checkout}
                pendingOrderId={pendingOrder || undefined}
                onClose={() => {
                    setCheckout(null);
                    setPendingOrder("");
                }}
                onPaid={onPaid}
            />
            <MembershipContactModal
                plan={contactPlan}
                membership={data?.membership}
                open={Boolean(contactPlan)}
                message={contactMessage}
                onCancel={() => {
                    setContactPlan(null);
                    setContactMessage("");
                }}
            />
        </>
    );

    return { onPurchase, purchaseModals };
}
