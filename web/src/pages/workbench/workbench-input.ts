import type { WorkbenchTool } from "@/services/api/workbench";

export function workbenchVideoOperation(references: ReadonlyArray<{ kind: string; role?: string }>) {
    if (references.some((reference) => reference.kind === "video" || (reference.kind === "image" && reference.role !== "first_frame" && reference.role !== "last_frame"))) return "reference_to_video";
    if (references.some((reference) => reference.kind === "image")) return "image_to_video";
    if (references.some((reference) => reference.kind === "audio")) return "audio_to_video";
    return "text_to_video";
}

export function workbenchPromptRequired(tool: WorkbenchTool | null) {
    return !tool || tool.inputContract?.promptRequired !== false || (tool.inputContract?.minTextReferences || 0) > 0;
}

export function missingWorkbenchInput(tool: WorkbenchTool | null, references: Array<{ slotKey?: string; resourceId?: string; uploading?: boolean; error?: string }>) {
    return tool?.inputContract?.slots.find((slot) => references.filter((reference) => reference.slotKey === slot.key && reference.resourceId && !reference.uploading && !reference.error).length < Math.max(slot.minCount, slot.required ? 1 : 0));
}

type InputReference = { kind: "image" | "video" | "audio"; slotKey?: string };

export function workbenchReferenceSlot(tool: WorkbenchTool | null, reference: InputReference) {
    return tool?.inputContract?.slots.find((slot) => slot.key === reference.slotKey && slot.mediaTypes.includes(reference.kind));
}

/** 保留有效绑定；失效槽位仅匹配唯一目标，不猜测多个同类型槽位的用途。 */
export function reconcileWorkbenchReferenceSlots<T extends InputReference>(tool: WorkbenchTool | null, references: T[]): T[] {
    const slots = tool?.inputContract?.slots || [];
    const used = new Map<string, number>();
    const assigned = references.map((reference) => {
        const slot = workbenchReferenceSlot(tool, reference);
        if (!slot || (used.get(slot.key) || 0) >= slot.maxCount) return undefined;
        used.set(slot.key, (used.get(slot.key) || 0) + 1);
        return slot.key;
    });
    return references.map((reference, index) => {
        let slotKey = assigned[index];
        if (!slotKey && !slots.some((slot) => slot.key === reference.slotKey)) {
            const candidates = slots.filter((item) => item.mediaTypes.includes(reference.kind) && (used.get(item.key) || 0) < item.maxCount);
            if (candidates.length === 1) {
                const slot = candidates[0];
                slotKey = slot.key;
                used.set(slot.key, (used.get(slot.key) || 0) + 1);
            }
        }
        return slotKey === reference.slotKey ? reference : { ...reference, slotKey };
    });
}

export function workbenchReferenceIssue(tool: WorkbenchTool | null, references: InputReference[], limits?: Record<InputReference["kind"], number>): string | undefined {
    const slots = tool?.inputContract?.slots || [];
    if (slots.length) {
        if (references.some((reference) => !workbenchReferenceSlot(tool, reference))) return "有素材尚未匹配当前场景，请重新选择场景或移除未分配素材";
        const overfilled = slots.find((slot) => references.filter((reference) => reference.slotKey === slot.key).length > slot.maxCount);
        if (overfilled) return `“${overfilled.name || "该槽位"}”最多支持 ${overfilled.maxCount} 个素材，请移除多余素材`;
    }
    if (limits) {
        for (const kind of ["image", "video", "audio"] as const) {
            const count = references.filter((reference) => reference.kind === kind).length;
            if (count <= limits[kind]) continue;
            const label = kind === "image" ? "图片" : kind === "video" ? "视频" : "音频";
            return limits[kind] > 0 ? `当前模型最多支持 ${limits[kind]} 个${label}素材，请移除多余素材或更换模型` : `当前模型不支持参考${label}，请移除对应素材或更换模型`;
        }
    }
}
