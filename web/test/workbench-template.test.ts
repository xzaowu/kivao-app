import { describe, expect, test } from "bun:test";
import { invalidWorkbenchSlot, orderedWorkbenchReferences, renderWorkbenchTemplate, workbenchReferenceLabels, workbenchSlotReferences, workbenchTaskLabel } from "../src/lib/workbench-template";
import { normalizeCanvasNodeMentionTokens } from "../src/lib/canvas/canvas-resource-references";
import type { WorkbenchTool } from "../src/services/api/workbench";
import type { GenerationTask } from "../src/services/api/task-center";

const tool: WorkbenchTool = {
    id: "product",
    kind: "video",
    categoryId: "product",
    name: "商品展示",
    description: "",
    subtitle: "",
    sortOrder: 0,
    enabled: true,
    presets: [],
    inputContract: {
        promptRequired: true,
        minTextReferences: 0,
        slots: [
            { key: "product", name: "商品原图", mediaTypes: ["image"], resourceKind: "asset", required: true, minCount: 1, maxCount: 4 },
            { key: "motion", name: "动作参考", mediaTypes: ["video", "audio"], resourceKind: "asset", required: false, minCount: 0, maxCount: 4 },
        ],
    },
};
const refs = [
    { id: "v", kind: "video" as const, slotKey: "motion", resourceId: "v" },
    { id: "a", kind: "audio" as const, slotKey: "motion", resourceId: "a" },
    { id: "p1", kind: "image" as const, slotKey: "product", resourceId: "p1" },
    { id: "p2", kind: "image" as const, slotKey: "product", resourceId: "p2" },
];

describe("workbench material groups", () => {
    test("admin mentions bind stable slot keys, including spaces and unicode", () => {
        const slot = { ...tool.inputContract!.slots[0], key: "商品 [原图]" };
        const reference = workbenchSlotReferences([slot])[0];
        expect(reference.label).toBe("商品原图");
        expect(invalidWorkbenchSlot(reference.mentionToken!, [slot])).toBe("");
        expect(invalidWorkbenchSlot(reference.mentionToken!, [])).toContain("已移除");
        expect(invalidWorkbenchSlot("@[workbench-slot:%broken]", [slot])).toContain("无法识别");
        expect(invalidWorkbenchSlot("@[workbench-slot:", [slot])).toContain("不完整");
    });

    test("orders by slot and numbers each media kind separately", () => {
        const ordered = orderedWorkbenchReferences(tool, refs);
        expect(ordered.map((ref) => ref.id)).toEqual(["p1", "p2", "v", "a"]);
        expect([...workbenchReferenceLabels(ordered).values()]).toEqual(["图片1", "图片2", "视频1", "音频1"]);
        expect(refs[0].id).toBe("v");
        const result = renderWorkbenchTemplate("@[workbench-slot:product] 是商品原片；参考 @[workbench-slot:motion]。", tool, refs, "背景为白色");
        expect(result).toEqual({ prompt: "商品原图（@图片1、@图片2） 是商品原片；参考 动作参考（@视频1、@音频1）。\n\n用户补充：\n背景为白色", error: "" });
    });

    test("rename, deletion, replacement and pending uploads never keep stale numbering", () => {
        const renamed = { ...tool, inputContract: { ...tool.inputContract!, slots: tool.inputContract!.slots.map((slot) => ({ ...slot, name: slot.key === "product" ? "产品照片" : slot.name })) } };
        const template = "@[workbench-slot:product] / @[workbench-slot:motion]";
        const remaining = [
            { ...refs[3], id: "new", resourceId: "replacement" },
            { ...refs[2], uploading: true },
        ];
        expect(renderWorkbenchTemplate(template, renamed, remaining, "").prompt).toBe("产品照片（@图片1） / 动作参考（未提供）");
        expect(renderWorkbenchTemplate(template, renamed, [], "").prompt).toBe("产品照片（未提供） / 动作参考（未提供）");
        expect(renderWorkbenchTemplate("@[workbench-slot:deleted]", tool, refs, "").error).toContain("已移除");
    });

    test("existing built-in templates and direct creation remain usable", () => {
        expect(renderWorkbenchTemplate("保持参考图1的外观", tool, refs, "").prompt).toBe("保持参考图1的外观");
        expect(orderedWorkbenchReferences(null, refs)).toEqual(refs);
        const references = workbenchSlotReferences(tool.inputContract!.slots).map((ref) => ({ ...ref, nodeId: "p2", label: "图片2" }));
        expect(normalizeCanvasNodeMentionTokens("使用 @[node:p2]", references)).toBe("使用 @图片2");
    });
});

test("workbench task summaries hide templates while direct tasks retain prompts", () => {
    const context = { workbenchToolId: "t", workbenchToolName: "商品白底图", workbenchPresetId: "p", workbenchPresetName: "标准主视觉", workbenchReferenceCount: 2 };
    const task = { prompt: "ADMIN TEMPLATE", clientContext: context } as GenerationTask;
    expect(workbenchTaskLabel(task)).toBe("商品白底图 · 标准主视觉 · 2 个素材");
    expect(workbenchTaskLabel({ prompt: "手工描述" } as GenerationTask)).toBe("手工描述");
    expect(workbenchTaskLabel({ prompt: "ADMIN TEMPLATE", inputJson: JSON.stringify({ metadata: { source: "workbench", ...context, workbench: { references: [{}, {}] } } }) } as GenerationTask)).toBe(workbenchTaskLabel(task));
});
