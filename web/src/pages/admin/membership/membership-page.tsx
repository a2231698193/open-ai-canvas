import { Crown } from "lucide-react";
import { lazy, Suspense } from "react";

import { AdminPageFrame } from "../components/admin-shell";

const MembershipPlansPanel = lazy(() => import("../components/membership-plans-panel"));

export default function MembershipPage() {
    return (
        <AdminPageFrame title="会员管理" description="等级配置、额度与启用状态；开通/升级/作废在用户详情中操作">
            <Suspense fallback={<div className="py-16 text-center text-sm text-foreground/50">正在读取会员等级...</div>}>
                <MembershipPlansPanel />
            </Suspense>
        </AdminPageFrame>
    );
}
