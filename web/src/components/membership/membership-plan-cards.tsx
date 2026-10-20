import { App, Button, Skeleton } from "antd";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BadgeCheck, Check, Copy, Crown, RefreshCw, ShieldAlert } from "lucide-react";
import { useState, type CSSProperties } from "react";

import { AppModal } from "@/components/ui/product/app-modal";
import { formatCredits } from "@/constant/credits";
import { MEMBERSHIP_CONTACT_NOTE, MEMBERSHIP_WECHAT_ID, MEMBERSHIP_WECHAT_QR_URL } from "@/lib/membership-contact";
import { getMembershipPlans, type EffectiveMembership, type MembershipPlan, type MembershipUpgradeQuote, type UserMembership } from "@/services/api/membership";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/stores/use-user-store";
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
    const userId = useUserStore((state) => state.user?.id || "");
    const query = useQuery({
        queryKey: ["membership-plans", userId],
        enabled: enabled && Boolean(userId),
        queryFn: getMembershipPlans,
        staleTime: 60_000,
        refetchOnWindowFocus: false,
    });
    const reload = async () => {
        await query.refetch();
    };
    return {
        data: query.data ?? null,
        loading: query.isFetching,
        loadError: query.error instanceof Error ? query.error.message : "",
        reload,
    };
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
                <span>选择下面的方案在线开通，支付完成后权益立即生效；如支付方式未开通，可联系管理员办理。</span>
            </div>
        </section>
    );
}

const MEMBERSHIP_DURATIONS = [
    { months: 1, label: "月卡", priceKey: "monthPriceFen" },
    { months: 3, label: "季卡", priceKey: "quarterPriceFen" },
    { months: 12, label: "年卡", priceKey: "yearPriceFen" },
] as const;

type MembershipDuration = (typeof MEMBERSHIP_DURATIONS)[number];

export function membershipDurationPrice(plan: MembershipPlan, months: number) {
    if (months === 3) return plan.quarterPriceFen;
    if (months === 12) return plan.yearPriceFen;
    return plan.monthPriceFen;
}

export function membershipDurationLabel(months: number) {
    if (months === 3) return "季卡";
    if (months === 12) return "年卡";
    return "月卡";
}

