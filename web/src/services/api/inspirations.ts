import { http } from "@/services/api/request";

export type InspirationExample = { resourceId: string; mediaKind: "image" | "video" };
export type InspirationExampleView = InspirationExample & { mediaUrl?: string };

export type InspirationInput = {
    version: number;
    type: "prompt" | "tool";
    toolId?: string;
    title: string;
    description: string;
    mode: "image" | "video" | "text";
    category: string;
    prompt: string;
    resourceId?: string;
    mediaKind?: "image" | "video";
    additionalExamples?: InspirationExample[];
    sortOrder: number;
    enabled: boolean;
};
export type InspirationEntry = InspirationInput & { id: string; mediaUrl?: string; toolUnavailable?: boolean; examples?: InspirationExampleView[] };
export function fetchInspirations(admin = false, signal?: AbortSignal) {
    return http.get<{ items: InspirationEntry[] }>(admin ? "/admin/inspirations" : "/inspirations", { signal }).then(({ items }) => items);
}
export function saveInspiration(input: InspirationInput, id?: string) {
    const { version, type, toolId, title, description, mode, category, prompt, resourceId, mediaKind, additionalExamples, sortOrder, enabled } = input;
    const payload = { version, type, toolId, title, description, mode, category, prompt, resourceId, mediaKind, additionalExamples: additionalExamples?.map(({ resourceId, mediaKind }) => ({ resourceId, mediaKind })), sortOrder, enabled };
    return (id ? http.patch<{ item: InspirationEntry }>(`/admin/inspirations/${encodeURIComponent(id)}`, payload) : http.post<{ item: InspirationEntry }>("/admin/inspirations", payload)).then(({ item }) => item);
}
export function deleteInspiration(item: InspirationEntry) {
    return http.delete<{ item: null }>(`/admin/inspirations/${encodeURIComponent(item.id)}`, { params: { version: item.version } });
}
