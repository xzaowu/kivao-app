import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AxiosAdapter } from "axios";
import { apiClient } from "@/services/api/request";
import { recoverGenerationTaskMedia, retryGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { setActiveUserScope } from "@/lib/user-scope";

const originalAdapter = apiClient.defaults.adapter;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let notifications = 0;
let calls = 0;
let receive: () => Promise<{ code: number; data: GenerationTask | null; msg: string }>;
const task = { id: "task-fixture", type: "canvas_image", status: "queued", prompt: "fixture", attempts: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01" } satisfies GenerationTask;

beforeEach(() => {
    const storage = new Map<string, string>();
    const target = new EventTarget();
    target.addEventListener("wallet:updated", () => notifications++);
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
        localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
        dispatchEvent: target.dispatchEvent.bind(target),
    } });
    setActiveUserScope("fixture-a");
    notifications = 0;
    calls = 0;
    receive = async () => ({ code: 0, data: task, msg: "ok" });
    apiClient.defaults.adapter = (async (config) => {
        calls++;
        return { data: await receive(), status: 200, statusText: "OK", headers: {}, config };
    }) satisfies AxiosAdapter;
});

afterEach(() => {
    apiClient.defaults.adapter = originalAdapter;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
});

for (const action of [retryGenerationTask, recoverGenerationTaskMedia]) {
    describe(action.name, () => {
        test("refreshes the wallet once after confirmed success", async () => {
            let finish!: () => void;
            receive = () => new Promise((resolve) => { finish = () => resolve({ code: 0, data: task, msg: "ok" }); });
            const pending = action(task.id);
            expect(notifications).toBe(0);
            finish();
            expect(await pending).toEqual(task);
            expect(calls).toBe(1);
            expect(notifications).toBe(1);
        });

        test("business failure does not refresh or retry", async () => {
            receive = async () => ({ code: 403, data: null, msg: "rejected" });
            await expect(action(task.id)).rejects.toThrow("rejected");
            expect(calls).toBe(1);
            expect(notifications).toBe(0);
        });

        test("transport failure does not refresh or retry", async () => {
            receive = async () => { throw new Error("offline fixture"); };
            await expect(action(task.id)).rejects.toThrow("offline fixture");
            expect(calls).toBe(1);
            expect(notifications).toBe(0);
        });

        test("a late response after A to B to A does not notify a new session", async () => {
            let finish!: () => void;
            receive = () => new Promise((resolve) => { finish = () => resolve({ code: 0, data: task, msg: "ok" }); });
            const pending = action(task.id);
            setActiveUserScope("fixture-b");
            setActiveUserScope("fixture-a");
            finish();
            expect(await pending).toEqual(task);
            expect(calls).toBe(1);
            expect(notifications).toBe(0);
        });
    });
}
