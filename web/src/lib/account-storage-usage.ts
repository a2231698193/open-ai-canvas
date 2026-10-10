import { formatBytes } from "@/lib/image-utils";
import type { AccountFileStorageUsage } from "@/services/api/resources";

export const accountFileStorageUsageQueryKey = ["account-file-storage-usage"] as const;

export type AccountStorageTone = "ok" | "warn" | "critical";

export type AccountStorageMeter = {
    percent: number;
    remainingBytes: number;
    usedLabel: string;
    totalLabel: string;
    remainingLabel: string;
    percentLabel: string;
    tone: AccountStorageTone;
    full: boolean;
};

export function formatStorageBytes(value: number) {
    return formatBytes(value) || "0 B";
}

// 会员等级 -1（不限制）在接口里表现为哨兵大值（1 EiB）；展示为「不限」而不是天文数字。
// 注意 JS 位运算是 32 位，必须用 2 ** 50 而不是 1 << 50。
export const UNLIMITED_STORAGE_BYTES = 2 ** 50;

export function accountStorageMeter(usage?: AccountFileStorageUsage | null): AccountStorageMeter {
    const usedBytes = usage && Number.isFinite(usage.usedBytes) ? Math.max(0, usage.usedBytes) : 0;
    const totalBytes = usage && Number.isFinite(usage.totalBytes) ? Math.max(0, usage.totalBytes) : 0;
    const unlimited = totalBytes >= UNLIMITED_STORAGE_BYTES;
    const remainingBytes = unlimited ? Number.MAX_SAFE_INTEGER : Math.max(0, totalBytes - usedBytes);
    const percent = totalBytes > 0 && !unlimited ? Math.min(100, (usedBytes / totalBytes) * 100) : 0;
    const full = !unlimited && totalBytes > 0 && usedBytes >= totalBytes;
    const tone: AccountStorageTone = full || percent >= 90 ? "critical" : percent >= 70 ? "warn" : "ok";

    return {
        percent,
        remainingBytes,
        usedLabel: formatStorageBytes(usedBytes),
        totalLabel: unlimited ? "不限" : formatStorageBytes(totalBytes),
        remainingLabel: unlimited ? "不限" : formatStorageBytes(remainingBytes),
        percentLabel: unlimited ? "不限" : usedBytes && percent < 0.1 ? "<0.1%" : `${Math.round(percent * 10) / 10}%`,
        tone,
        full,
    };
}
