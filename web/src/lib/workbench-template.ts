import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { GenerationTask } from "@/services/api/task-center";
import type { WorkbenchReferenceSlot, WorkbenchTool } from "@/services/api/workbench";

const slotPattern = /@\[workbench-slot:([^\]]*)\]/g;

export function workbenchSlotReferences(slots: WorkbenchReferenceSlot[]): CanvasResourceReference[] {
    return slots.map((slot) => ({
        id: slot.key,
        nodeId: "",
        kind: slot.mediaTypes[0] || "image",
        label: slot.name || "未命名输入",
        title: slot.name || "未命名输入",
        active: true,
        mentionToken: `@[workbench-slot:${encodeURIComponent(slot.key)}]`,
        previewUrl: slot.coverUrl,
    }));
}

export function invalidWorkbenchSlot(template: string, slots: WorkbenchReferenceSlot[]) {
    if (template.replace(slotPattern, "").includes("@[workbench-slot:")) return "输入引用不完整，请从 @ 菜单重新选择";
    for (const match of template.matchAll(slotPattern)) {
        let key: string;
        try {
            key = decodeURIComponent(match[1]);
        } catch {
            return "无法识别的输入引用";
        }
        if (!slots.some((slot) => slot.key === key)) return "模板引用了已移除的输入，请重新选择 @ 引用";
    }
    return "";
}

type Reference = { id: string; kind: "image" | "video" | "audio"; slotKey?: string; resourceId?: string; uploading?: boolean; error?: string };

export function orderedWorkbenchReferences<T extends Reference>(tool: WorkbenchTool | null, references: T[]): T[] {
    const slots = tool?.inputContract?.slots || [];
    const order = (ref: T) => {
        const index = slots.findIndex((slot) => slot.key === ref.slotKey);
        return index < 0 ? slots.length : index;
    };
    return [...references].sort((a, b) => order(a) - order(b));
}

export function workbenchReferenceLabels(references: Reference[]) {
    const counts = { image: 0, video: 0, audio: 0 };
    const names = { image: "图片", video: "视频", audio: "音频" };
    return new Map(references.map((ref) => [ref.id, `${names[ref.kind]}${++counts[ref.kind]}`]));
}

export function renderWorkbenchTemplate(template: string, tool: WorkbenchTool, references: Reference[], userPrompt: string) {
    const slots = tool.inputContract?.slots || [];
    const error = invalidWorkbenchSlot(template, slots);
    const ordered = orderedWorkbenchReferences(tool, references);
    const labels = workbenchReferenceLabels(ordered);
    const prompt = template.replace(slotPattern, (_, encoded: string) => {
        let key: string;
        try {
            key = decodeURIComponent(encoded);
        } catch {
            return "";
        }
        const slot = slots.find((item) => item.key === key);
        const selected = ordered.filter((ref) => ref.slotKey === key && ref.resourceId && !ref.uploading && !ref.error);
        return selected.length ? `${slot?.name || "输入素材"}（${selected.map((ref) => `@${labels.get(ref.id)}`).join("、")}）` : `${slot?.name || "可选素材"}（未提供）`;
    });
    return { prompt: [prompt.trim(), userPrompt.trim() ? `用户补充：\n${userPrompt.trim()}` : ""].filter(Boolean).join("\n\n"), error };
}

export function workbenchTaskInfo(task: GenerationTask) {
    const context = task.clientContext;
    if (context?.workbenchToolId && context.workbenchPresetId && context.workbenchToolName) {
        return { toolName: context.workbenchToolName, presetName: context.workbenchPresetName || "", references: context.workbenchReferenceCount || 0 };
    }
    try {
        const metadata = JSON.parse(task.inputJson || "{}").metadata;
        if (metadata?.source === "workbench" && metadata.workbenchToolId && metadata.workbenchPresetId && metadata.workbenchToolName) {
            return { toolName: String(metadata.workbenchToolName), presetName: String(metadata.workbenchPresetName || ""), references: Array.isArray(metadata.workbench?.references) ? metadata.workbench.references.length : 0 };
        }
    } catch {
        /* Task list summaries intentionally omit inputJson. */
    }
    return null;
}

export function workbenchTaskLabel(task: GenerationTask) {
    const info = workbenchTaskInfo(task);
    return info ? [info.toolName, info.presetName, `${info.references} 个素材`].filter(Boolean).join(" · ") : task.prompt;
}
