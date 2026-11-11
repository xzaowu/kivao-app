import localforage from "localforage";
import { scopedStorageKey } from "@/lib/user-scope";
import { ApiError } from "@/services/api/request";
import type { EcommerceProject, EcommerceTaskRequest } from "@/services/api/ecommerce";
import type { GenerationTask } from "@/services/api/task-center";

export type EcommerceIntent = { request: EcommerceTaskRequest; phase: "ready" | "unknown" | "accepted" | "rejected"; label: string; taskId?: string; checked?: boolean };
const exactKeys = (value: object, keys: string[]) => Object.keys(value).every((key) => keys.includes(key));
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

export function validateEcommerceIntents(items: EcommerceIntent[]) {
    if (!Array.isArray(items) || items.length > 8) throw new Error("商品任务暂存不可读取，请先核对任务回执");
    const ids = new Set<string>();
    for (const item of items) {
        const r = item?.request;
        if (
            !item ||
            !exactKeys(item, ["request", "phase", "label", "taskId", "checked"]) ||
            !["ready", "unknown", "accepted", "rejected"].includes(item.phase) ||
            typeof item.label !== "string" ||
            item.label.length > 200 ||
            !r ||
            !exactKeys(r, ["revision", "requestId", "stage", "imageId", "model", "size", "quality", "imageResolution", "quoteHash", "maxCharge", "quoteExpiresAt"]) ||
            !uuid(r.requestId) ||
            ids.has(r.requestId) ||
            !Number.isSafeInteger(r.revision) ||
            r.revision < 1 ||
            !["vision", "planning", "image"].includes(r.stage) ||
            !Number.isSafeInteger(r.maxCharge) ||
            r.maxCharge < 0 ||
            typeof r.quoteHash !== "string" ||
            !/^[a-f0-9]{64}$/.test(r.quoteHash) ||
            typeof r.quoteExpiresAt !== "string" ||
            !Number.isFinite(Date.parse(r.quoteExpiresAt))
        )
            throw new Error("商品任务暂存无效，请先核对任务回执");
        for (const key of ["imageId", "size", "quality", "imageResolution"] as const) if (r[key] !== undefined && (typeof r[key] !== "string" || r[key]!.length > 100)) throw new Error("商品任务参数无效");
        if (r.model && (!exactKeys(r.model, ["logicalModelId", "channelId", "model"]) || Object.values(r.model).some((v) => typeof v !== "string" || v.length > 200))) throw new Error("商品任务不能暂存连接配置");
        if (item.taskId !== undefined && !uuid(item.taskId)) throw new Error("商品任务回执无效");
        if (item.checked !== undefined && typeof item.checked !== "boolean") throw new Error("商品任务查询状态无效");
        ids.add(r.requestId);
    }
}

const keyFor = (userId: string, projectId: string) => {
    if (!userId || !uuid(projectId)) throw new Error("缺少商品任务账号范围");
    return scopedStorageKey(`kivao:ecommerce:intents:v1:${projectId}`, userId);
};
const writes = new Map<string, Promise<unknown>>();
export async function saveEcommerceIntents(userId: string, projectId: string, items: EcommerceIntent[]) {
    validateEcommerceIntents(items);
    const key = keyFor(userId, projectId),
        snapshot = JSON.parse(JSON.stringify(items));
    const next = (writes.get(key) || Promise.resolve()).catch(() => {}).then(() => localforage.setItem(key, snapshot));
    writes.set(key, next);
    try {
        await next;
    } finally {
        if (writes.get(key) === next) writes.delete(key);
    }
}
export async function loadEcommerceIntents(userId: string, projectId: string) {
    const items = (await localforage.getItem<EcommerceIntent[]>(keyFor(userId, projectId))) || [];
    validateEcommerceIntents(items);
    return items;
}

type Dependencies = {
    assertCurrent(): void;
    persist(items: EcommerceIntent[]): Promise<void>;
    project(): Promise<EcommerceProject>;
    submit(request: EcommerceTaskRequest): Promise<GenerationTask>;
    receipt(requestId: string): Promise<GenerationTask | null>;
};

export async function submitEcommerceIntents(original: EcommerceIntent[], deps: Dependencies) {
    const items: EcommerceIntent[] = structuredClone(original);
    validateEcommerceIntents(items);
    if (items.some((item) => item.phase === "unknown")) throw new Error("先查询未确认任务的回执");
    for (const item of items) {
        if (item.phase !== "ready") continue;
        deps.assertCurrent();
        const project = await deps.project();
        deps.assertCurrent();
        item.request.revision = project.revision;
        item.phase = "unknown";
        item.checked = false;
        await deps.persist(items);
        deps.assertCurrent();
        try {
            const task = await deps.submit(item.request);
            deps.assertCurrent();
            item.phase = "accepted";
            item.taskId = task.id;
        } catch (error) {
            deps.assertCurrent();
            // A definitive rejection only describes this never-before-sent item.
            item.phase = error instanceof ApiError && error.status !== undefined && error.status >= 400 && error.status < 500 ? "rejected" : "unknown";
            await deps.persist(items);
            return items;
        }
        await deps.persist(items);
    }
    return items;
}

export async function queryEcommerceIntents(original: EcommerceIntent[], deps: Dependencies) {
    const items: EcommerceIntent[] = structuredClone(original);
    for (const item of items)
        if (item.phase === "unknown") {
            deps.assertCurrent();
            const task = await deps.receipt(item.request.requestId);
            deps.assertCurrent();
            item.checked = true;
            if (task) {
                item.phase = "accepted";
                item.taskId = task.id;
            }
            await deps.persist(items);
        }
    return items;
}

export async function retryEcommerceUnknown(original: EcommerceIntent[], deps: Dependencies) {
    const items: EcommerceIntent[] = structuredClone(original);
    const item = items.find((item) => item.phase === "unknown");
    if (!item?.checked) throw new Error("先查询任务回执，再确认是否重试");
    deps.assertCurrent();
    item.checked = false;
    await deps.persist(items);
    deps.assertCurrent();
    try {
        // UNKNOWN retries preserve the exact old body and identity, including revision.
        const task = await deps.submit(item.request);
        deps.assertCurrent();
        item.phase = "accepted";
        item.taskId = task.id;
    } catch {
        deps.assertCurrent();
    }
    await deps.persist(items);
    return items;
}

export async function stopEcommerceUnknown(original: EcommerceIntent[], deps: Dependencies & { newRound(project: EcommerceProject): Promise<EcommerceProject> }) {
    validateEcommerceIntents(original);
    const unknown = original.filter((item) => item.phase === "unknown");
    if (!unknown.length || unknown.some((item) => !item.checked)) throw new Error("先查询所有待确认任务的回执");
    deps.assertCurrent();
    // Pin the revision before receipt reads. A late admission must either win
    // this CAS (and block termination) or lose to the new round, never both.
    const before = await deps.project();
    deps.assertCurrent();
    const items = await queryEcommerceIntents(original, deps);
    if (unknown.some((item) => items.find((next) => next.request.requestId === item.request.requestId)?.phase === "accepted")) {
        const project = await deps.project();
        deps.assertCurrent();
        return { project, items, stopped: false };
    }
    const project = await deps.newRound(before);
    deps.assertCurrent();
    await deps.persist([]);
    deps.assertCurrent();
    return { project, items: [] as EcommerceIntent[], stopped: true };
}
