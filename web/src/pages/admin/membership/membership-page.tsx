import { Button } from "antd";
import { Crown, Plus } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { AdminPageFrame } from "../components/admin-shell";

const MembershipPlansPanel = lazy(() => import("../components/membership-plans-panel"));

export default function MembershipPage() {
    const [createOpen, setCreateOpen] = useState(false);

    return (
        <AdminPageFrame
            title="会员管理"
            description="等级配置、额度与启用状态；开通/升级/作废在用户详情中操作"
            actions={
                <Button type="primary" icon={<Crown className="size-4" />} onClick={() => setCreateOpen(true)}>
                    新建等级
                </Button>
            }
        >
            <Suspense fallback={<div className="py-16 text-center text-sm text-foreground/50">正在读取会员等级...</div>}>
                <MembershipPlansPanel createOpen={createOpen} onCreateOpenChange={setCreateOpen} />
            </Suspense>
        </AdminPageFrame>
    );
}
