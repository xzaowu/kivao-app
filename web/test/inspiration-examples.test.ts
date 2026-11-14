import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolveInspirationExamples } from "../src/lib/inspirations/examples";
import type { CreationInspiration } from "../src/lib/inspirations/catalog";
import { seedanceVideoURL } from "../scripts/inspiration-media.mjs";

const item: CreationInspiration = { id: "seedance:sample", title: "效果示例", description: "", image: "/inspiration-thumbs/sample.webp", mode: "image", prompt: "测试提示词", sourceUrl: "https://example.com/source" };

describe("inspiration example sources", () => {
    test("image covers are examples without an administrator upload", () => {
        expect(resolveInspirationExamples(item)[0]).toMatchObject({ type: "image", mediaUrl: item.image, sourceUrl: item.sourceUrl });
    });
    test("video examples use the actual media URL, retaining the poster and source page", () => {
        expect(resolveInspirationExamples({ ...item, mode: "video", videoUrl: "https://media.example.com/video.mp4" })[0]).toMatchObject({ type: "video", mediaUrl: "https://media.example.com/video.mp4", posterUrl: item.image });
        expect(resolveInspirationExamples({ ...item, mode: "video" })).toEqual([]);
        expect(resolveInspirationExamples({ ...item, mode: "text" })).toEqual([]);
    });
    test("administrator examples take priority, including their order and captions", () => {
        const configured = [{ resourceId: "admin-media", type: "video" as const, title: "自有成品", description: "说明", mediaUrl: "/api/public/inspirations/showcases/media/admin-media" }];
        expect(resolveInspirationExamples(item, configured)).toEqual([{ id: "admin-media", type: "video", title: "自有成品", description: "说明", mediaUrl: configured[0].mediaUrl }]);
    });
    test("source pages and unsafe URLs are never interpreted as playable media", () => {
        expect(resolveInspirationExamples({ ...item, mode: "video", videoUrl: "javascript:alert(1)" })).toEqual([]);
        expect(resolveInspirationExamples({ ...item, image: "//untrusted.example/image" })).toEqual([]);
        expect(seedanceVideoURL({ mediaType: "video", mediaUrl: "https://name:password@example.com/video.mp4" })).toBeUndefined();
        expect(seedanceVideoURL({ mediaType: "image", mediaUrl: "https://example.com/image.png" })).toBeUndefined();
        expect(seedanceVideoURL({ mediaType: "video", mediaUrl: "https://example.com/video.mp4" })).toBe("https://example.com/video.mp4");
    });
    test("the frozen catalog retains media metadata without changing source revisions", () => {
        const catalog = JSON.parse(readFileSync(new URL("../public/inspirations/seedance.json", import.meta.url), "utf8"));
        expect(catalog.revision).toBe("487c166e2f09487016452b90fec5e19a470af883");
        expect(catalog.entries).toHaveLength(767);
        for (const entry of catalog.entries) expect(entry.videoUrl).toStartWith("https://");
    });
});
