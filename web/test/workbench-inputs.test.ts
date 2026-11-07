import { expect, test } from "bun:test";
import { workbenchSlots, workbenchNoticeEnabled } from "../src/lib/workbench-inputs";
import { missingWorkbenchInput } from "../src/pages/workbench/workbench-input";
import { invalidWorkbenchSlot } from "../src/lib/workbench-template";
import type { WorkbenchPromptPreset, WorkbenchTool } from "../src/services/api/workbench";

const base = { name: "素材", mediaTypes: ["image"] as Array<"image">, required: true, minCount: 1, maxCount: 4 };
const tool = {
    inputContract: {
        promptRequired: false,
        minTextReferences: 0,
        slots: [
            { ...base, key: "common" },
            { ...base, key: "video", common: false },
            { ...base, key: "audio", common: false },
        ],
    },
} as WorkbenchTool;
const effect = (slotKeys?: string[], noticeSlotKeys: string[] = []): WorkbenchPromptPreset => ({ id: "a", name: "A", promptTemplate: "A", defaultParameters: { workbenchInputs: { slotKeys, noticeSlotKeys } } });

test("legacy tools keep all inputs; effects share common inputs and select their own inputs", () => {
    expect(workbenchSlots(tool)).toHaveLength(3);
    expect(workbenchSlots(tool, effect(["video"])).map((slot) => slot.key)).toEqual(["common", "video"]);
    expect(workbenchSlots(tool, effect(["video", "audio"]))).toHaveLength(3);
    expect(workbenchSlots(tool, effect([])).map((slot) => slot.key)).toEqual(["common"]);
    expect(workbenchNoticeEnabled(null, "common")).toBe(false);
    expect(workbenchNoticeEnabled(effect(["video"], ["common"]), "common")).toBe(true);
    expect(workbenchNoticeEnabled(effect(["video"]), "common")).toBe(false);
});

test("only active inputs require uploads or appear in template mentions", () => {
    const active = { ...tool, inputContract: { ...tool.inputContract!, slots: workbenchSlots(tool, effect([])) } };
    expect(missingWorkbenchInput(active, [{ slotKey: "common", resourceId: "saved" }])).toBeUndefined();
    expect(invalidWorkbenchSlot("@[workbench-slot:audio]", active.inputContract.slots)).toContain("已移除");
    expect(invalidWorkbenchSlot("@[workbench-slot:common]", active.inputContract.slots)).toBe("");
});
