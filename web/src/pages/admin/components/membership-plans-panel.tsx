import { useEffect, useState } from "react";
import { App, Button, Form, Input, Modal, Switch } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Crown } from "lucide-react";

import { formatCredits } from "@/constant/credits";
import { ApiError } from "@/services/api/request";
import { listAdminMembershipPlans, saveAdminMembershipPlan, type AdminMembershipPlanInput, type MembershipPlan } from "@/services/api/membership";
import { AdminDataTable, AdminStatusBadge, AdminTableEmpty } from "./admin-ui";

const MICRO_CREDITS_PER_CREDIT = 1_000_000;

type PlanFormValues = {
    name?: string;
    level?: number;
    enabled?: boolean;
    sortOrder?: number;
    monthlyGrantCredits?: number;
    activeTaskLimit?: number;
    storageGB?: number;
    dailyUploadGB?: number;
    checkinBonusCredits?: number;
};

export default function MembershipPlansPanel({ createOpen, onCreateOpenChange }: { createOpen: boolean; onCreateOpenChange: (open: boolean) => void }) {
    const { message } = App.useApp();
    const [plans, setPlans] = useState<MembershipPlan[]>([]);
    const [loading, setLoading] = useState(true);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editing, setEditing] = useState<MembershipPlan | null>(null);
    const [saving, setSaving] = useState(false);
    const [form] = Form.useForm<PlanFormValues>();

    const reload = async () => {
        setLoading(true);
        try {
            const result = await listAdminMembershipPlans();
            setPlans(result.plans);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取会员等级失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void reload();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (createOpen) openEditor(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [createOpen]);

    const openEditor = (plan: MembershipPlan | null) => {
        setEditing(plan);
        form.setFieldsValue(
            plan
                ? {
                      name: plan.name,
                      level: plan.level,
                      enabled: plan.enabled,
                      sortOrder: plan.sortOrder,
                      monthlyGrantCredits: plan.monthlyGrantMicrocredits / MICRO_CREDITS_PER_CREDIT,
                      activeTaskLimit: plan.activeTaskLimit,
                      storageGB: plan.storageGB,
                      dailyUploadGB: plan.dailyUploadMB / 1024,
                      checkinBonusCredits: plan.checkinBonusOverrideMicrocredits / MICRO_CREDITS_PER_CREDIT,
                  }
                : { enabled: true, level: plans.length + 1, monthlyGrantCredits: 0, activeTaskLimit: 0, storageGB: 0, dailyUploadGB: 0, checkinBonusCredits: 0 },
        );
        setEditorOpen(true);
        onCreateOpenChange(true);
    };

    const save = async () => {
        const values = await form.validateFields();
        const monthly = Math.round(Number(values.monthlyGrantCredits || 0) * MICRO_CREDITS_PER_CREDIT);
        const checkin = Math.round(Number(values.checkinBonusCredits || 0) * MICRO_CREDITS_PER_CREDIT);
        const dailyUploadMB = Math.round(Number(values.dailyUploadGB || 0) * 1024);
        if (!Number.isSafeInteger(monthly) || !Number.isSafeInteger(checkin)) {
            message.error("积分数值超出允许范围");
            return;
        }
        const input: AdminMembershipPlanInput = {
            id: editing?.id,
            name: String(values.name || "").trim(),
            level: Number(values.level) || 1,
            enabled: Boolean(values.enabled),
            sortOrder: Number(values.sortOrder) || 0,
            monthlyGrantMicrocredits: monthly,
            activeTaskLimit: Number(values.activeTaskLimit) || 0,
            storageGB: Number(values.storageGB) || 0,
            dailyUploadMB,
            checkinBonusOverrideMicrocredits: checkin,
        };
        setSaving(true);
        try {
            const result = await saveAdminMembershipPlan(input);
            message.success(`会员等级「${result.plan.name}」已保存`);
            setEditorOpen(false);
            await reload();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : "保存失败");
        } finally {
            setSaving(false);
        }
    };

    const columns: ColumnsType<MembershipPlan> = [
        { title: "等级", dataIndex: "level", width: 70, render: (value) => <span className="font-semibold tabular-nums">L{value}</span> },
        { title: "名称", dataIndex: "name", width: 140 },
        { title: "状态", dataIndex: "enabled", width: 90, render: (enabled) => <AdminStatusBadge label={enabled ? "启用" : "停用"} tone={enabled ? "success" : "neutral"} /> },
        { title: "每月到账", dataIndex: "monthlyGrantMicrocredits", width: 120, align: "right", render: (value) => `${formatCredits(value)} 积分` },
        { title: "并发任务", dataIndex: "activeTaskLimit", width: 100, render: limitLabel },
        { title: "存储空间", dataIndex: "storageGB", width: 100, render: storageLabel },
        { title: "日上传", dataIndex: "dailyUploadMB", width: 100, render: dailyUploadLabel },
        { title: "签到覆盖", dataIndex: "checkinBonusOverrideMicrocredits", width: 110, render: (value) => (value > 0 ? `${formatCredits(value)} 积分` : "全局默认") },
        {
            title: "操作",
            key: "actions",
            width: 80,
            render: (_, plan) => (
                <Button size="small" type="text" onClick={() => openEditor(plan)}>
                    编辑
                </Button>
            ),
        },
    ];

    return (
        <div className="space-y-4">
            <AdminDataTable
                table={{
                    rowKey: "id",
                    size: "small",
                    loading,
                    dataSource: plans,
                    pagination: false,
                    columns,
                    scroll: { x: 860 },
                }}
                empty={<AdminTableEmpty title="还没有会员等级" description="点击右上角「新建等级」创建第一个会员方案。" />}
            />
            <Modal
                title={
                    <span className="inline-flex items-center gap-2">
                        <Crown className="size-4 text-primary" />
                        {editing ? `编辑等级：${editing.name}` : "新建会员等级"}
                    </span>
                }
                open={editorOpen}
                onCancel={() => setEditorOpen(false)}
                onOk={() => void save()}
                confirmLoading={saving}
                okText="保存"
                destroyOnHidden
                afterClose={() => onCreateOpenChange(false)}
            >
                <Form form={form} layout="vertical" className="mt-2">
                    <div className="grid grid-cols-2 gap-x-4">
                        <Form.Item name="name" label="名称" rules={[{ required: true, message: "请填写名称" }]}>
                            <Input maxLength={40} placeholder="如：专业版" />
                        </Form.Item>
                        <Form.Item name="level" label="等级 Level（越大越高，升级只允许往上）" rules={[{ required: true, message: "请填写等级" }]}>
                            <Input type="number" min={1} max={100} />
                        </Form.Item>
                        <Form.Item name="monthlyGrantCredits" label="每月到账积分（当期清零）" rules={[{ required: true, message: "请填写每月到账积分" }]}>
                            <Input type="number" min={0} step="0.000001" />
                        </Form.Item>
                        <Form.Item name="activeTaskLimit" label="并发任务数（0=全局默认，-1=无限）">
                            <Input type="number" min={-1} />
                        </Form.Item>
                        <Form.Item name="storageGB" label="存储空间 GB（0=全局默认，-1=无限）">
                            <Input type="number" min={-1} />
                        </Form.Item>
                        <Form.Item name="dailyUploadGB" label="日上传 GB（0=全局默认，-1=无限）">
                            <Input type="number" min={-1} step="0.001" />
                        </Form.Item>
                        <Form.Item name="checkinBonusCredits" label="每日签到积分覆盖（0=全局默认）">
                            <Input type="number" min={0} step="0.000001" />
                        </Form.Item>
                        <Form.Item name="sortOrder" label="展示排序">
                            <Input type="number" min={0} />
                        </Form.Item>
                        <Form.Item name="enabled" label="启用" valuePropName="checked">
                            <Switch />
                        </Form.Item>
                    </div>
                    <p className="text-xs text-foreground/55">等级保存即写审计；修改月额度不重算已发放窗口，下次锚点发放起按新额度执行。</p>
                </Form>
            </Modal>
        </div>
    );
}

function limitLabel(limit: number) {
    if (limit < 0) return "无限";
    if (limit === 0) return "全局默认";
    return `${limit} 个`;
}

function storageLabel(gb: number) {
    if (gb < 0) return "不限";
    if (gb === 0) return "全局默认";
    return `${gb}GB`;
}

function dailyUploadLabel(mb: number) {
    if (mb < 0) return "不限";
    if (mb === 0) return "全局默认";
    return mb % 1024 === 0 ? `${mb / 1024}GB/日` : `${mb}MB/日`;
}
