import { App, Button } from "antd";
import { BadgeCheck, Check, Copy, Crown, RefreshCw, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { AppModal } from "@/components/ui/product/app-modal";
import { formatCredits } from "@/constant/credits";
import { MEMBERSHIP_CONTACT_NOTE, MEMBERSHIP_WECHAT_ID, MEMBERSHIP_WECHAT_QR_URL } from "@/lib/membership-contact";
import { getMembershipPlans, type EffectiveMembership, type MembershipPlan, type UserMembership } from "@/services/api/membership";
import { cn } from "@/lib/utils";
import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/layout/workspace-state";
import "./membership.css";

type MembershipPlansResult = Awaited<ReturnType<typeof getMembershipPlans>>;

export default function MembershipPage() {
    const { message } = App.useApp();
    const [data, setData] = useState<MembershipPlansResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [contactOpen, setContactOpen] = useState(false);
    const [selectedPlan, setSelectedPlan] = useState<MembershipPlan | null>(null);

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
        void reload();
    }, []);

    const plans = data?.plans || [];
    const effective: EffectiveMembership | undefined = data?.effective;
    const membership: UserMembership | undefined = data?.membership;
    const topPlanId = plans.length ? plans.reduce((best, plan) => (plan.level > best.level ? plan : best)).id : "";
    const currentPlanId = effective?.active ? effective.planId : "";

    const openContact = (plan: MembershipPlan) => {
        setSelectedPlan(plan);
        setContactOpen(true);
    };

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
                    {effective?.active && membership ? (
                        <section className="membership-current" aria-label="当前会员">
                            <BadgeCheck className="size-5 shrink-0 text-primary" />
                            <div className="min-w-0 flex-1">
                                <strong>
                                    当前方案：{effective.planName || "会员"}
                                    {effective.periodEnd ? (
                                        <span className="membership-current-expiry">
                            {new Date(effective.periodEnd).toLocaleDateString("zh-CN")} 前有效
                                        </span>
                                    ) : null}
                                </strong>
                                <span>每月到账 {formatCredits(effective.monthlyGrantMicrocredits)} 积分，会员积分 {effective.periodEnd ? "在有效期内优先抵扣生成费用" : "优先抵扣生成费用"}。</span>
                            </div>
                        </section>
                    ) : (
                        <section className="membership-current is-guest" aria-label="开通引导">
                            <ShieldAlert className="size-5 shrink-0 text-warning" />
                            <div className="min-w-0 flex-1">
                                <strong>还没有生效中的会员</strong>
                                <span>选择下面的方案，点击「立即开通」联系管理员办理；开通后积分立即到账。</span>
                            </div>
                        </section>
                    )}

                    {!plans.length ? (
                        <WorkspaceErrorState title="暂无可选会员方案" description="管理员还没有配置启用中的会员等级，请稍后再来。" />
                    ) : (
                        <div className="membership-grid">
                            {plans.map((plan) => {
                                const featured = plan.id === topPlanId && plans.length > 1;
                                const current = plan.id === currentPlanId;
                                return (
                                    <article key={plan.id} className={cn("membership-card", featured && "is-featured", current && "is-current")}>
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
                                        <h3>{plan.name}</h3>
                                        <p className="membership-card-grant">
                                            <strong>{formatCredits(plan.monthlyGrantMicrocredits)}</strong>
                                            <span>积分 / 月</span>
                                        </p>
                                        <p className="membership-card-note">每月到账 · 当期未用完清零</p>
                                        <ul>
                                            <MembershipFeature label={concurrencyLabel(plan.activeTaskLimit)} />
                                            <MembershipFeature label={storageLabel(plan.storageGB)} />
                                            {plan.dailyUploadMB > 0 ? <MembershipFeature label={dailyUploadLabel(plan.dailyUploadMB)} /> : null}
                                            <MembershipFeature label={checkinLabel(plan.checkinBonusOverrideMicrocredits)} />
                                            <MembershipFeature label="生成扣费会员积分优先抵扣" />
                                        </ul>
                                        <Button
                                            type="primary"
                                            block
                                            size="large"
                                            disabled={current}
                                            onClick={() => openContact(plan)}
                                        >
                                            {current ? "当前方案" : membership ? "升级 / 续费" : "立即开通"}
                                        </Button>
                                    </article>
                                );
                            })}
                        </div>
                    )}

                    <p className="membership-footnote">
                        会员由管理员人工开通与升级；已发放的会员积分在有效期内有效，到期未用完会自动清零并记录台账。通用积分（充值、兑换、签到）不受影响。
                    </p>
                </div>
            )}

            <AppModal open={contactOpen} title={selectedPlan ? `开通 ${selectedPlan.name}` : "开通会员"} centered width={400} footer={null} onCancel={() => setContactOpen(false)}>
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
                    {selectedPlan ? (
                        <p className="membership-contact-plan">
                            {selectedPlan.name} · 每月 {formatCredits(selectedPlan.monthlyGrantMicrocredits)} 积分
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
        </WorkspacePage>
    );
}

function MembershipFeature({ label }: { label: string }) {
    return (
        <li>
            <Check className="size-4 shrink-0 text-primary" />
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
