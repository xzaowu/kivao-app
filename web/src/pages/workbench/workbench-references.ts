import type { Asset } from "@/stores/use-asset-store";
import { getActiveUserScope } from "@/lib/user-scope";
import { getImageBlob } from "@/services/image-storage";
import { getMediaBlob } from "@/services/file-storage";
import { importResourceFromUrl, resourceIdFromStorageKey, resolveResourceUrl, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";

type MediaKind = "image" | "video" | "audio";
export type WorkbenchMediaAsset = Extract<Asset, { kind: MediaKind }>;
type Reference = { kind: MediaKind; resourceId?: string; slotKey?: string };
export type WorkbenchReferenceLimits = { maxImages: number; maxVideos: number; maxAudios: number };

export function selectWorkbenchReferences<T extends Reference>(candidates: T[], current: Reference[], mediaTypes: readonly string[], maxCount: number, limits: WorkbenchReferenceLimits, slotKey?: string): T[] {
    const counts = { image: current.filter((ref) => ref.kind === "image").length, video: current.filter((ref) => ref.kind === "video").length, audio: current.filter((ref) => ref.kind === "audio").length };
    const slotCount = current.filter((ref) => ref.slotKey === slotKey).length;
    const resourceIds = new Set(
        current
            .filter((ref) => ref.slotKey === slotKey)
            .map((ref) => ref.resourceId)
            .filter(Boolean),
    );
    const selected: T[] = [];
    for (const candidate of candidates) {
        const limit = limits[candidate.kind === "image" ? "maxImages" : candidate.kind === "video" ? "maxVideos" : "maxAudios"];
        if (!mediaTypes.includes(candidate.kind) || selected.length + slotCount >= maxCount || selected.length + current.length >= 20 || counts[candidate.kind] >= limit || (candidate.resourceId && resourceIds.has(candidate.resourceId))) continue;
        selected.push(candidate);
        counts[candidate.kind]++;
        if (candidate.resourceId) resourceIds.add(candidate.resourceId);
    }
    return selected;
}

export async function resolveWorkbenchAsset(asset: WorkbenchMediaAsset) {
    const existing = resourceIdFromStorageKey(asset.data.storageKey);
    if (existing) return { resourceId: existing, previewUrl: resolveResourceUrl(asset.data.storageKey) };
    const scope = getActiveUserScope();
    const meta = { width: "width" in asset.data ? asset.data.width : undefined, height: "height" in asset.data ? asset.data.height : undefined, durationMs: "durationMs" in asset.data ? asset.data.durationMs : undefined };
    let blob = asset.data.storageKey ? await (asset.kind === "image" ? getImageBlob(asset.data.storageKey) : getMediaBlob(asset.data.storageKey)) : null;
    const url = asset.kind === "image" ? asset.data.dataUrl : asset.data.url;
    if (!blob && (url.startsWith("data:") || url.startsWith("blob:"))) {
        const response = await fetch(url);
        if (!response.ok) throw new Error("素材读取失败，请重新上传");
        blob = await response.blob();
    }
    if (getActiveUserScope() !== scope) throw new Error("账号已切换，请重新选择素材");
    const resource = blob ? await uploadResourceFile(blob, asset.kind, { ...meta, fileName: asset.title }) : /^https?:\/\//i.test(url) ? await importResourceFromUrl(url, asset.kind, meta) : null;
    if (!resource) throw new Error("素材文件不可用，请重新上传");
    if (getActiveUserScope() !== scope) throw new Error("账号已切换，请重新选择素材");
    return { resourceId: resource.id, previewUrl: resolveResourceUrl(resourceStorageKey(resource.id)) };
}
