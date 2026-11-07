import type { InspirationEntry } from "@/services/api/inspirations";

export function filterInspirationHall(items: InspirationEntry[], mode: string, category: string, search: string, sort: string) {
    const query = search.trim().toLocaleLowerCase();
    return items
        .filter((item) => (mode === "all" || item.mode === mode) && (category === "all" || item.category === category) && (!query || [item.title, item.description, item.category, item.prompt].join(" ").toLocaleLowerCase().includes(query)))
        .sort((a, b) => (sort === "title" ? a.title.localeCompare(b.title, "zh-CN") : a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)));
}
