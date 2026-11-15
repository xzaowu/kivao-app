import { expect, test } from "bun:test";
import { reconcileWorkbenchReferenceSlots, workbenchReferenceIssue } from "../src/pages/workbench/workbench-input";
import type { WorkbenchTool } from "../src/services/api/workbench";

const tool: WorkbenchTool = {
    id: "scene",
    kind: "video",
    categoryId: "video",
    name: "场景",
    description: "",
    sortOrder: 0,
    enabled: true,
    presets: [],
    inputContract: {
        promptRequired: true,
        minTextReferences: 0,
        slots: [
            { key: "image", name: "图片", mediaTypes: ["image"], minCount: 0, maxCount: 1, required: false },
            { key: "sound", name: "声音", mediaTypes: ["audio"], minCount: 0, maxCount: 1, required: false },
        ],
    },
};

test("目录重分配优先保留有效绑定，无法分配的素材保留且未分配", () => {
    const references = [
        { id: "old", kind: "image" as const, slotKey: "removed" },
        { id: "valid", kind: "image" as const, slotKey: "image" },
        { id: "audio", kind: "audio" as const, slotKey: "removed" },
    ];
    const result = reconcileWorkbenchReferenceSlots(tool, references);
    expect(result).toEqual([{ id: "old", kind: "image", slotKey: undefined }, references[1], { id: "audio", kind: "audio", slotKey: "sound" }]);
    expect(result[1]).toBe(references[1]);
    expect(workbenchReferenceIssue(tool, result)).toContain("有素材尚未匹配");
});

test("槽位类型改变会解除旧绑定，不删除媒体；下架场景保留全部素材", () => {
    const references = [{ kind: "video" as const, slotKey: "image" }];
    expect(reconcileWorkbenchReferenceSlots(tool, references)).toEqual([{ kind: "video", slotKey: undefined }]);
    expect(reconcileWorkbenchReferenceSlots(null, references)).toEqual([{ kind: "video", slotKey: undefined }]);
    expect(workbenchReferenceIssue(tool, references)).toContain("有素材尚未匹配");
});

test("失效槽位存在多个同类型目标时不猜测素材用途", () => {
    const ambiguous = structuredClone(tool);
    ambiguous.inputContract!.slots.push({ key: "portrait", name: "人像", mediaTypes: ["image"], minCount: 0, maxCount: 2, required: false });
    expect(reconcileWorkbenchReferenceSlots(ambiguous, [{ kind: "image", slotKey: "removed" }])).toEqual([{ kind: "image", slotKey: undefined }]);
});

test("原槽位缩容超出的素材不自动移到其它同类型槽位", () => {
    const shrunk = structuredClone(tool);
    shrunk.inputContract!.slots.push({ key: "portrait", name: "人像", mediaTypes: ["image"], minCount: 0, maxCount: 2, required: false });
    const result = reconcileWorkbenchReferenceSlots(shrunk, [
        { id: "one", kind: "image", slotKey: "image" },
        { id: "two", kind: "image", slotKey: "image" },
    ]);
    expect(result).toEqual([
        { id: "one", kind: "image", slotKey: "image" },
        { id: "two", kind: "image", slotKey: undefined },
    ]);
    expect(workbenchReferenceIssue(shrunk, result)).toContain("有素材尚未匹配");
});

test("槽位超量及模型的图片、视频、音频上限均会拦截", () => {
    expect(
        workbenchReferenceIssue(tool, [
            { kind: "image", slotKey: "image" },
            { kind: "image", slotKey: "image" },
        ]),
    ).toContain("最多支持 1 个素材");
    for (const kind of ["image", "video", "audio"] as const) {
        expect(workbenchReferenceIssue(null, [{ kind }], { image: 0, video: 0, audio: 0 })).toContain("不支持参考");
        expect(workbenchReferenceIssue(null, [{ kind }, { kind }], { image: 1, video: 1, audio: 1 })).toContain("最多支持 1 个");
        expect(workbenchReferenceIssue(null, [{ kind }], { image: 1, video: 1, audio: 1 })).toBeUndefined();
    }
});