export function formatMembershipPrice(fen: number) {
    return `¥${(fen / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

function priceNote(plan: MembershipPlan, duration: MembershipDuration, priceFen: number) {
    if (priceFen <= 0) return "该时长暂未开放购买";
    if (duration.months === 1) return `每月到账 ${formatCredits(plan.monthlyGrantMicrocredits)} 积分，当期未用完清零`;
    return `折合 ¥${Math.floor(priceFen / 100 / duration.months)}/月 · 周期内共 ${formatCredits(plan.monthlyGrantMicrocredits * duration.months)} 积分`;
}

function cardAction({
    current,
    isHigher,
    isLower,
    quote,
    priceFen,
}: {
    current: boolean;
    isHigher: boolean;
    isLower: boolean;
    quote?: MembershipUpgradeQuote;
    priceFen: number;
}) {
    if (isLower) return { disabled: true, label: "暂不支持降级" };
    if (isHigher) {
        if (!quote?.canUpgrade) return { disabled: true, label: quote?.reason || "暂不可在线升级" };
        return { disabled: false, label: `升级补差价 ${formatMembershipPrice(quote.amountFen)}` };
    }
    if (priceFen <= 0) return { disabled: true, label: "暂未定价" };
    return { disabled: false, label: `${current ? "续费" : "立即开通"} ${formatMembershipPrice(priceFen)}` };
}

export function MembershipPlanCards({
    plans,
    effective,
    upgradeQuotes,
    onPurchase,
}: {
    plans: MembershipPlan[];
    effective?: EffectiveMembership;
    upgradeQuotes?: Record<string, MembershipUpgradeQuote>;
    onPurchase: (plan: MembershipPlan, months: number) => void;
}) {
    const [duration, setDuration] = useState<MembershipDuration>(MEMBERSHIP_DURATIONS[0]);
    const topPlanId = plans.length ? plans.reduce((best, plan) => (plan.level > best.level ? plan : best)).id : "";
    const currentPlanId = effective?.active ? effective.planId : "";
    const activeLevel = effective?.active ? effective.level : 0;
    return (
        <div className="membership-plans">
            <div className="membership-duration-toggle">
                <div className="membership-duration-switch" role="tablist" aria-label="会员时长">
                    {MEMBERSHIP_DURATIONS.map((item) => (
                        <button
                            key={item.months}
                            type="button"
                            role="tab"
                            aria-selected={duration.months === item.months}
                            className={cn(duration.months === item.months && "is-selected")}
                            onClick={() => setDuration(item)}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
                {activeLevel > 0 ? <span className="membership-duration-hint">升级按剩余周期补差，到期日不变</span> : null}
            </div>
            <div className="membership-grid">
                {plans.map((plan, index) => {
                    const featured = plan.id === topPlanId && plans.length > 1;
                    const current = plan.id === currentPlanId;
                    const isHigher = activeLevel > 0 && plan.level > activeLevel;
                    const isLower = activeLevel > 0 && plan.level < activeLevel;
                    const quote = isHigher ? upgradeQuotes?.[plan.id] : undefined;
                    const priceFen = membershipDurationPrice(plan, duration.months);
                    const action = cardAction({ current, isHigher, isLower, quote, priceFen });
                    // 档位强调色循环：蓝 → 紫 → 金 → 银，勾选图标与按钮渐变随档位变化。
                    const accent = MEMBERSHIP_ACCENTS[index % MEMBERSHIP_ACCENTS.length];
                    return (
                        <article
                            key={plan.id}
                            className={cn("membership-card", featured && "is-featured", current && "is-current")}
                            style={{ "--card-accent": accent[0], "--card-accent-deep": accent[1] } as CSSProperties}
                        >
                            {current ? (
                                <span className="membership-card-badge is-current">
                                    <BadgeCheck className="size-3" />
                                    当前方案
                                </span>
                            ) : featured ? (
                                <span className="membership-card-badge">
                                    <Crown className="size-3" />
                                    旗舰方案
                                </span>
                            ) : null}
                            <h3>
                                <span className="membership-card-crown" aria-hidden="true">
                                    <Crown className="size-4" />
                                </span>
                                {plan.name}
                            </h3>
                            {isHigher ? (
                                quote?.canUpgrade ? (
                                    <>
                                        <p className="membership-card-price">
                                            <strong>{formatMembershipPrice(quote.amountFen)}</strong>
                                            <span>升级补差价</span>
                                        </p>
                                        <p className="membership-card-note">剩余 {quote.remainingDays} 天 · 升级后到期日不变</p>
                                    </>
                                ) : (
                                    <>
                                        <p className="membership-card-price is-muted">
                                            <strong>—</strong>
                                            <span>升级补差价</span>
                                        </p>
                                        <p className="membership-card-note">{quote?.reason || "当前不可在线升级，请联系管理员"}</p>
                                    </>
                                )
                            ) : (
                                <>
                                    <p className="membership-card-price">
                                        <strong>{priceFen > 0 ? formatMembershipPrice(priceFen) : "待定价"}</strong>
                                        <span>{duration.label}</span>
                                    </p>
                                    <p className="membership-card-note">{priceNote(plan, duration, priceFen)}</p>
                                </>
                            )}
                            <ul>
                                <MembershipFeature label={`每月到账 ${formatCredits(plan.monthlyGrantMicrocredits)} 积分`} />
                                <MembershipFeature label={concurrencyLabel(plan.activeTaskLimit)} />
                                <MembershipFeature label={storageLabel(plan.storageGB)} />
                                {plan.dailyUploadMB > 0 ? <MembershipFeature label={dailyUploadLabel(plan.dailyUploadMB)} /> : null}
                                <MembershipFeature label={checkinLabel(plan.checkinBonusOverrideMicrocredits)} />
                                <MembershipFeature label="生成扣费会员积分优先抵扣" />
                            </ul>
                            <Button
                                block
                                size="large"
                                className={cn("membership-card-cta", current && "is-current")}
                                disabled={action.disabled}
                                onClick={() => onPurchase(plan, duration.months)}
                            >
                                {action.label}
                                {!action.disabled ? <ArrowRight className="size-4" /> : null}
                            </Button>
                        </article>
                    );
                })}
            </div>
        </div>
    );
}

export function MembershipContactModal({ plan, membership, open, onCancel, message: notice }: { plan: MembershipPlan | null; membership?: UserMembership; open: boolean; onCancel: () => void; message?: string }) {
    const { message } = App.useApp();
    return (
        <AppModal open={open} title={notice ? "联系管理员" : plan ? `开通 ${plan.name}` : "开通会员"} centered width={400} footer={null} onCancel={onCancel}>
            <div className="membership-contact">
                {notice ? <p className="membership-contact-notice">{notice}</p> : null}
                {MEMBERSHIP_WECHAT_QR_URL ? (
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
                ) : null}
                {MEMBERSHIP_WECHAT_QR_URL || MEMBERSHIP_WECHAT_ID ? <p className="membership-contact-note">{MEMBERSHIP_CONTACT_NOTE}</p> : null}
                {!notice && !MEMBERSHIP_WECHAT_QR_URL && !MEMBERSHIP_WECHAT_ID ? <p className="membership-contact-note">请联系管理员开通会员。</p> : null}
                {plan ? (
                    <p className="membership-contact-plan">
                        {plan.name} · 每月 {formatCredits(plan.monthlyGrantMicrocredits)} 积分
                        {membership ? " · 支持升级补差与续费顺延" : ""}
                    </p>
                ) : null}
                {MEMBERSHIP_WECHAT_ID ? (
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
                ) : null}
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
