import { expect, test } from "bun:test";
import { ApiError } from "../src/services/api/request";
import { newWorkbenchBatch, recoverWorkbenchBatch, submitWorkbenchBatch, workbenchBatchPlan, workbenchBatchLimit, workbenchQuoteParts, workbenchTaskGroups, type WorkbenchBatch } from "../src/pages/workbench/workbench-batches";
import type { CreateWorkbenchTaskInput } from "../src/services/api/workbench";
import type { GenerationTask } from "../src/services/api/task-center";

const intent: CreateWorkbenchTaskInput = {
    kind: "image",
    model: "test-image",
    channelId: "test-channel",
    prompt: "Original intent",
    parameters: { size: "1:1", count: 4 },
    references: [{ resourceId: "owned-resource", kind: "image", slotKey: "product" }],
};

test("按单任务能力拆分张数、视频逐条创建，报价按实际拆单次数汇总", () => {
    expect(workbenchBatchPlan("image", 10, 4)).toEqual([4, 4, 2]);
    expect(workbenchQuoteParts([4, 4, 2])).toEqual([
        { outputs: 4, requests: 2 },
        { outputs: 2, requests: 1 },
    ]);
    expect(workbenchBatchPlan("image", 100, 20)).toEqual([12]);
    expect(workbenchBatchPlan("image", 5, 1)).toEqual([1, 1, 1, 1, 1]);
    expect(workbenchBatchPlan("image", 0, 0)).toEqual([1]);
    expect(workbenchBatchPlan("video", 10, 4)).toEqual(Array(8).fill(1));
    expect(workbenchQuoteParts(workbenchBatchPlan("video", 3))).toEqual([{ outputs: 1, requests: 3 }]);
    expect(workbenchBatchLimit("image", 4, 2)).toBe(8);
    expect(workbenchBatchLimit("image", 4, 5)).toBe(12);
    expect(workbenchBatchLimit("video", 4, 3)).toBe(3);
    expect(workbenchBatchLimit("video", 1, 0)).toBe(8);
});

test("响应丢失保留 UNKNOWN，未查到回执不重发，查到后只续提剩余项", async () => {
    const input = structuredClone(intent);
    let batch = newWorkbenchBatch(input, [4, 4, 2], "batch-response-loss");
    const calls: CreateWorkbenchTaskInput[] = [];
    const receipts = new Map<number, string>();
    const create = async (request: CreateWorkbenchTaskInput) => {
        calls.push(structuredClone(request));
        receipts.set(request.batch!.index, `task-${request.batch!.index}`);
        if (calls.length === 2) throw new ApiError("Connection lost", { retryable: true });
        return { id: receipts.get(request.batch!.index)!, status: "queued" as const };
    };
    const deps = {
        create,
        current: () => true,
        update: (next: WorkbenchBatch) => {
            batch = next;
        },
    };
    batch = await submitWorkbenchBatch(batch, deps);
    expect(batch.items.map((item) => item.state)).toEqual(["accepted", "unknown", "pending"]);
    expect(calls).toHaveLength(2);
    input.prompt = "An edited form must not affect the frozen batch";
    input.references![0].resourceId = "changed-resource";
    batch = await submitWorkbenchBatch(batch, deps);
    expect(calls).toHaveLength(2);
    let queries = 0;
    batch = await recoverWorkbenchBatch(batch, {
        ...deps,
        query: async () => {
            queries++;
            return null;
        },
    });
    expect(batch.items[1].state).toBe("unknown");
    expect(calls).toHaveLength(2);
    batch = await recoverWorkbenchBatch(batch, {
        ...deps,
        query: async (request) => {
            queries++;
            return { id: receipts.get(request.batch!.index)! };
        },
    });
    expect(queries).toBe(2);
    expect(batch.items.map((item) => item.state)).toEqual(["accepted", "accepted", "pending"]);
    expect(calls).toHaveLength(2);
    batch = await submitWorkbenchBatch(batch, deps);
    expect(calls).toHaveLength(3);
    expect(calls[2].batch).toEqual({ id: "batch-response-loss", index: 2, count: 3 });
    expect(calls.map((call) => call.parameters!.count)).toEqual([4, 4, 2]);
    expect(calls.every((call) => call.prompt === intent.prompt && call.references![0].resourceId === "owned-resource")).toBe(true);
    expect(batch.items.every((item) => item.state === "accepted")).toBe(true);
});

test("明确拒绝允许续提同一请求，已受理项不重发；缺少编号仍为 UNKNOWN", async () => {
    let attempts = 0;
    const sent: unknown[] = [];
    const initial = newWorkbenchBatch(intent, [1, 1], "batch-rejected");
    const create = async (input: CreateWorkbenchTaskInput) => {
        attempts++;
        sent.push(input.batch);
        if (attempts === 2) throw new ApiError("Rate limited", { status: 429 });
        return { id: `task-${input.batch!.index}`, status: "queued" as const };
    };
    const deps = { create, current: () => true, update: () => {} };
    const partial = await submitWorkbenchBatch(initial, deps);
    expect(partial.items.map((item) => item.state)).toEqual(["accepted", "rejected"]);
    const resumed = await submitWorkbenchBatch(partial, deps);
    expect(sent).toEqual([initial.items[0].input.batch, initial.items[1].input.batch, initial.items[1].input.batch]);
    expect(resumed.items.every((item) => item.state === "accepted")).toBe(true);
    const malformed = await submitWorkbenchBatch(initial, { ...deps, create: async () => ({ id: "", status: "queued" }) });
    expect(malformed.items.map((item) => item.state)).toEqual(["unknown", "pending"]);
});

test("服务端异常与超时不能认定未创建；账号切换或卸载后停止后续提交和回填", async () => {
    for (const status of [408, 500, 502, 504]) {
        const result = await submitWorkbenchBatch(newWorkbenchBatch(intent, [1, 1]), {
            current: () => true,
            update: () => {},
            create: async () => {
                throw new ApiError("Uncertain", { status });
            },
        });
        expect(result.items.map((item) => item.state)).toEqual(["unknown", "pending"]);
    }
    let current = true;
    let calls = 0;
    const updates: WorkbenchBatch[] = [];
    const result = await submitWorkbenchBatch(newWorkbenchBatch(intent, [1, 1]), {
        current: () => current,
        update: (batch) => updates.push(batch),
        create: async () => {
            calls++;
            current = false;
            return { id: "old-account-task", status: "queued" };
        },
    });
    expect(calls).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].items[0].state).toBe("submitting");
    expect(result.items[1].state).toBe("pending");
});

test("同批任务聚合排序，独立任务与历史非工作台的批次字段保持分开", () => {
    const tasks = [
        { id: "b-2", clientContext: { batchId: "batch-one", batchIndex: 1, batchCount: 2 } },
        { id: "single" },
        { id: "b-1", clientContext: { batchId: "batch-one", batchIndex: 0, batchCount: 2 } },
        { id: "legacy", clientContext: { batchIndex: 1, batchCount: 2 } },
    ] as GenerationTask[];
    expect(workbenchTaskGroups(tasks).map((group) => group.tasks.map((task) => task.id))).toEqual([["b-1", "b-2"], ["single"], ["legacy"]]);
});
