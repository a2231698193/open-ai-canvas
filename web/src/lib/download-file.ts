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
    if (target.startsWith("data:") || target.startsWith("blob:")) {
        saveAs(target, fileName);
        return;
    }
    // 资源文件地址可能 307 到 CDN：先把字节取回来再保存。直接把地址交给 a[download] 会在
    // 重定向到跨域后被浏览器忽略 download 属性，图片会直接在标签页里打开。
    const response = await fetch(target, { credentials: "include" });
    if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`);
    saveAs(await response.blob(), fileName);
}
