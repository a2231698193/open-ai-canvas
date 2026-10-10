import { useEffect, useState } from "react";
import { App, Button, Descriptions, Form, Input, Modal, Progress, Select, Skeleton, Tabs } from "antd";
import { AdminDrawer } from "@/pages/admin/ui/overlays";
import { ChevronLeft, ChevronRight, Crown } from "lucide-react";

import { formatCredits } from "@/constant/credits";
import { IconButton } from "@/pages/admin/ui/controls";
import { cancelAdminMembership, grantAdminMembership, listAdminMembershipPlans, upgradeAdminMembership, type MembershipPlan } from "@/services/api/membership";
import { AdminDataTable, AdminEmpty, AdminStatusBadge, AdminTableEmpty, PaginationBar, type AdminStatusTone } from "./admin-ui";
import { getAdminUserDetail, listAdminUserAuditEvents, listAdminUserLedger, listAdminUserTasks, type AdminAuditEvent, type AdminUserDetail, type AdminUserTask } from "@/services/api/auth";
import type { CreditLedgerEntry } from "@/services/api/wallet";

export function AdminUserDetailDrawer({ userId, onClose, previousUserId, nextUserId, onNavigate }: { userId: string | null; onClose: () => void; previousUserId?: string; nextUserId?: string; onNavigate?: (userId: string) => void }) {
    const { message } = App.useApp();
    const [detail, setDetail] = useState<AdminUserDetail | null>(null);
    const [ledger, setLedger] = useState<CreditLedgerEntry[]>([]);
    const [tasks, setTasks] = useState<AdminUserTask[]>([]);
    const [events, setEvents] = useState<AdminAuditEvent[]>([]);
    const [loading, setLoading] = useState(false);
    const [ledgerPage, setLedgerPage] = useState(1);
    const [ledgerTotal, setLedgerTotal] = useState(0);
    const [taskPage, setTaskPage] = useState(1);
    const [taskTotal, setTaskTotal] = useState(0);
    const [auditPage, setAuditPage] = useState(1);
    const [auditTotal, setAuditTotal] = useState(0);

    useEffect(() => {
        if (!userId) return;
        let active = true;
        setLoading(true);
        setDetail(null);
        setLedgerPage(1);
        setTaskPage(1);
        setAuditPage(1);
        void getAdminUserDetail(userId)
            .then((nextDetail) => {
                if (active) setDetail(nextDetail);
            })
            .catch((error) => active && message.error(error instanceof Error ? error.message : "读取用户详情失败"))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [message, userId]);

    useEffect(() => {
        if (!userId) return;
        let active = true;
        void listAdminUserLedger(userId, { page: ledgerPage, pageSize: 20 })
            .then((result) => {
                if (active) {
                    setLedger(result.entries);
                    setLedgerTotal(result.total);
                }
            })
            .catch((error) => active && message.error(error instanceof Error ? error.message : "读取积分流水失败"));
        return () => {
            active = false;
        };
    }, [ledgerPage, message, userId]);
    useEffect(() => {
        if (!userId) return;
        let active = true;
        void listAdminUserTasks(userId, { page: taskPage, pageSize: 20 })
            .then((result) => {
                if (active) {
                    setTasks(result.tasks);
                    setTaskTotal(result.total);
                }
            })
            .catch((error) => active && message.error(error instanceof Error ? error.message : "读取任务记录失败"));
        return () => {
            active = false;
        };
    }, [message, taskPage, userId]);
    useEffect(() => {
        if (!userId) return;
        let active = true;
        void listAdminUserAuditEvents(userId, { page: auditPage, pageSize: 20 })
            .then((result) => {
                if (active) {
                    setEvents(result.events);
                    setAuditTotal(result.total);
                }
            })
            .catch((error) => active && message.error(error instanceof Error ? error.message : "读取管理操作失败"));
        return () => {
            active = false;
        };
    }, [auditPage, message, userId]);

    return (
        <AdminDrawer
            title={detail ? `${detail.user.displayName || detail.user.username} · 用户详情` : "用户详情"}
            open={Boolean(userId)}
            onClose={onClose}
            size="min(920px, 100vw)"
            rootClassName="admin-drawer"
            extra={onNavigate ? (
                <div className="flex items-center gap-1">
                    <IconButton size="sm" variant="ghost" aria-label="上一条用户" disabled={!previousUserId} icon={ChevronLeft} onClick={() => previousUserId && onNavigate(previousUserId)} />
                    <IconButton size="sm" variant="ghost" aria-label="下一条用户" disabled={!nextUserId} icon={ChevronRight} onClick={() => nextUserId && onNavigate(nextUserId)} />
                </div>
            ) : null}
        >
            {loading && !detail ? (
                <Skeleton active paragraph={{ rows: 10 }} />
            ) : detail ? (
                <Tabs
                    items={[
                        {
                            key: "overview",
                            label: "账号概览",
                            children: (
                                <div className="space-y-5">
                                    <Descriptions
                                        bordered
                                        size="small"
                                        column={{ xs: 1, sm: 2 }}
                                        items={[
                                            { key: "username", label: "用户名", children: `@${detail.user.username}` },
                                            { key: "email", label: "邮箱", children: detail.user.email || "未填写" },
                                            { key: "role", label: "角色", children: detail.user.role === "admin" ? "管理员" : "普通用户" },
                                            { key: "status", label: "状态", children: <AdminStatusBadge label={detail.user.status === "active" ? "启用" : "停用"} tone={detail.user.status === "active" ? "success" : "neutral"} /> },
                                            { key: "available", label: "可用积分", children: formatCredits(detail.account.availableMicrocredits) },
                                            { key: "membership-pool", label: "会员积分", children: `${formatCredits(detail.account.membershipMicrocredits)}${detail.account.membershipExpiresAt ? `（${new Date(detail.account.membershipExpiresAt).toLocaleDateString("zh-CN")} 前有效）` : ""}` },
                                            { key: "recharge", label: "累计充值积分", children: formatCredits(detail.counts.rechargeMicrocredits) },
                                            { key: "checkin", label: "累计签到积分", children: formatCredits(detail.counts.checkinMicrocredits) },
                                            { key: "reserved", label: "冻结积分", children: formatCredits(detail.account.reservedMicrocredits) },
                                            { key: "created", label: "注册时间", children: formatTime(detail.user.createdAt) },
                                            { key: "login", label: "最后登录", children: formatTime(detail.user.lastLoginAt) },
                                        ]}
                                    />
                                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                        {Object.entries({ 积分流水: detail.counts.ledgerEntries, 生成任务: detail.counts.tasks, 上游请求: detail.counts.apiCalls, 管理操作: detail.counts.auditEvents }).map(([label, value]) => (
                                            <div key={label} className="rounded-md border border-border p-3">
                                                <div className="text-xs text-foreground/50">{label}</div>
                                                <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
                                            </div>
                                        ))}
                                    </div>
                                    <UserMembershipSection detail={detail} onUpdated={() => void getAdminUserDetail(detail.user.id).then((next) => setDetail(next))} />
                                    <div>
                                        <div className="mb-3 text-sm font-medium">资源与配额占用</div>
                                        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                                            {quotaUsageItems(detail).map((item) => (
                                                <div key={item.label}>
                                                    <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                                                        <span className="text-foreground/60">{item.label}</span>
                                                        <span className="shrink-0 tabular-nums text-foreground/75">{item.display}</span>
                                                    </div>
                                                    <Progress percent={Math.min(100, item.limit > 0 ? Math.round(item.value / item.limit * 100) : 0)} size="small" showInfo={false} status={item.value >= item.limit ? "exception" : "normal"} />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ),
                        },
                        {
                            key: "ledger",
                            label: `积分流水 ${detail.counts.ledgerEntries}`,
                            children: (
                                <AdminDataTable
                                    table={{
                                        rowKey: "id",
                                        size: "small",
                                        dataSource: ledger,
                                        pagination: false,
                                        columns: [
                                        { title: "时间", dataIndex: "createdAt", width: 170, render: formatTime },
                                        { title: "类型", dataIndex: "type", width: 130 },
                                        { title: "变化", dataIndex: "amountMicrocredits", width: 120, align: "right", render: (value) => formatCredits(value) },
                                        { title: "说明", dataIndex: "note", ellipsis: true },
                                        ],
                                        scroll: { x: 720 },
                                    }}
                                    empty={<AdminTableEmpty />}
                                    footer={<PaginationBar alwaysShow current={ledgerPage} pageSize={20} total={ledgerTotal} onChange={(page) => setLedgerPage(page)} pageSizeOptions={[20]} />}
                                />
                            ),
                        },
                        {
                            key: "tasks",
                            label: `生成任务 ${detail.counts.tasks}`,
                            children: (
                                <AdminDataTable
                                    table={{
                                        rowKey: "id",
                                        size: "small",
                                        dataSource: tasks,
                                        pagination: false,
                                        columns: [
                                        { title: "时间", dataIndex: "createdAt", width: 170, render: formatTime },
                                        { title: "类型", dataIndex: "type", width: 180 },
                                        { title: "模型", dataIndex: "model", width: 180, ellipsis: true },
                                        { title: "状态", dataIndex: "status", width: 100, render: (value) => <AdminStatusBadge label={value || "未知"} tone={taskStatusTone(value)} /> },
                                        { title: "阶段", dataIndex: "stage", ellipsis: true },
                                        ],
                                        scroll: { x: 820 },
                                    }}
                                    empty={<AdminTableEmpty />}
                                    footer={<PaginationBar alwaysShow current={taskPage} pageSize={20} total={taskTotal} onChange={(page) => setTaskPage(page)} pageSizeOptions={[20]} />}
                                />
                            ),
                        },
                        {
                            key: "audit",
                            label: `管理操作 ${detail.counts.auditEvents}`,
                            children: (
                                <AdminDataTable
                                    table={{
                                        rowKey: "id",
                                        size: "small",
                                        dataSource: events,
                                        pagination: false,
                                        columns: [
                                        { title: "时间", dataIndex: "createdAt", width: 170, render: formatTime },
                                        { title: "管理员", dataIndex: "actorUserId", width: 160, ellipsis: true },
                                        { title: "动作", dataIndex: "action", width: 160 },
                                        { title: "摘要", dataIndex: "summary", ellipsis: true },
                                        ],
                                        scroll: { x: 720 },
                                    }}
                                    empty={<AdminTableEmpty />}
                                    footer={<PaginationBar alwaysShow current={auditPage} pageSize={20} total={auditTotal} onChange={(page) => setAuditPage(page)} pageSizeOptions={[20]} />}
                                />
                            ),
                        },
                    ]}
                />
            ) : (
                <AdminEmpty size="compact" title="没有用户详情" />
            )}
        </AdminDrawer>
    );
}

function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--";
}

type MembershipAction = "grant" | "upgrade";

function UserMembershipSection({ detail, onUpdated }: { detail: AdminUserDetail; onUpdated: () => void }) {
    const { message } = App.useApp();
    const [open, setOpen] = useState(false);
    const [action, setAction] = useState<MembershipAction>("grant");
    const [plans, setPlans] = useState<MembershipPlan[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [form] = Form.useForm<{ planId?: string; months?: number; note?: string }>();

    const openAction = async (next: MembershipAction) => {
        setAction(next);
        setOpen(true);
        try {
            const result = await listAdminMembershipPlans();
            setPlans(result.plans);
            form.setFieldValue("planId", next === "upgrade" ? result.plans.find((plan) => plan.level > 1)?.id || result.plans[0]?.id : detail.membership?.planId || result.plans[0]?.id);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取会员等级失败");
        }
    };

    const submit = async () => {
        const values = await form.validateFields();
        const planId = String(values.planId || "");
        if (!planId) return;
        setSubmitting(true);
        try {
            if (action === "grant") {
                await grantAdminMembership(detail.user.id, { planId, months: Number(values.months) || 1, note: values.note });
                message.success("会员已开通/续费，积分按锚点发放");
            } else {
                await upgradeAdminMembership(detail.user.id, { planId, note: values.note });
                message.success("会员已升级，补差积分已入会员池");
            }
            setOpen(false);
            onUpdated();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "操作失败");
        } finally {
            setSubmitting(false);
        }
    };

    const cancel = async () => {
        setSubmitting(true);
        try {
            await cancelAdminMembership(detail.user.id, { note: "管理员作废" });
            message.success("会员已作废，已发放积分保留到自然过期");
            onUpdated();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "作废失败");
        } finally {
            setSubmitting(false);
        }
    };

    const membership = detail.membership;
    return (
        <div className="rounded-md border border-border p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                    <Crown className="size-4 text-primary" />
                    会员
                </div>
                <div className="flex items-center gap-2">
                    <Button size="small" onClick={() => void openAction("grant")}>{membership ? "续费" : "开通"}</Button>
                    <Button size="small" disabled={!membership} onClick={() => void openAction("upgrade")}>升级</Button>
                    <Button size="small" danger disabled={!membership} loading={submitting} onClick={() => void cancel()}>作废</Button>
                </div>
            </div>
            {membership ? (
                <div className="text-xs text-foreground/70">
                    当前：{detail.membershipName || membership.planId} · {new Date(membership.periodStart).toLocaleDateString("zh-CN")} ~ {new Date(membership.periodEnd).toLocaleDateString("zh-CN")} · 已发放 {membership.grantedMonths} 个窗口
                    {membership.note ? ` · 备注：${membership.note}` : ""}
                </div>
            ) : (
                <div className="text-xs text-foreground/50">暂无生效中的会员。</div>
            )}
            <Modal
                title={action === "grant" ? (membership ? "续费会员" : "开通会员") : "升级会员"}
                open={open}
                onCancel={() => setOpen(false)}
                onOk={() => void submit()}
                confirmLoading={submitting}
                okText={action === "grant" ? "确认开通" : "确认升级"}
                destroyOnHidden
            >
                <Form form={form} layout="vertical" className="mt-2">
                    <Form.Item noStyle shouldUpdate={(prev, next) => prev.planId !== next.planId}>
                        {() => {
                            const selectedPlan = plans.find((plan) => plan.id === form.getFieldValue("planId"));
                            return selectedPlan && selectedPlan.monthlyGrantMicrocredits <= 0 ? (
                                <p className="mb-2 text-xs text-amber-500">注意：该等级的每月到账积分为 0，开通后本期不会发放积分；请先在会员管理里调整额度，或开通后作废重开。</p>
                            ) : null;
                        }}
                    </Form.Item>
                    <Form.Item name="planId" label="会员等级" rules={[{ required: true, message: "请选择等级" }]}>
                        <Select
                            options={plans.map((plan) => ({
                                value: plan.id,
                                label: `${plan.name}（Level ${plan.level} · 每月 ${formatCredits(plan.monthlyGrantMicrocredits)} 积分）`,
                                disabled: action === "upgrade" && detail.membership ? plan.level <= 0 && plan.id === detail.membership.planId : false,
                            }))}
                        />
                    </Form.Item>
                    {action === "grant" ? (
                        <Form.Item name="months" label="周期（月）" initialValue={1} rules={[{ required: true, message: "请填写周期" }]}>
                            <Input type="number" min={1} max={36} placeholder="1-36" />
                        </Form.Item>
                    ) : (
                        <p className="text-xs text-foreground/60">升级立即生效：补差 = 新等级月额度 − 旧等级月额度，整额补进会员池，有效期跟随当前会员池。</p>
                    )}
                    <p className="text-xs text-foreground/50">发放按开通当天的等级额度执行，之后调整等级额度不重算已发放的窗口。</p>
                    <Form.Item name="note" label="备注（写入审计）">
                        <Input maxLength={100} placeholder="选填" />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
}

function taskStatusTone(value?: string): AdminStatusTone {
    const normalized = String(value || "").toLowerCase();
    if (["completed", "succeeded", "success", "done"].includes(normalized)) return "success";
    if (["failed", "error", "cancelled", "canceled"].includes(normalized)) return "error";
    if (["running", "processing", "pending", "queued"].includes(normalized)) return "warning";
    return "neutral";
}

function quotaUsageItems(detail: AdminUserDetail) {
    const structuredBytes = detail.storageUsage.assetBytes + detail.storageUsage.canvasBytes;
    const bytes = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GB` : `${(value / 1024 ** 2).toFixed(1)} MB`;
    const number = (value: number) => new Intl.NumberFormat("zh-CN").format(value);
    return [
        { label: "资源与附件", value: detail.storedFileBytes, limit: detail.quota.storedFileGB * 1024 ** 3, display: `${bytes(detail.storedFileBytes)} / ${detail.quota.storedFileGB} GB` },
        { label: "今日上传（UTC）", value: detail.dailyUploadBytes, limit: detail.quota.dailyUploadMB * 1024 ** 2, display: `${bytes(detail.dailyUploadBytes)} / ${detail.quota.dailyUploadMB} MB` },
        { label: "画布、素材与会话数据", value: structuredBytes, limit: detail.quota.structuredDataMB * 1024 ** 2, display: `${bytes(structuredBytes)} / ${detail.quota.structuredDataMB} MB` },
        { label: "任务与请求日志数据", value: detail.storageUsage.taskBytes, limit: detail.quota.taskDataGB * 1024 ** 3, display: `${bytes(detail.storageUsage.taskBytes)} / ${detail.quota.taskDataGB} GB` },
        { label: "素材数量", value: detail.storageUsage.assetCount, limit: detail.quota.assetCount, display: `${number(detail.storageUsage.assetCount)} / ${number(detail.quota.assetCount)}` },
        { label: "画布数量", value: detail.storageUsage.canvasCount, limit: detail.quota.canvasCount, display: `${number(detail.storageUsage.canvasCount)} / ${number(detail.quota.canvasCount)}` },
        { label: "任务历史数量", value: detail.storageUsage.taskCount, limit: detail.quota.taskCount, display: `${number(detail.storageUsage.taskCount)} / ${number(detail.quota.taskCount)}` },
        { label: "上游请求日志数量", value: detail.storageUsage.apiCallCount, limit: detail.quota.apiCallLogCount, display: `${number(detail.storageUsage.apiCallCount)} / ${number(detail.quota.apiCallLogCount)}` },
    ];
}
