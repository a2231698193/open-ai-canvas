import { App, Button, Skeleton } from "antd";
import { ArrowRight, BadgeCheck, Check, Copy, Crown, RefreshCw, ShieldAlert } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";

import { AppModal } from "@/components/ui/product/app-modal";
import { formatCredits } from "@/constant/credits";
import { MEMBERSHIP_CONTACT_NOTE, MEMBERSHIP_WECHAT_ID, MEMBERSHIP_WECHAT_QR_URL } from "@/lib/membership-contact";
import { getMembershipPlans, type EffectiveMembership, type MembershipPlan, type UserMembership } from "@/services/api/membership";
import { cn } from "@/lib/utils";
import "./membership.css";

export type MembershipPlansData = Awaited<ReturnType<typeof getMembershipPlans>>;

// 档位强调色：[主色, 渐变深色]，勾选与按钮渐变随档位循环。
const MEMBERSHIP_ACCENTS: [string, string][] = [
    ["#3b82f6", "#1d4ed8"],
    ["#a855f7", "#7c3aed"],
    ["#f59e0b", "#b45309"],
    ["#94a3b8", "#475569"],
];

export function useMembershipPlans(enabled: boolean) {
    const [data, setData] = useState<MembershipPlansData | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState("");

    const reload = async () => {
        setLoading(true);
        setLoadError("");
        try {
            setData(await getMembershipPlans());
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : "读取会员方案失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!enabled) return;
        void reload();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);

    return { data, loading, loadError, reload };
}

export function MembershipCurrentStrip({ effective, membership }: { effective?: EffectiveMembership; membership?: UserMembership }) {
    if (effective?.active && membership) {
        return (
            <section className="membership-current" aria-label="当前会员">
                <span className="membership-current-emblem" aria-hidden="true">
                    <Crown className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                    <strong>
                        当前方案：<em>{effective.planName || "会员"}</em>
                        {effective.periodEnd ? <span className="membership-current-expiry">{new Date(effective.periodEnd).toLocaleDateString("zh-CN")} 前有效</span> : null}
                    </strong>
                    <span>每月到账 {formatCredits(effective.monthlyGrantMicrocredits)} 积分，会员积分在有效期内优先抵扣生成费用。</span>
                </div>
                <img src="/membership-banner-crown.png" alt="" aria-hidden="true" className="membership-current-crown" />
            </section>
        );
    }
    return (
        <section className="membership-current is-guest" aria-label="开通引导">
            <span className="membership-current-emblem is-muted" aria-hidden="true">
                <ShieldAlert className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
                <strong>还没有生效中的会员</strong>
                <span>选择下面的方案，点击「立即开通」联系管理员办理；开通后积分立即到账。</span>
            </div>
        </section>
    );
}

export function MembershipPlanCards({
    plans,
    effective,
    membership,
    onContact,
}: {
    plans: MembershipPlan[];
    effective?: EffectiveMembership;
    membership?: UserMembership;
    onContact: (plan: MembershipPlan) => void;
}) {
    const topPlanId = plans.length ? plans.reduce((best, plan) => (plan.level > best.level ? plan : best)).id : "";
    const currentPlanId = effective?.active ? effective.planId : "";
    return (
        <div className="membership-grid">
            {plans.map((plan, index) => {
                const featured = plan.id === topPlanId && plans.length > 1;
                const current = plan.id === currentPlanId;
                // 档位强调色循环：蓝 → 紫 → 金 → 银，勾选图标与按钮渐变随档位变化。
                const accent = MEMBERSHIP_ACCENTS[index % MEMBERSHIP_ACCENTS.length];
                return (
                    <article
                        key={plan.id}
                        className={cn("membership-card", featured && "is-featured", current && "is-current")}
                        style={{ "--card-accent": accent[0], "--card-accent-deep": accent[1] } as CSSProperties}
                    >
                        {featured ? (
                            <span className="membership-card-badge">
                                <Crown className="size-3" />
                                旗舰方案
                            </span>
                        ) : null}
                        {current ? (
                            <span className="membership-card-badge is-current">
                                <BadgeCheck className="size-3" />
                                当前方案
                            </span>
                        ) : null}
                        <h3>
                            <span className="membership-card-crown" aria-hidden="true">
                                <Crown className="size-4" />
                            </span>
                            {plan.name}
                        </h3>
                        <p className="membership-card-grant">
                            <strong>{formatCredits(plan.monthlyGrantMicrocredits)}</strong>
                            <span>积分 / 月</span>
                        </p>
                        <p className="membership-card-note">每月到账，当期未用完清零</p>
                        <ul>
                            <MembershipFeature label={concurrencyLabel(plan.activeTaskLimit)} />
                            <MembershipFeature label={storageLabel(plan.storageGB)} />
                            {plan.dailyUploadMB > 0 ? <MembershipFeature label={dailyUploadLabel(plan.dailyUploadMB)} /> : null}
                            <MembershipFeature label={checkinLabel(plan.checkinBonusOverrideMicrocredits)} />
                            <MembershipFeature label="生成扣费会员积分优先抵扣" />
                        </ul>
                        {current ? (
                            <Button block size="large" className="membership-card-cta is-current" disabled>
                                当前方案
                            </Button>
                        ) : (
                            <Button block size="large" className="membership-card-cta" onClick={() => onContact(plan)}>
                                {membership ? "升级 / 续费" : "立即开通"}
                                <ArrowRight className="size-4" />
                            </Button>
                        )}
                    </article>
                );
            })}
        </div>
    );
}

export function MembershipContactModal({ plan, membership, open, onCancel }: { plan: MembershipPlan | null; membership?: UserMembership; open: boolean; onCancel: () => void }) {
    const { message } = App.useApp();
    return (
        <AppModal open={open} title={plan ? `开通 ${plan.name}` : "开通会员"} centered width={400} footer={null} onCancel={onCancel}>
            <div className="membership-contact">
                <div className="membership-contact-qr">
                    <img
                        src={MEMBERSHIP_WECHAT_QR_URL}
                        alt="管理员微信二维码"
                        onError={(event) => {
                            event.currentTarget.style.display = "none";
                            event.currentTarget.parentElement?.classList.add("is-qr-missing");
                        }}
                    />
                </div>
                <p className="membership-contact-note">{MEMBERSHIP_CONTACT_NOTE}</p>
                {plan ? (
                    <p className="membership-contact-plan">
                        {plan.name} · 每月 {formatCredits(plan.monthlyGrantMicrocredits)} 积分
                        {membership ? " · 支持升级补差与续费顺延" : ""}
                    </p>
                ) : null}
                <button
                    type="button"
                    className="membership-contact-wechat"
                    onClick={async () => {
                        try {
                            await navigator.clipboard.writeText(MEMBERSHIP_WECHAT_ID);
                            message.success("微信号已复制");
                        } catch {
                            message.info(`微信号：${MEMBERSHIP_WECHAT_ID}`);
                        }
                    }}
                >
                    <Copy className="size-4" />
                    微信号：{MEMBERSHIP_WECHAT_ID}
                </button>
            </div>
        </AppModal>
    );
}

function MembershipFeature({ label }: { label: string }) {
    return (
        <li>
            <Check className="size-4 shrink-0 membership-card-check" />
            <span>{label}</span>
        </li>
    );
}

function concurrencyLabel(limit: number) {
    if (limit < 0) return "无限并发生成任务";
    if (limit === 0) return "并发任务沿用平台默认";
    return `${limit} 个并发生成任务`;
}

function storageLabel(gb: number) {
    if (gb < 0) return "云存储空间不设上限";
    if (gb === 0) return "云存储空间沿用平台默认";
    return `云存储空间 ${gb}GB`;
}

function dailyUploadLabel(mb: number) {
    if (mb < 0) return "每日上传不设上限";
    return `每日上传至多 ${formatGB(mb)}`;
}

function checkinLabel(override: number) {
    if (override > 0) return `每日签到送 ${formatCredits(override)} 积分`;
    return "每日签到送积分（平台默认）";
}

function formatGB(mb: number) {
    if (mb % 1024 === 0) return `${mb / 1024}GB`;
    return `${mb}MB`;
}

export function MembershipPlansSkeleton() {
    return <Skeleton active paragraph={{ rows: 6 }} />;
}
