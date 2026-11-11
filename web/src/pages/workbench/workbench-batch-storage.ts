import localforage from "localforage";
import { scopedStorageKey } from "@/lib/user-scope";
import type { WorkbenchKind } from "@/services/api/workbench";
import type { WorkbenchBatch } from "./workbench-batches";

const keyFor = (userId: string, kind: WorkbenchKind) => {
    if (!userId) throw new Error("请先登录");
    return scopedStorageKey(`kivao:workbench-batch:v1:${kind}`, userId);
};
const allowedKeys = (value: object, keys: string[]) => Object.keys(value).every((key) => keys.includes(key));
const writes = new Map<string, Promise<unknown>>();

async function writeInOrder(key: string, operation: () => Promise<unknown>) {
    const next = (writes.get(key) || Promise.resolve()).catch(() => {}).then(operation);
    writes.set(key, next);
    try {
        await next;
    } finally {
        if (writes.get(key) === next) writes.delete(key);
    }
}

// Persist the existing server intent, never AiConfig, headers, channel credentials
// or preview URLs. Reject unexpected fields rather than silently changing a replay.
export function validateWorkbenchBatch(batch: WorkbenchBatch, kind: WorkbenchKind) {
    if (!batch || !allowedKeys(batch, ["id", "items"]) || typeof batch.id !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(batch.id) || !Array.isArray(batch.items) || !batch.items.length || batch.items.length > 20)
        throw new Error("暂存批次无效，请核对任务历史");
    for (const [index, item] of batch.items.entries()) {
        const input = item?.input;
        const identity = input?.batch;
        if (
            !input ||
            input.kind !== kind ||
            !identity ||
            identity.id !== batch.id ||
            identity.index !== index ||
            identity.count !== batch.items.length ||
            typeof input.prompt !== "string" ||
            input.prompt.length > 32000 ||
            typeof input.model !== "string" ||
            !Number.isInteger(item.outputs) ||
            item.outputs < 1 ||
            item.outputs > (kind === "image" ? 12 : 1) ||
            !["pending", "submitting", "accepted", "rejected", "unknown"].includes(item.state) ||
            (item.state === "accepted" && !item.taskId) ||
            (item.taskId !== undefined && typeof item.taskId !== "string") ||
            (item.checked !== undefined && typeof item.checked !== "boolean") ||
            !allowedKeys(input, ["kind", "toolId", "presetId", "prompt", "userPrompt", "model", "logicalModelId", "channelId", "parameters", "references", "batch"]) ||
            !allowedKeys(identity, ["id", "index", "count"])
        )
            throw new Error("暂存批次身份或内容无效，请核对任务历史");
        for (const field of ["toolId", "presetId", "userPrompt", "logicalModelId", "channelId"] as const) {
            if (input[field] !== undefined && typeof input[field] !== "string") throw new Error("暂存批次字段无效");
        }
        if (
            input.parameters &&
            (Array.isArray(input.parameters) ||
                !allowedKeys(input.parameters, kind === "image" ? ["size", "quality", "imageResolution", "count"] : ["seconds", "ratio", "resolution", "generateAudio", "watermark"]) ||
                Object.values(input.parameters).some((value) => !["string", "number", "boolean", "undefined"].includes(typeof value) || (typeof value === "number" && !Number.isFinite(value))))
        )
            throw new Error("不保存额外模型配置");
        if (
            input.references &&
            (!Array.isArray(input.references) ||
                input.references.length > 20 ||
                input.references.some(
                    (ref) =>
                        !ref ||
                        typeof ref.resourceId !== "string" ||
                        !["image", "video", "audio"].includes(ref.kind) ||
                        !allowedKeys(ref, ["resourceId", "kind", "role", "slotKey"]) ||
                        (ref.role !== undefined && !["reference", "first_frame", "last_frame"].includes(ref.role)) ||
                        (ref.slotKey !== undefined && typeof ref.slotKey !== "string"),
                ))
        )
            throw new Error("不保存素材地址或额外配置");
        if (!allowedKeys(item, ["input", "outputs", "state", "taskId", "checked"])) throw new Error("暂存批次字段无效");
    }
    if (batch.items.reduce((sum, item) => sum + item.outputs, 0) > (kind === "image" ? 12 : 8)) throw new Error("暂存批次超出数量限制");
}

export async function saveWorkbenchBatch(userId: string, kind: WorkbenchKind, batch: WorkbenchBatch | null) {
    const key = keyFor(userId, kind);
    if (batch) {
        validateWorkbenchBatch(batch, kind);
        const serialized = JSON.stringify({ version: 1, batch });
        await writeInOrder(key, () => localforage.setItem(key, serialized));
    } else await writeInOrder(key, () => localforage.removeItem(key));
}

export async function loadWorkbenchBatch(userId: string, kind: WorkbenchKind): Promise<WorkbenchBatch | null> {
    const key = keyFor(userId, kind);
    await writes.get(key);
    const raw = await localforage.getItem<string>(key);
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (record.version !== 1) throw new Error("暂存批次版本无效，请核对任务历史");
    const batch = record.batch as WorkbenchBatch;
    validateWorkbenchBatch(batch, kind);
    return { ...batch, items: batch.items.map((item) => (item.state === "submitting" ? { ...item, state: "unknown", checked: false } : item)) };
}
