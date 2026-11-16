import { catalogIdOf, type CreationInspiration } from "@/lib/inspirations/catalog";
import { apiBaseURL } from "./request";

/** 本地个人覆盖和管理员上传的图片不属于服务器目录缓存。 */
export function inspirationCoverURL(item: CreationInspiration, catalogImage?: string): string {
    if (item.image !== catalogImage || !["seedance", "haohaoxue", "youmind"].includes(item.sourceId ?? "")) return item.image;
    try {
        const url = new URL(item.image);
        if (url.protocol !== "https:" || url.username || url.password) return item.image;
        return `${apiBaseURL.replace(/\/$/, "")}/public/inspirations/covers/${encodeURIComponent(catalogIdOf(item))}`;
    } catch {
        return item.image;
    }
}
