import { useState } from "react";
import { Crown } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import { MembershipContactModal, MembershipCurrentStrip, MembershipPlanCards, useMembershipPlans, type MembershipPlansData } from "@/components/membership/membership-plan-cards";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/layout/workspace-state";
import type { MembershipPlan } from "@/services/api/membership";

/** 顶栏「开通会员」入口弹出的档位列表；数据与 /membership 页面共用一份组件。 */
export function MembershipPlansModal({ open, onCancel }: { open: boolean; onCancel: () => void }) {
    const { data, loading, loadError, reload } = useMembershipPlans(open);
    const [contactPlan, setContactPlan] = useState<MembershipPlan | null>(null);
    return (
        <>
            <AppModal
                open={open}
                title={
                    <span className="membership-modal-title">
                        <Crown className="size-5 membership-modal-title-crown" />
                        会员权益
                        <span className="membership-modal-subtitle">尊享多重特权 · 畅享极致体验</span>
                    </span>
                }
                centered
                width="min(1180px, calc(100vw - 28px))"
                footer={null}
                onCancel={onCancel}
            >
                <MembershipPlansBody data={data} loading={loading} loadError={loadError} onReload={() => void reload()} onContact={(plan) => setContactPlan(plan)} />
            </AppModal>
            <MembershipContactModal plan={contactPlan} membership={data?.membership} open={Boolean(contactPlan)} onCancel={() => setContactPlan(null)} />
        </>
    );
}

function MembershipPlansBody({
    data,
    loading,
    loadError,
    onReload,
    onContact,
}: {
    data: MembershipPlansData | null;
    loading: boolean;
    loadError: string;
    onReload: () => void;
    onContact: (plan: MembershipPlan) => void;
}) {
    if (loading && !data) return <WorkspaceLoadingState label="正在加载会员方案" detail="读取后台配置的等级与权益" rows={4} />;
    if (loadError) return <WorkspaceErrorState title="会员方案加载失败" description={loadError} onRetry={onReload} />;
    const plans = data?.plans || [];
    return (
        <div className="flex flex-col gap-4">
            <MembershipCurrentStrip effective={data?.effective} membership={data?.membership} />
            {plans.length ? (
                <MembershipPlanCards plans={plans} effective={data?.effective} membership={data?.membership} onContact={onContact} />
            ) : (
                <WorkspaceErrorState title="暂无可选会员方案" description="管理员还没有配置启用中的会员等级，请稍后再来。" />
            )}
        </div>
    );
}
