/** Public video metadata is separate from the source page and poster. */
export function seedanceVideoURL(item) {
    if (item.mediaType !== "video" || typeof item.mediaUrl !== "string") return;
    try {
        const url = new URL(item.mediaUrl);
        if (url.protocol === "https:" && !url.username && !url.password) return url.href;
    } catch {
        /* Missing or malformed upstream media leaves the source-page fallback available. */
    }
}
