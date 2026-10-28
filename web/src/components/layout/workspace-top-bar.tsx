import { Crown, HardDrive, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { TopbarFeedbackButton } from "@/components/feedback/topbar-feedback-button";
import { SystemAnnouncementCenter } from "@/components/layout/system-announcement-center";
import { WorkspaceAccountMenu } from "@/components/layout/workspace-account-menu";
import { WorkspaceCreditGiftMark } from "@/components/layout/workspace-credit-gift-mark";
import { WorkspaceTopBarExtensionSlot } from "@/components/layout/workspace-top-bar-extension";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { MembershipPlansModal } from "@/components/membership/membership-plans-modal";
import { formatMembershipPrice, useMembershipPlans } from "@/components/membership/membership-plan-cards";
import { openStoragePurchase } from "@/lib/workspace-storage";
import { useAccountFileStorageUsage } from "@/hooks/use-account-file-storage-usage";
import { accountStorageMeter } from "@/lib/account-storage-usage";

const PAGE_TITLES: Record<string, string> = {
    home: "创作",
    workspace: "创作台",
    membership: "会员中心",
    create: "创作",
    inspirations: "灵感",
    projects: "短剧制作",
    canvas: "自由画布",
    tasks: "创作历史",
    assets: "资产",
    skills: "技能",
    plugins: "插件",
    settings: "设置",
};

export function WorkspaceTopBar({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
    const [membershipOpen, setMembershipOpen] = useState(false);
    const navigate = useNavigate();
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const user = useUserStore((state) => state.user);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const { availableMicrocredits } = useWalletBalance(user?.id, creditsEnabled);
    const { data: membershipPlans } = useMembershipPlans(creditsEnabled);
    const storageQuery = useAccountFileStorageUsage(Boolean(user));
    const storageMeter = accountStorageMeter(storageQuery.data);
    const { pathname } = useLocation();
    const slug = pathname.split("/").filter(Boolean)[0];
    const pageTitle = slug ? PAGE_TITLES[slug] || brandName : PAGE_TITLES.home;
    const balance = availableMicrocredits === null ? "--" : (availableMicrocredits / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
    const storageLabel = !storageQuery.data ? "--" : storageMeter.state === "read_only" ? "只读" : storageMeter.full ? "已满" : storageMeter.remainingLabel;
    const plans = membershipPlans?.plans;
    const minMonthlyPriceFen = useMemo(() => {
        const prices = (plans || []).map((plan) => plan.monthPriceFen).filter((price) => price > 0);
        return prices.length ? Math.min(...prices) : 0;
    }, [plans]);
    const currentPlan = membershipPlans?.effective.active ? plans?.find((plan) => plan.id === membershipPlans.effective.planId) : undefined;
    const membershipLabel = membershipPlans?.effective.active ? "续费" : "开通会员";
    const membershipPriceFen = currentPlan && currentPlan.monthPriceFen > 0 ? currentPlan.monthPriceFen : minMonthlyPriceFen;

    return (
        <header className="app-workspace-topbar">
            <button type="button" className="app-workspace-mobile-menu app-workspace-topbar-icon-button" aria-label={sidebarOpen ? "收起侧栏" : "展开侧栏"} onClick={onToggleSidebar}>
                {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
            </button>
            <nav className="app-workspace-topbar-breadcrumb" aria-label="当前位置">
                <Link to="/workspace" className="font-medium text-foreground/65 transition-colors hover:text-foreground">
                    {brandName}
                </Link>
                <span aria-hidden="true">/</span>
                <span className="truncate font-medium text-foreground">{pageTitle}</span>
            </nav>
            <WorkspaceTopBarExtensionSlot />
            <div className="app-workspace-topbar-actions">
                {user ? <TopbarFeedbackButton /> : null}
                {user ? (
                    <button
                        type="button"
                        className="app-workspace-topbar-credit-pill is-storage"
                        title={storageQuery.data ? `已用 ${storageMeter.usedLabel} / ${storageMeter.totalLabel}` : "查看存储空间"}
                        aria-label={`打开存储空间充值，剩余 ${storageLabel}`}
                        onClick={() => openStoragePurchase()}
                    >
                        <HardDrive className="size-4" />
                        <span>云空间</span>
                        <strong>{storageLabel}</strong>
                    </button>
                ) : null}
                {creditsEnabled ? (
                    <>
                        <button
                            type="button"
                            className="app-workspace-topbar-credit-pill"
                            aria-label={membershipPriceFen > 0 ? `${membershipLabel}，${formatMembershipPrice(membershipPriceFen)} 起` : "查看会员权益"}
                            onClick={() => setMembershipOpen(true)}
                        >
                            <Crown className="size-4" />
                            <span>{membershipLabel}</span>
                            {membershipPriceFen > 0 ? <small className="app-workspace-topbar-credit-price">{formatMembershipPrice(membershipPriceFen)} 起</small> : null}
                        </button>
                        <button type="button" className="app-workspace-topbar-credit-pill" aria-label={`打开积分中心，可用 ${balance} 积分`} onClick={() => navigate("/membership")}>
                            <WorkspaceCreditGiftMark />
                            <span>积分</span>
                            <strong>{balance}</strong>
                        </button>
                    </>
                ) : null}
                {user ? <SystemAnnouncementCenter userId={user.id} className="app-workspace-topbar-icon-button" autoOpen /> : null}
                <AnimatedThemeToggler className="app-workspace-topbar-icon-button" theme={theme} onThemeChange={setTheme} aria-label="切换主题" />
                <WorkspaceAccountMenu />
            </div>
            {creditsEnabled ? <MembershipPlansModal open={membershipOpen} onCancel={() => setMembershipOpen(false)} /> : null}
        </header>
    );
}
