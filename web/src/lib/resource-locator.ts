import { resourceFileUrl, resourceIdFromFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";

export function isStoredMediaLocator(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return true;
    if (/^data:(image|video|audio)\//i.test(trimmed)) return true;
    if (trimmed.startsWith("blob:")) return true;
    if (/^https?:\/\//i.test(trimmed)) return true;
    return Boolean(resourceIdFromFileUrl(trimmed));
}

export function rewriteStoredResourceLocators(payload: Record<string, unknown>, storageKey: string) {
    const resourceId = resourceIdFromStorageKey(storageKey);
    if (!resourceId) throw new Error(`远端资源引用无效：${storageKey}`);
    const url = resourceFileUrl(resourceId);
    payload.storageKey = storageKey;
    for (const key of ["dataUrl", "url", "coverUrl"]) {
        if (typeof payload[key] === "string") payload[key] = url;
    }
    if (typeof payload.content === "string" && payload.content.trim() && isStoredMediaLocator(payload.content)) {
        payload.content = url;
    }
    return payload;
}

export function isBareResourceFileUrl(value: string) {
    const trimmed = value.trim();
    if (!trimmed || /\s/.test(trimmed)) return false;
    return Boolean(resourceIdFromFileUrl(trimmed));
}
