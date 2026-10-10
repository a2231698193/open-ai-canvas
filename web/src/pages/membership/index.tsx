import { Button } from "antd";
import { RefreshCw } from "lucide-react";
import { useState } from "react";

import { MembershipContactModal, MembershipCurrentStrip, MembershipPlanCards, useMembershipPlans } from "@/components/membership/membership-plan-cards";
import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/layout/workspace-state";
import type { MembershipPlan } from "@/services/api/membership";

export default function MembershipPage() {
    const { data, loading, loadError, reload } = useMembershipPlans(true);
    const [contactPlan, setContactPlan] = useState<MembershipPlan | null>(null);
    const plans = data?.plans || [];

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
                        <MembershipPlanCards plans={plans} effective={data?.effective} membership={data?.membership} onContact={(plan) => setContactPlan(plan)} />
                    ) : (
                        <WorkspaceErrorState title="暂无可选会员方案" description="管理员还没有配置启用中的会员等级，请稍后再来。" />
                    )}
                    <p className="membership-footnote">
                        会员由管理员人工开通与升级；已发放的会员积分在有效期内有效，到期未用完会自动清零并记录台账。通用积分（充值、兑换、签到）不受影响。
                    </p>
                </div>
            )}

            <MembershipContactModal plan={contactPlan} membership={data?.membership} open={Boolean(contactPlan)} onCancel={() => setContactPlan(null)} />
        </WorkspacePage>
    );
}
