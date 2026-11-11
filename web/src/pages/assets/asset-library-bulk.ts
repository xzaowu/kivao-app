import { getActiveUserScope } from "@/lib/user-scope";
import { listRemoteAssetsPage } from "@/services/api/user-data";
import { deleteAssetsWithRemoteSync, saveRemoteUserDataNow } from "@/services/user-data-sync";
import { flushAssetStorePersistence, useAssetStore } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";

/** Collect the complete set before deletion changes page offsets. Never fall back to a partial cache. */
export async function collectAssetLibraryIds(status: "active" | "archived", userId: string, pageSize: number) {
    const scope = getActiveUserScope();
    const checkAccount = () => {
        if ((useUserStore.getState().user?.id || "") !== userId || getActiveUserScope() !== scope) throw new Error("账号已切换，请重新操作素材");
    };
    checkAccount();
    if (!userId) return useAssetStore.getState().assets.filter((asset) => (asset.status === "archived") === (status === "archived")).map((asset) => asset.id);

    await flushAssetStorePersistence();
    checkAccount();
    await saveRemoteUserDataNow([]);
    checkAccount();
    const ids = new Set<string>();
    for (let page = 1; ; page++) {
        checkAccount();
        const result = await listRemoteAssetsPage({ page, pageSize, status });
        checkAccount();
        for (const asset of result.assets) ids.add(asset.id);
        if (!result.hasMore) return [...ids];
    }
}

export async function deleteAssetLibraryTrash(userId: string, pageSize: number, onDeleted: (count: number) => void) {
    const scope = getActiveUserScope();
    const ids = await collectAssetLibraryIds("archived", userId, pageSize);
    let deleted = 0;
    for (let offset = 0; offset < ids.length; offset += pageSize) {
        if ((useUserStore.getState().user?.id || "") !== userId || getActiveUserScope() !== scope) throw new Error("账号已切换，请重新清空回收站");
        const batch = ids.slice(offset, offset + pageSize);
        await deleteAssetsWithRemoteSync(batch);
        deleted += batch.length;
        onDeleted(deleted);
    }
    return deleted;
}
