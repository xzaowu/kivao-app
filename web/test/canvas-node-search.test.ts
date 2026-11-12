import { describe, expect, test } from "bun:test";

import { canvasNodeMaterialSummary, canvasNodeSearchContext, canvasNodeSearchTimes, searchCanvasNodes } from "@/lib/canvas/canvas-node-search";
import { normalizeCanvasNodeTimestamps, stampCanvasNodeChanges, updateCanvasNodes } from "@/lib/canvas/canvas-node-timestamps";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { createStoryboardRow } from "@/lib/canvas/canvas-project-domain";

function node(id: string, patch: Partial<CanvasNodeData> = {}): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: id,
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: {},
        ...patch,
    };
}

describe("canvas node timestamps", () => {
    test("legacy nodes receive the project timestamp baseline", () => {
        const normalized = normalizeCanvasNodeTimestamps([node("legacy")], {
            createdAt: "2026-08-01T01:00:00.000Z",
            updatedAt: "2026-08-20T02:00:00.000Z",
        });
        expect(normalized[0]?.createdAt).toBe("2026-08-01T01:00:00.000Z");
        expect(normalized[0]?.updatedAt).toBe("2026-08-20T02:00:00.000Z");
    });

    test("new nodes and meaningful edits receive timestamps without touching unchanged nodes", () => {
        const created = stampCanvasNodeChanges([], [node("new")], "2026-08-28T01:00:00.000Z");
        expect(created[0]).toMatchObject({ createdAt: "2026-08-28T01:00:00.000Z", updatedAt: "2026-08-28T01:00:00.000Z" });

        const unchanged = created[0]!;
        const edited = { ...unchanged, title: "新标题" };
        const updated = stampCanvasNodeChanges(created, [edited], "2026-08-28T02:00:00.000Z");
        expect(updated[0]?.createdAt).toBe("2026-08-28T01:00:00.000Z");
        expect(updated[0]?.updatedAt).toBe("2026-08-28T02:00:00.000Z");
    });

    test("media hydration does not pretend to be a user edit", () => {
        const previous = node("image", {
            createdAt: "2026-08-28T01:00:00.000Z",
            updatedAt: "2026-08-28T01:00:00.000Z",
            metadata: { storageKey: "resource:1", content: "resource:1" },
        });
        const hydrated = { ...previous, metadata: { ...previous.metadata, content: "blob:preview", naturalWidth: 1920, naturalHeight: 1080 } };
        const updated = stampCanvasNodeChanges([previous], [hydrated], "2026-08-28T02:00:00.000Z");
        expect(updated[0]?.updatedAt).toBe("2026-08-28T01:00:00.000Z");
    });

    test("batches media metadata updates while preserving untouched node references", () => {
        const first = node("first");
        const second = node("second");
        const nodes = [first, second];
        const next = updateCanvasNodes(nodes, new Map([
            ["first", (current) => ({ ...current, metadata: { ...current.metadata, naturalWidth: 1920 } })],
            ["second", (current) => ({ ...current, metadata: { ...current.metadata, naturalHeight: 1080 } })],
        ]), "2026-08-28T03:00:00.000Z");
        expect(next).not.toBe(nodes);
        expect(next[0]).not.toBe(first);
        expect(next[1]).not.toBe(second);
        expect(next[0].metadata?.naturalWidth).toBe(1920);
        expect(next[1].metadata?.naturalHeight).toBe(1080);
    });
});

describe("canvas node search", () => {
    test("finds storyboard dialogue, shot prompts and edited batch cells", () => {
        const row = createStoryboardRow(1, { plotDescription: "雨夜相遇", dialogue: "欢迎回家", videoMotionPrompt: "缓缓推近", imageGenerationPrompt: "蓝色霓虹", narrativeIntent: "重逢", performanceBlocking: "倚窗凝望" });
        const script = node("script", { type: CanvasNodeType.Script, metadata: { storyboard: { rows: [row], visibleColumns: [], referenceNodeIds: [] } } });
        const batch = node("batch", { type: CanvasNodeType.BatchTable, metadata: { batchTable: {
            operation: "creative", concurrency: 1, referenceColumns: [], contentKind: "storyboard", storyboardRows: [row],
            rows: [{ id: "row", enabled: true, inputNodeIds: [], textNodeIds: [], prompt: "航拍山谷", cells: { note: "手绘质感" } }],
        } } });
        for (const keyword of ["雨夜相遇", "欢迎回家", "缓缓推近", "蓝色霓虹", "重逢", "倚窗凝望"]) {
            expect(searchCanvasNodes([script, batch], keyword).map((item) => item.id)).toEqual(["script", "batch"]);
        }
        expect(searchCanvasNodes([script, batch], "航拍山谷").map((item) => item.id)).toEqual(["batch"]);
        expect(searchCanvasNodes([script, batch], "手绘质感").map((item) => item.id)).toEqual(["batch"]);
        expect(searchCanvasNodes([script, batch], "未出现的文本")).toEqual([]);
    });

    test("defaults to recently edited order and searches model or tags", () => {
        const older = node("older", { updatedAt: "2026-08-20T01:00:00.000Z", metadata: { model: "wan-video", assetTags: ["夜景"] } });
        const newer = node("newer", { updatedAt: "2026-08-28T01:00:00.000Z", metadata: { model: "seedance" } });
        expect(searchCanvasNodes([older, newer], "").map((item) => item.id)).toEqual(["newer", "older"]);
        expect(searchCanvasNodes([older, newer], "夜景").map((item) => item.id)).toEqual(["older"]);
        expect(searchCanvasNodes([older, newer], "seedance").map((item) => item.id)).toEqual(["newer"]);
    });

    test("summaries expose useful media metadata without leaking data URLs into context", () => {
        const image = node("image", {
            createdAt: "2026-08-28T01:00:00.000Z",
            updatedAt: "2026-08-28T02:00:00.000Z",
            metadata: { content: "data:image/png;base64,AAAA", naturalWidth: 1920, naturalHeight: 1080, bytes: 2 * 1024 * 1024, model: "image-model" },
        });
        expect(canvasNodeMaterialSummary(image)).toContain("1920×1080");
        expect(canvasNodeSearchContext(image)).toBe("图片节点");
        expect(canvasNodeSearchTimes(image)).toMatchObject({ createdAt: image.createdAt, updatedAt: image.updatedAt });
    });
});
