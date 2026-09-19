import { saveAs } from "file-saver";

import { resourceFileUrl, resourceIdFromFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";

export function mediaDownloadUrl(source: string, fileName?: string, storageKey?: string) {
    const resourceId = resourceIdFromStorageKey(storageKey) || resourceIdFromFileUrl(source);
    if (!resourceId) return source;
    return resourceFileUrl(resourceId, { download: true, fileName });
}

export async function downloadNamedFile(source: string, fileName: string, storageKey?: string) {
    const target = mediaDownloadUrl(source, fileName, storageKey);
    if (!target) throw new Error("没有可下载的文件");
    if (target.startsWith("data:") || target.startsWith("blob:") || isSameOriginUrl(target)) {
        saveAs(target, fileName);
        return;
    }
    const response = await fetch(target, { credentials: "include" });
    if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`);
    saveAs(await response.blob(), fileName);
}

function isSameOriginUrl(url: string) {
    if (typeof window === "undefined") return false;
    try {
        return new URL(url, window.location.href).origin === window.location.origin;
    } catch {
        return false;
    }
}
