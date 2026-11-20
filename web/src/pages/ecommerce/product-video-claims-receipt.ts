import { openDB, type DBSchema } from "idb";
import type { GenerationTask } from "@/services/api/task-center";

export type ClaimReceipt = { taskId?: string; operationId?: string };
type ClaimScope = readonly [scope: string, projectId: string, ...imageIds: string[]];
interface ClaimsDB extends DBSchema {
    receipts: { key: string; value: ClaimReceipt | null };
}

function openReceipts() {
    return openDB<ClaimsDB>("kivao-ecommerce-video-claims", 1, {
        upgrade(db) {
            db.createObjectStore("receipts");
        },
    });
}

function decode(stored: ClaimReceipt | null | undefined, key: ClaimScope): ClaimReceipt | null {
    if (stored === undefined) {
        if (key.length !== 3) return null;
        const [scope, projectId, frameId] = key;
        const legacy = sessionStorage.getItem(`ecommerce:video-claims:${scope}:${projectId}:${frameId}`);
        if (legacy === null) return null;
        if (/^[\w-]{1,128}$/.test(legacy)) return { taskId: legacy };
    } else if (stored === null) return null;
    else if (
        typeof stored === "object" &&
        (stored.taskId || stored.operationId) &&
        (stored.taskId === undefined || (typeof stored.taskId === "string" && /^[\w-]{1,128}$/.test(stored.taskId))) &&
        (stored.operationId === undefined || (typeof stored.operationId === "string" && /^[\da-f-]{36}$/i.test(stored.operationId)))
    )
        return stored;
    throw new Error("分析回执格式异常，请先到任务中心核对。");
}

export async function readClaimReceipt(scope: ClaimScope) {
    const db = await openReceipts();
    try {
        return decode(await db.get("receipts", JSON.stringify(scope)), scope);
    } finally {
        db.close();
    }
}

// Compare and write in one browser transaction so concurrent tabs cannot admit two requests from the same quote.
export async function replaceClaimReceipt(scope: ClaimScope, previous: ClaimReceipt | null, next: ClaimReceipt | null) {
    const db = await openReceipts();
    try {
        const tx = db.transaction("receipts", "readwrite");
        const key = JSON.stringify(scope);
        const current = decode(await tx.store.get(key), scope);
        if (current?.taskId !== previous?.taskId || current?.operationId !== previous?.operationId) throw new Error("分析回执已更新，请先重新读取。");
        await Promise.all([tx.store.put(next, key), tx.done]);
    } finally {
        db.close();
    }
}

export function matchingClaimTask(task: GenerationTask, projectId: string, receipt: ClaimReceipt) {
    return Boolean(task.id && task.type === "canvas_text" && task.projectId === projectId && (!receipt.operationId || task.clientOperationId === receipt.operationId) && (!receipt.taskId || task.id === receipt.taskId));
}
