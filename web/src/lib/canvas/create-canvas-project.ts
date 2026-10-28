import { getActiveUserScope } from "@/lib/user-scope";
import { createCanvasProjectWithRemoteSync } from "@/services/user-data-sync";
import { flushCanvasStorePersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";

/** 工作台和最近画布共用的空白画布创建入口；账号切换时不把新画布带到另一个账号。 */
export async function createBlankCanvasProject() {
    const userId = useUserStore.getState().user?.id;
    if (!userId) throw new Error("请先登录");
    const scope = getActiveUserScope();
    const { id, syncError } = await createCanvasProjectWithRemoteSync("未命名画布");
    await flushCanvasStorePersistence();
    if (getActiveUserScope() !== scope || useUserStore.getState().user?.id !== userId) throw new Error("账号已切换，请重新创建画布");
    return { id, syncError, scope };
}
