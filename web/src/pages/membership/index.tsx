import { Button } from "antd";
import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { useSearchParams } from "react-router";

import { MembershipCurrentStrip, MembershipPlanCards, useMembershipPlans } from "@/components/membership/membership-plan-cards";
import { useMembershipPurchase } from "@/components/membership/use-membership-purchase";
import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/layout/workspace-state";

export default function MembershipPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const paymentOrderId = searchParams.get("paymentOrder") || "";
    const { data, loading, loadError, reload } = useMembershipPlans(true);
    const { onPurchase, purchaseModals } = useMembershipPurchase(data, reload, paymentOrderId);
    const plans = data?.plans || [];

    useEffect(() => {
        if (!paymentOrderId) return;
        const next = new URLSearchParams(searchParams);
        next.delete("paymentOrder");
        setSearchParams(next, { replace: true });
    }, [paymentOrderId, searchParams, setSearchParams]);

    return (
        <WorkspacePage>
            <PageHeader
                title="会员权益"
                description="会员积分每月到账、当期未用完清零；生成扣费优先使用会员积分，不足时再扣通用积分。"
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
                <div className="mt-4 flex flex-col gap-4">
                    <MembershipCurrentStrip effective={data?.effective} membership={data?.membership} />
                    {plans.length ? (
                        <MembershipPlanCards plans={plans} effective={data?.effective} upgradeQuotes={data?.upgradeQuotes} onPurchase={onPurchase} />
                    ) : (
                        <WorkspaceErrorState title="暂无可选会员方案" description="管理员还没有配置启用中的会员等级，请稍后再来。" />
                    )}
                    <p className="membership-footnote">
                        支持在线开通、续费与升级；升级按剩余周期补差、到期日不变。支付渠道未开通时请联系管理员办理。会员积分在有效期内有效，到期未用完会自动清零并记录台账；通用积分（充值、兑换、签到）不受影响。
                    </p>
                </div>
            )}

            {purchaseModals}
        </WorkspacePage>
    );
}
