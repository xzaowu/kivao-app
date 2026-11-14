import type { InspirationExample } from "@/services/api/inspiration-showcases";
import { catalogIdOf, type CreationInspiration } from "./catalog";

export type InspirationPreview = {
    id: string;
    type: "image" | "video";
    title: string;
    description: string;
    mediaUrl?: string;
    posterUrl?: string;
    sourceUrl?: string;
};

function publicMediaURL(value: string | undefined, local = false): string | undefined {
    if (!value) return;
    if (local && value.startsWith("/") && !value.startsWith("//")) return value;
    try {
        const parsed = new URL(value);
        if (parsed.protocol === "https:" && !parsed.username && !parsed.password) return value;
    } catch {
        /* Malformed catalog URLs are not media sources. */
    }
}

/** Site uploads override catalog examples; an image cover is already an example, a video poster is not. */
export function resolveInspirationExamples(item: CreationInspiration, configured: InspirationExample[] = []): InspirationPreview[] {
    if (configured.length) return configured.map(({ resourceId, ...example }) => ({ ...example, id: resourceId }));
    const id = catalogIdOf(item);
    const sourceUrl = publicMediaURL(item.sourceUrl);
    const image = publicMediaURL(item.image, true);
    if (item.mode === "image" && image) return [{ id: `image:${id}`, type: "image", title: "", description: "", mediaUrl: image, sourceUrl }];
    const video = publicMediaURL(item.videoUrl);
    if (item.mode === "video" && video) return [{ id: `video:${id}`, type: "video", title: "", description: "", mediaUrl: video, posterUrl: image, sourceUrl }];
    return [];
}
