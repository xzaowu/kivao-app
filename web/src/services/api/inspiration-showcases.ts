import { http } from "./request";

export type InspirationExample = {
    resourceId: string;
    type: "image" | "video";
    title: string;
    description: string;
    mediaUrl?: string;
};

export type InspirationShowcase = {
    inspirationId: string;
    title: string;
    enabled: boolean;
    examples: InspirationExample[];
};

export const inspirationShowcasesQueryKey = ["public", "inspiration-showcases"] as const;

export async function getInspirationShowcases(admin = false, signal?: AbortSignal) {
    const path = admin ? "/admin/settings/inspiration-showcases" : "/public/inspirations/showcases";
    return (await http.get<{ showcases: InspirationShowcase[] }>(path, { signal })).showcases;
}

export async function saveInspirationShowcase(value: InspirationShowcase) {
    return (await http.put<{ showcase: InspirationShowcase }>("/admin/settings/inspiration-showcases", value)).showcase;
}

export function inspirationExamplePreviewURL(id: string) {
    return `/api/admin/settings/inspiration-showcases/media/${encodeURIComponent(id)}`;
}

export async function uploadInspirationExample(type: "image" | "video", file: File) {
    const body = new FormData();
    body.append("file", file);
    return (await http.post<{ resource: { id: string; kind: "image" | "video" } }>(`/admin/settings/inspiration-showcases/assets/${type}`, body)).resource;
}
