import { afterAll, expect, spyOn, test } from "bun:test";
import localforage from "localforage";
import { newWorkbenchBatch, recoverWorkbenchBatch, submitWorkbenchBatch } from "../src/pages/workbench/workbench-batches";
import { loadWorkbenchBatch, saveWorkbenchBatch } from "../src/pages/workbench/workbench-batch-storage";
import type { CreateWorkbenchTaskInput } from "../src/services/api/workbench";

const data = new Map<string, unknown>();
const get = spyOn(localforage, "getItem").mockImplementation(async (key) => (data.get(key) ?? null) as never);
const set = spyOn(localforage, "setItem").mockImplementation(async (key, value) => {
    data.set(key, value);
    return value as never;
});
const remove = spyOn(localforage, "removeItem").mockImplementation(async (key) => {
    data.delete(key);
});
afterAll(() => {
    get.mockRestore();
    set.mockRestore();
    remove.mockRestore();
});

const input: CreateWorkbenchTaskInput = { kind: "image", model: "local-test", channelId: "channel", prompt: "Frozen prompt", parameters: { count: 1 }, references: [{ resourceId: "resource", kind: "image" }] };

test("刷新恢复提交中为 UNKNOWN，账号和能力隔离，读取缓存不自动提交", async () => {
    const batch = newWorkbenchBatch(input, [1, 1], "batch-reload-01");
    batch.items[0].state = "submitting";
    await saveWorkbenchBatch("owner-A", "image", batch);
    const restored = await loadWorkbenchBatch("owner-A", "image");
    expect(restored?.items.map((item) => item.state)).toEqual(["unknown", "pending"]);
    expect(restored?.items[0].checked).toBe(false);
    expect(await loadWorkbenchBatch("owner-B", "image")).toBeNull();
    expect(await loadWorkbenchBatch("owner-A", "video")).toBeNull();
    let calls = 0;
    const deps = {
        current: () => true,
        update: () => {},
        create: async () => {
            calls++;
            return { id: "task", status: "queued" as const };
        },
    };
    await submitWorkbenchBatch(restored!, deps);
    expect(calls).toBe(0);
    const checked = await recoverWorkbenchBatch(restored!, { ...deps, query: async () => null });
    await submitWorkbenchBatch(checked, deps);
    expect(calls).toBe(0);
    const sent: CreateWorkbenchTaskInput[] = [];
    await submitWorkbenchBatch(checked, {
        ...deps,
        retryUnknown: true,
        create: async (request) => {
            sent.push(request);
            return { id: `task-${request.batch!.index}`, status: "queued" };
        },
    });
    expect(sent.map((request) => request.batch)).toEqual(batch.items.map((item) => item.input.batch));
    expect(sent.every((request) => request.prompt === "Frozen prompt")).toBe(true);
    await saveWorkbenchBatch("owner-A", "image", null);
    expect(await loadWorkbenchBatch("owner-A", "image")).toBeNull();
});

test("暂存拒绝密钥、连接配置、素材 URL 和身份变化；写入失败不发任务", async () => {
    for (const mutate of [
        (batch: any) => {
            batch.items[0].input.apiKey = "fake-private-key";
        },
        (batch: any) => {
            batch.items[0].input.config = { apiKey: "fake-private-key" };
        },
        (batch: any) => {
            batch.items[0].input.parameters.headers = { Authorization: "fake" };
        },
        (batch: any) => {
            batch.items[0].input.references[0].url = "https://example.test/private";
        },
        (batch: any) => {
            batch.items[0].input.batch.id = "another-batch";
        },
    ]) {
        const batch = newWorkbenchBatch(input, [1], "batch-invalid-01");
        mutate(batch);
        await expect(saveWorkbenchBatch("safe-owner", "image", batch)).rejects.toThrow();
    }
    expect(JSON.stringify([...data.values()])).not.toContain("fake-private-key");
    let calls = 0;
    await expect(
        submitWorkbenchBatch(newWorkbenchBatch(input, [1]), {
            current: () => true,
            update: async () => {
                throw new Error("Storage unavailable");
            },
            create: async () => {
                calls++;
                return { id: "must-not-exist", status: "queued" };
            },
        }),
    ).rejects.toThrow("Storage unavailable");
    expect(calls).toBe(0);
});
