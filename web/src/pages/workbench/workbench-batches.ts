import { ApiError } from "@/services/api/request";
import type { CreateWorkbenchTaskInput, WorkbenchKind, WorkbenchTaskReceipt } from "@/services/api/workbench";
import type { GenerationTask } from "@/services/api/task-center";

export type BatchItem = {
    input: CreateWorkbenchTaskInput;
    outputs: number;
    state: "pending" | "submitting" | "accepted" | "rejected" | "unknown";
    taskId?: string;
    checked?: boolean;
};
export type WorkbenchBatch = { id: string; items: BatchItem[] };

export function workbenchBatchLimit(kind: WorkbenchKind, maxOutputs: number, activeTaskLimit: number) {
    const limit = kind === "image" ? 12 : 8;
    const perTask = kind === "image" ? Math.max(1, Math.trunc(maxOutputs) || 1) : 1;
    return activeTaskLimit > 0 ? Math.min(limit, perTask * Math.max(1, Math.trunc(activeTaskLimit))) : limit;
}

export function workbenchBatchPlan(kind: WorkbenchKind, total: number, maxOutputs = 1): number[] {
    const limit = kind === "image" ? 12 : 8;
    const requested = Math.min(limit, Math.max(1, Math.trunc(total) || 1));
    const perTask = kind === "image" ? Math.min(limit, Math.max(1, Math.trunc(maxOutputs) || 1)) : 1;
    return Array.from({ length: Math.ceil(requested / perTask) }, (_, index) => Math.min(perTask, requested - index * perTask));
}

export function workbenchQuoteParts(plan: number[]) {
    const counts = new Map<number, number>();
    for (const outputs of plan) counts.set(outputs, (counts.get(outputs) || 0) + 1);
    return [...counts].map(([outputs, requests]) => ({ outputs, requests }));
}

export function workbenchTaskGroups(tasks: GenerationTask[]) {
    const groups = new Map<string, GenerationTask[]>();
    for (const task of tasks) {
        const key = task.clientContext?.batchId ? `batch:${task.clientContext.batchId}` : `task:${task.id}`;
        const items = groups.get(key) || [];
        items.push(task);
        groups.set(key, items);
    }
    return [...groups].map(([id, items]) => ({ id, tasks: items.sort((a, b) => (a.clientContext?.batchIndex || 0) - (b.clientContext?.batchIndex || 0)) }));
}

export function newWorkbenchBatch(input: CreateWorkbenchTaskInput, plan: number[], id = crypto.randomUUID()): WorkbenchBatch {
    // Only the server-resolved intent is retained. It contains resource
    // IDs, never the browser's custom-channel config, API keys or signed URLs.
    const snapshot = structuredClone(input);
    return {
        id,
        items: plan.map((outputs, index) => ({
            input: { ...snapshot, parameters: { ...snapshot.parameters, ...(input.kind === "image" ? { count: outputs } : {}) }, batch: { id, index, count: plan.length } },
            outputs,
            state: "pending",
        })),
    };
}

type BatchDependencies = {
    create: (input: CreateWorkbenchTaskInput) => Promise<WorkbenchTaskReceipt["task"]>;
    current: () => boolean;
    update: (batch: WorkbenchBatch) => void | Promise<void>;
    retryUnknown?: boolean;
};

function rejectedBeforeCreation(error: unknown) {
    return error instanceof ApiError && error.status !== undefined && error.status >= 400 && error.status < 500 && error.status !== 408;
}

export async function submitWorkbenchBatch(batch: WorkbenchBatch, deps: BatchDependencies): Promise<WorkbenchBatch> {
    let next = batch;
    const update = async (index: number, patch: Partial<BatchItem>) => {
        next = { ...next, items: next.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) };
        if (deps.current()) await deps.update(next);
    };
    // UNKNOWN is never folded into failed/pending. Query first; a later explicit
    // retry must keep the same server-enforced identity and frozen input.
    if (next.items.some((item) => item.state === "submitting" || (item.state === "unknown" && (!deps.retryUnknown || !item.checked)))) return next;
    for (let index = 0; index < next.items.length; index++) {
        if (!deps.current()) break;
        if (next.items[index].state === "accepted") continue;
        // Persist before POST so a reload cannot forget a possibly committed item.
        await update(index, { state: "submitting", checked: false });
        if (!deps.current()) break;
        try {
            const task = await deps.create(next.items[index].input);
            if (!task?.id) throw new Error("Missing task receipt");
            await update(index, { state: "accepted", taskId: task.id });
        } catch (error) {
            await update(index, { state: rejectedBeforeCreation(error) ? "rejected" : "unknown" });
            break;
        }
    }
    return next;
}

export async function recoverWorkbenchBatch(batch: WorkbenchBatch, deps: Omit<BatchDependencies, "create"> & { query: (input: CreateWorkbenchTaskInput) => Promise<{ id: string } | null> }) {
    let next = batch;
    for (let index = 0; index < next.items.length; index++) {
        if (!deps.current()) break;
        const item = next.items[index];
        if (item.state !== "unknown" && item.state !== "submitting") continue;
        const task = await deps.query(item.input);
        if (!deps.current()) break;
        next = { ...next, items: next.items.map((entry, i) => (i === index ? { ...entry, checked: true, state: task?.id ? ("accepted" as const) : ("unknown" as const), ...(task?.id ? { taskId: task.id } : {}) } : entry)) };
        await deps.update(next);
    }
    return next;
}
