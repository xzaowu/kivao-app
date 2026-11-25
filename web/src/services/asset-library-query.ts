import { workspaceTeamId } from "@/lib/workspace-routes";
import { loadAssetLibraryPage } from "@/services/user-data-sync";

export const ASSET_LIBRARY_QUERY_KEY = ["asset-library"] as const;

type AssetPageOptions = Omit<Parameters<typeof loadAssetLibraryPage>[0], "signal">;

/** The library and picker may share a page only when every server filter matches. */
export function assetLibraryPageQuery(userId: string | undefined, options: AssetPageOptions) {
    const { page, pageSize, kind, category, folderId, uncategorized, status = "active", query } = options;
    return {
        queryKey: [...ASSET_LIBRARY_QUERY_KEY, userId || "", workspaceTeamId || "", page, pageSize, status, kind || "", category || "", folderId || "", Boolean(uncategorized), query || ""] as const,
        queryFn: async ({ signal }: { signal: AbortSignal }) => ({
            source: "library" as const,
            ...(await loadAssetLibraryPage({ ...options, status, signal })),
        }),
        staleTime: 60_000,
        gcTime: 15 * 60_000,
    };
}

export function isAssetLibraryQueryScope(key: readonly unknown[] | undefined, userId: string | undefined) {
    return Boolean(userId) && key?.[0] === ASSET_LIBRARY_QUERY_KEY[0] && key[1] === userId && key[2] === (workspaceTeamId || "");
}
