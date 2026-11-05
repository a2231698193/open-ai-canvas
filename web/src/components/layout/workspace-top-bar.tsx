import { Crown, HardDrive, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { currentLocale } from "@/i18n";

import { TopbarFeedbackButton } from "@/components/feedback/topbar-feedback-button";
import { SystemAnnouncementCenter } from "@/components/layout/system-announcement-center";
import { WorkspaceAccountMenu } from "@/components/layout/workspace-account-menu";
import { WorkspaceCreditGiftMark } from "@/components/layout/workspace-credit-gift-mark";
import { WorkspaceTopBarExtensionSlot } from "@/components/layout/workspace-top-bar-extension";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { LanguageMenu } from "@/components/layout/language-menu";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { MembershipPlansModal } from "@/components/membership/membership-plans-modal";
import { formatMembershipPrice, useMembershipPlans } from "@/components/membership/membership-plan-cards";
import { openStoragePurchase } from "@/lib/workspace-storage";
import { useAccountFileStorageUsage } from "@/hooks/use-account-file-storage-usage";
import { accountStorageMeter } from "@/lib/account-storage-usage";

const PAGE_TITLE_KEYS: Record<string, string> = {
    home: "nav.pageTitles.home",
    workspace: "nav.pageTitles.workspace",
    membership: "nav.pageTitles.membership",
    inspirations: "nav.pageTitles.inspirations",
    create: "nav.pageTitles.home",
    projects: "nav.pageTitles.projects",
    canvas: "nav.pageTitles.canvas",
    tasks: "nav.pageTitles.tasks",
    assets: "nav.pageTitles.assets",
    skills: "nav.pageTitles.skills",
    plugins: "nav.pageTitles.plugins",
    settings: "nav.pageTitles.settings",
};
const TOOLBOX_TITLE_KEYS: Record<string, string> = {
    image: "nav.pageTitles.toolboxImage",
    video: "nav.pageTitles.toolboxVideo",
};

export function WorkspaceTopBar({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
    const [membershipOpen, setMembershipOpen] = useState(false);
    const navigate = useNavigate();
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    const { t } = useTranslation();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const user = useUserStore((state) => state.user);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const { availableMicrocredits } = useWalletBalance(user?.id, creditsEnabled);
    const { data: membershipPlans } = useMembershipPlans(creditsEnabled);
    const storageQuery = useAccountFileStorageUsage(Boolean(user));
    const storageMeter = accountStorageMeter(storageQuery.data);
    const { pathname } = useLocation();
    const [slug, subSlug] = pathname.split("/").filter(Boolean);
    // /toolbox/image 和 /toolbox/video 共用 toolbox 首段，标题按第二段区分。
    const sectionKey = slug === "toolbox" ? TOOLBOX_TITLE_KEYS[subSlug ?? ""] : PAGE_TITLE_KEYS[slug ?? ""];
    const pageTitle = slug ? (sectionKey ? t(sectionKey) : brandName) : t(PAGE_TITLE_KEYS.home);
    const balance = availableMicrocredits === null ? "--" : (availableMicrocredits / 1_000_000).toLocaleString(currentLocale(), { maximumFractionDigits: 2 });
    const storageLabel = !storageQuery.data ? "--" : storageMeter.state === "read_only" ? t("shell.storageReadOnly") : storageMeter.full ? t("shell.storageFull") : storageMeter.remainingLabel;
    const plans = membershipPlans?.plans;
    const minMonthlyPriceFen = useMemo(() => {
        const prices = (plans || []).map((plan) => plan.monthPriceFen).filter((price) => price > 0);
        return prices.length ? Math.min(...prices) : 0;
    }, [plans]);
    const currentPlan = membershipPlans?.effective.active ? plans?.find((plan) => plan.id === membershipPlans.effective.planId) : undefined;
    const membershipLabel = membershipPlans?.effective.active ? t("shell.membershipRenew") : t("shell.membershipJoin");
    const membershipPriceFen = currentPlan && currentPlan.monthPriceFen > 0 ? currentPlan.monthPriceFen : minMonthlyPriceFen;

    return (
        <header className="app-workspace-topbar">
            <button type="button" className="app-workspace-mobile-menu app-workspace-topbar-icon-button" aria-label={sidebarOpen ? t("shell.collapseSidebar") : t("shell.expandSidebar")} onClick={onToggleSidebar}>
                {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
            </button>
            <nav className="app-workspace-topbar-breadcrumb" aria-label={t("shell.breadcrumb")}>
                <Link to="/workspace" className="font-medium text-foreground/65 transition-colors hover:text-foreground">
                    {brandName}
                </Link>
                <span aria-hidden="true">/</span>
                <span className="truncate font-medium text-foreground">{pageTitle}</span>
            </nav>
            <WorkspaceTopBarExtensionSlot />
            <div className="app-workspace-topbar-actions">
                <LanguageMenu />
                {user ? <TopbarFeedbackButton /> : null}
                {user ? (
                    <button
                        type="button"
                        className="app-workspace-topbar-credit-pill is-storage"
                        title={storageQuery.data ? t("shell.storageUsed", { used: storageMeter.usedLabel, total: storageMeter.totalLabel }) : t("shell.viewStorage")}
                        aria-label={t("shell.openStoragePurchase", { remaining: storageLabel })}
                        onClick={() => openStoragePurchase()}
                    >
                        <HardDrive className="size-4" />
                        <span>{t("shell.cloudSpace")}</span>
                        <strong>{storageLabel}</strong>
                    </button>
                ) : null}
                {creditsEnabled ? (
                    <>
                        <button
                            type="button"
                            className="app-workspace-topbar-credit-pill"
                            aria-label={membershipPriceFen > 0 ? t("shell.membershipAriaFrom", { label: membershipLabel, price: formatMembershipPrice(membershipPriceFen) }) : t("shell.viewMembership")}
                            onClick={() => setMembershipOpen(true)}
                        >
                            <Crown className="size-4" />
                            <span>{membershipLabel}</span>
                            {membershipPriceFen > 0 ? <small className="app-workspace-topbar-credit-price">{t("shell.priceFrom", { price: formatMembershipPrice(membershipPriceFen) })}</small> : null}
                        </button>
                        <button type="button" className="app-workspace-topbar-credit-pill" aria-label={t("shell.openWallet", { balance })} onClick={() => navigate("/membership")}>
                            <WorkspaceCreditGiftMark />
                            <span>{t("shell.credits")}</span>
                            <strong>{balance}</strong>
                        </button>
                    </>
                ) : null}
                {user ? <SystemAnnouncementCenter userId={user.id} className="app-workspace-topbar-icon-button" autoOpen /> : null}
                <AnimatedThemeToggler className="app-workspace-topbar-icon-button" theme={theme} onThemeChange={setTheme} aria-label={t("shell.toggleTheme")} />
                <WorkspaceAccountMenu />
            </div>
            {creditsEnabled ? <MembershipPlansModal open={membershipOpen} onCancel={() => setMembershipOpen(false)} /> : null}
        </header>
    );
}
