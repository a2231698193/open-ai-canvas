import { App, Button, Skeleton } from "antd";
import { CircleAlert, CreditCard, Crown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { PaymentCheckoutCode } from "@/components/payment-checkout-code";
import { AppModal } from "@/components/ui/product/app-modal";
import { formatCredits } from "@/constant/credits";
import { cn } from "@/lib/utils";
import { createMembershipOrder, type MembershipPlan } from "@/services/api/membership";
import { closePaymentOrder, getPaymentOrder, listPaymentProviders, queryPaymentOrder, refreshPaymentCheckout, type PaymentOrder, type PaymentProvider } from "@/services/api/payments";
import { formatMembershipPrice, membershipDurationLabel, membershipDurationPrice } from "./membership-plan-cards";

export type MembershipCheckoutTarget = { plan: MembershipPlan; months: number };

export function MembershipCheckoutModal({
    target,
    pendingOrderId,
    onClose,
    onPaid,
}: {
    target: MembershipCheckoutTarget | null;
    pendingOrderId?: string;
    onClose: () => void;
    onPaid: () => Promise<void> | void;
}) {
    const { message } = App.useApp();
    const open = Boolean(target) || Boolean(pendingOrderId);
    const [providers, setProviders] = useState<PaymentProvider[]>([]);
    const [providersLoading, setProvidersLoading] = useState(false);
    const [selectedProviderId, setSelectedProviderId] = useState("");
    const [order, setOrder] = useState<PaymentOrder | null>(null);
    const [creating, setCreating] = useState(false);
    const [querying, setQuerying] = useState(false);
    const [clock, setClock] = useState(Date.now());
    const idempotencyKey = useRef("");
    const completedOrderId = useRef("");
    const onPaidRef = useRef(onPaid);
    onPaidRef.current = onPaid;

    const announcePaid = useCallback(async (orderId: string) => {
        if (completedOrderId.current === orderId) return;
        completedOrderId.current = orderId;
        await onPaidRef.current();
        window.dispatchEvent(new CustomEvent("wallet:updated"));
    }, []);

    useEffect(() => {
        if (!open) return;
        setClock(Date.now());
        if (pendingOrderId) {
            setOrder(null);
            getPaymentOrder(pendingOrderId)
                .then(async ({ order: pending }) => {
                    setOrder(pending);
                    if (pending.status === "credited") await announcePaid(pending.id);
                })
                .catch((error) => message.error(error instanceof Error ? error.message : "读取支付结果失败"));
            return;
        }
        if (!target) return;
        setOrder(null);
        idempotencyKey.current = "";
        setProvidersLoading(true);
        listPaymentProviders()
            .then(({ providers: items }) => {
                const available = items.filter((item) => item.enabled && item.pluginEnabled && item.configured);
                setProviders(available);
                setSelectedProviderId(available[0]?.id || "");
            })
            .catch((error) => message.error(error instanceof Error ? error.message : "读取支付方式失败"))
            .finally(() => setProvidersLoading(false));
    }, [open, pendingOrderId, target?.plan.id, target?.months]);

    useEffect(() => {
        if (!open || !order || !["created", "pending", "closing"].includes(order.status)) return;
        const interval = window.setInterval(() => {
            void refreshStatus(order.id, true);
        }, 4_000);
        return () => window.clearInterval(interval);
    }, [open, order?.id, order?.status]);

    useEffect(() => {
        if (!open) return;
        const interval = window.setInterval(() => setClock(Date.now()), 1_000);
        return () => window.clearInterval(interval);
    }, [open]);

    const close = () => {
        setOrder(null);
        setProviders([]);
        setSelectedProviderId("");
        idempotencyKey.current = "";
        onClose();
    };

    const startPayment = async () => {
        if (!target) return;
        const provider = providers.find((item) => item.id === selectedProviderId);
        if (!provider) {
            message.error("请选择支付方式");
            return;
        }
        setCreating(true);
        try {
            if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
            const result = await createMembershipOrder({
                planId: target.plan.id,
                months: target.months,
                providerId: provider.id,
                idempotencyKey: idempotencyKey.current,
            });
            idempotencyKey.current = "";
            setOrder(result.order);
            if (result.order.status === "credited") await announcePaid(result.order.id);
            if (result.order.checkout.mode === "redirect" && result.order.checkout.url) {
                window.location.assign(result.order.checkout.url);
                return;
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "创建支付订单失败");
        } finally {
            setCreating(false);
        }
    };

    async function refreshStatus(orderId = order?.id, silent = false) {
        if (!orderId || querying) return;
        setQuerying(true);
        try {
            const result = await queryPaymentOrder(orderId);
            setOrder(result.order);
            if (result.order.status === "credited") {
                await announcePaid(result.order.id);
                if (!silent) message.success("支付已确认，会员已开通");
            } else if (!silent && result.order.status === "closed") {
                message.warning("订单已关闭，未开通会员");
            } else if (!silent) {
                message.info("渠道尚未确认支付，请稍后再试");
            }
        } catch (error) {
            if (!silent) message.error(error instanceof Error ? error.message : "查询支付结果失败");
        } finally {
            setQuerying(false);
        }
    }

    const cancelPayment = async () => {
        if (!order) return;
        setQuerying(true);
        try {
            const result = await closePaymentOrder(order.id);
            setOrder(result.order);
            if (result.order.status === "credited") await announcePaid(result.order.id);
            else message.success("未支付订单已关闭");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "关闭订单失败");
        } finally {
            setQuerying(false);
        }
    };

    const retryCheckout = async () => {
        if (!order) return;
        setQuerying(true);
        try {
            const result = await refreshPaymentCheckout(order.id);
            setOrder(result.order);
            if (result.order.checkout.mode === "redirect" && result.order.checkout.url) window.location.assign(result.order.checkout.url);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "刷新支付入口失败");
        } finally {
            setQuerying(false);
        }
    };

    const amountFen = target ? membershipDurationPrice(target.plan, target.months) : 0;
    const title = order?.status === "credited" ? "支付完成" : order ? "确认支付" : target ? `开通 ${target.plan.name}` : "开通会员";
    return (
        <AppModal open={open} title={title} centered width={430} onCancel={close} footer={checkoutFooter({ order, target, providersLoading, providers, creating, querying, close, startPayment, cancelPayment, retryCheckout, refreshStatus })}>
            {order ? (
                <div className="membership-checkout">
                    <span className="membership-checkout-icon">
                        <CreditCard />
                    </span>
                    <strong>{formatMembershipPrice(order.amountFen)}</strong>
                    <p>{order.productName}</p>
                    {order.status === "pending" && order.checkout.mode === "qr_code" && order.checkout.value ? (
                        <>
                            <PaymentCheckoutCode value={order.checkout.value} />
                            <span className="membership-checkout-hint">请使用支付应用扫码完成支付</span>
                        </>
                    ) : null}
                    {order.status === "pending" && order.checkout.mode === "redirect" && order.checkout.url ? (
                        <Button type="primary" onClick={() => window.location.assign(order.checkout.url!)}>
                            前往支付页面
                        </Button>
                    ) : null}
                    <MembershipPaymentStatus order={order} now={clock} />
                </div>
            ) : target ? (
                <div className="membership-checkout">
                    <span className="membership-checkout-icon">
                        <Crown />
                    </span>
                    <strong>{formatMembershipPrice(amountFen)}</strong>
                    <p>
                        {target.plan.name} · {membershipDurationLabel(target.months)} · 每月到账 {formatCredits(target.plan.monthlyGrantMicrocredits)} 积分
                    </p>
                    {providersLoading ? (
                        <Skeleton active paragraph={{ rows: 2 }} title={false} />
                    ) : providers.length ? (
                        <div className="membership-checkout-providers" role="radiogroup" aria-label="支付方式">
                            {providers.map((provider) => (
                                <button
                                    key={provider.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={selectedProviderId === provider.id}
                                    className={cn(selectedProviderId === provider.id && "is-selected")}
                                    onClick={() => setSelectedProviderId(provider.id)}
                                >
                                    <CreditCard />
                                    {provider.name}
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="membership-checkout-empty">
                            <CircleAlert />
                            <div>
                                <strong>暂时不支持在线购买</strong>
                                <span>请联系管理员开通会员。</span>
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <Skeleton active paragraph={{ rows: 4 }} />
            )}
        </AppModal>
    );
}

function MembershipPaymentStatus({ order, now }: { order: PaymentOrder; now: number }) {
    if (order.status === "credited") {
        const text = order.membershipChange === "upgrade" ? "会员已升级，权益立即生效" : order.membershipChange === "renew" ? "会员已续费，有效期已顺延" : "会员已开通，权益立即生效";
        return <div className="membership-checkout-status is-success">{text}</div>;
    }
    if (order.status === "closed") return <div className="membership-checkout-status">订单已关闭，未开通会员</div>;
    if (order.status === "create_failed") return <div className="membership-checkout-status is-error">支付入口创建失败，请重新生成支付入口。</div>;
    const remaining = Math.max(0, Math.floor((new Date(order.expiresAt).getTime() - now) / 1000));
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    const seconds = remaining % 60;
    return (
        <div className="membership-checkout-status">
            订单剩余 {String(hours).padStart(2, "0")}:{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}，将自动确认支付结果
        </div>
    );
}

function checkoutFooter({
    order,
    target,
    providersLoading,
    providers,
    creating,
    querying,
    close,
    startPayment,
    cancelPayment,
    retryCheckout,
    refreshStatus,
}: {
    order: PaymentOrder | null;
    target: MembershipCheckoutTarget | null;
    providersLoading: boolean;
    providers: PaymentProvider[];
    creating: boolean;
    querying: boolean;
    close: () => void;
    startPayment: () => Promise<void>;
    cancelPayment: () => Promise<void>;
    retryCheckout: () => Promise<void>;
    refreshStatus: (id?: string, silent?: boolean) => Promise<void>;
}) {
    if (order && ["created", "pending"].includes(order.status)) {
        return [
            <Button key="cancel" danger disabled={querying} onClick={() => void cancelPayment()}>
                关闭订单
            </Button>,
            <Button key="query" type="primary" loading={querying} onClick={() => void refreshStatus()}>
                我已完成支付
            </Button>,
        ];
    }
    if (order?.status === "create_failed") {
        return [
            <Button key="close" danger disabled={querying} onClick={() => void cancelPayment()}>
                关闭订单
            </Button>,
            <Button key="retry" type="primary" loading={querying} onClick={() => void retryCheckout()}>
                重新生成支付入口
            </Button>,
        ];
    }
    if (order) {
        return [
            <Button key="done" type="primary" onClick={close}>
                完成
            </Button>,
        ];
    }
    if (!target) {
        return [
            <Button key="close" onClick={close}>
                关闭
            </Button>,
        ];
    }
    return [
        <Button key="cancel" onClick={close}>
            取消
        </Button>,
        <Button key="pay" type="primary" loading={creating} disabled={providersLoading || !providers.length} onClick={() => void startPayment()}>
            确认支付
        </Button>,
    ];
}
