import { http } from "@/services/api/request";

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

export type MembershipPlansResult = {
    plans: MembershipPlan[];
    membership?: UserMembership;
    effective: EffectiveMembership;
};

export function getMembershipPlans() {
    return http.get<MembershipPlansResult>("/membership/plans");
}
