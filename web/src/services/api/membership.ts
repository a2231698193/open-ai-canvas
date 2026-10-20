import { http } from "@/services/api/request";
import type { PaymentOrder } from "@/services/api/payments";

export type MembershipPlan = {
    id: string;
    name: string;
    level: number;
    enabled: boolean;
    sortOrder: number;
    monthlyGrantMicrocredits: number;
    activeTaskLimit: number;
    storageGB: number;
    dailyUploadMB: number;
    checkinBonusOverrideMicrocredits: number;
    monthPriceFen: number;
    quarterPriceFen: number;
    yearPriceFen: number;
    createdAt: string;
    updatedAt: string;
};

export type UserMembership = {
    id: string;
    userId: string;
    planId: string;
    status: "active" | "cancelled";
    periodStart: string;
    periodEnd: string;
    grantedMonths: number;
    note?: string;
    createdAt: string;
    updatedAt: string;
};

export type EffectiveMembership = {
    active: boolean;
    planId?: string;
    planName?: string;
    level: number;
    periodStart?: string;
    periodEnd?: string;
    monthlyGrantMicrocredits: number;
    activeTaskLimit: number;
    storageGB: number;
    dailyUploadMB: number;
    checkinBonusOverrideMicrocredits: number;
};

export type MembershipUpgradeQuote = {
    planId: string;
    amountFen: number;
    remainingDays: number;
    canUpgrade: boolean;
    reason?: string;
};

export type MembershipPlansResult = {
    plans: MembershipPlan[];
    membership?: UserMembership;
    effective: EffectiveMembership;
    paymentAvailable: boolean;
    upgradeQuotes?: Record<string, MembershipUpgradeQuote>;
};

export function getMembershipPlans() {
    return http.get<MembershipPlansResult>("/membership/plans");
}

export type CreateMembershipOrderInput = {
    planId: string;
    months?: number;
    providerId: string;
    idempotencyKey: string;
};

export function createMembershipOrder(input: CreateMembershipOrderInput) {
    return http.post<{ order: PaymentOrder }>("/membership/orders", input);
}

export function getActiveMembershipOrder() {
    return http.get<{ order: PaymentOrder | null }>("/membership/orders/active");
}

export type AdminMembershipPlanInput = {
    id?: string;
    name: string;
    level: number;
    enabled: boolean;
    sortOrder?: number;
    monthlyGrantMicrocredits: number;
    activeTaskLimit?: number;
    storageGB?: number;
    dailyUploadMB?: number;
    checkinBonusOverrideMicrocredits?: number;
    monthPriceFen?: number;
    quarterPriceFen?: number;
    yearPriceFen?: number;
};

export function listAdminMembershipPlans() {
    return http.get<{ plans: MembershipPlan[] }>("/admin/membership/plans");
}

export function saveAdminMembershipPlan(input: AdminMembershipPlanInput) {
    return http.post<{ plan: MembershipPlan }>("/admin/membership/plans", input);
}

export function deleteAdminMembershipPlan(planId: string) {
    return http.delete<{ ok: boolean }>(`/admin/membership/plans/${encodeURIComponent(planId)}`);
}

export function grantAdminMembership(userId: string, input: { planId: string; months: number; note?: string }) {
    return http.post<{ membership: UserMembership }>(`/admin/users/${encodeURIComponent(userId)}/membership/grant`, input);
}

export function upgradeAdminMembership(userId: string, input: { planId: string; note?: string }) {
    return http.post<{ membership: UserMembership }>(`/admin/users/${encodeURIComponent(userId)}/membership/upgrade`, input);
}

export function cancelAdminMembership(userId: string, input: { note?: string }) {
    return http.post<{ ok: boolean }>(`/admin/users/${encodeURIComponent(userId)}/membership/cancel`, input);
}
