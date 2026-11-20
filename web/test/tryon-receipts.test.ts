import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import * as capabilities from "@/lib/model-capabilities";
import * as persistence from "@/lib/localforage-storage";
import { setActiveUserScope } from "@/lib/user-scope";
import * as taskAPI from "@/services/api/task-center";
import * as generation from "@/services/api/generation-task";
import * as workbench from "@/services/api/workbench";
import * as configStore from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { setTryOnAllowedFunctions } from "@/pages/ecommerce/tryon/tryon-access";
import * as knowledge from "@/pages/ecommerce/tryon/tryon-api";
import { defaultTryOnDraft, type TryOnDraft } from "@/pages/ecommerce/tryon/tryon-plan";
import { restoreTryOnReceipts } from "@/pages/ecommerce/tryon/tryon-receipts";
import * as runtime from "@/pages/ecommerce/tryon/tryon-runtime";
import * as store from "@/pages/ecommerce/tryon/tryon-store";

const job = (key: string, index: number): store.TryOnJob => ({ key, index, title: key, prompt: key, references: [], state: "unknown" });
const receipt = (id: string, batchId: string, slotKey?: string, index = 0): taskAPI.GenerationTask => ({ id, status: "queued", clientContext: { batchId, batchIndex: index, batchSlotKey: slotKey } }) as taskAPI.GenerationTask;

test("匹配账号 API 返回的当前批次与位置键，分开认领策划、原图和同位置的新版本", () => {
    const batch = { id: "batch", planning: { state: "unknown" }, jobs: [job("original", 0), job("new-version", 0), job("later", 2)] } as store.TryOnBatch;
    const partial = restoreTryOnReceipts(batch, [receipt("foreign", "different", "later", 2), receipt("ambiguous", "batch"), receipt("planned", "batch", "$planning"), receipt("new", "batch", "new-version"), receipt("legacy", "batch", undefined, 2)]);
    expect(partial.jobs.map((entry) => entry.taskId)).toEqual([undefined, "new", "legacy"]);
    expect(partial.planning).toMatchObject({ state: "running", taskId: "planned" });
    const resolved = restoreTryOnReceipts(partial, [receipt("first", "batch", "original")]);
    expect(resolved.jobs.map((entry) => entry.taskId)).toEqual(["first", "new", "legacy"]);
    expect(restoreTryOnReceipts(resolved, [])).toBe(resolved);
});

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let dom: Window | undefined;
afterEach(() => {
    dom?.happyDOM.abort();
    dom = undefined;
    mock.restore();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
});

test("刷新后从同一账号读取提交标记，未拿到编号的图片与策划继续等待回执", async () => {
    const stored = {
        id: "tryon_pose_example",
        fn: "pose",
        planning: { state: "running" },
        jobs: [
            { ...job("first", 0), state: "submitting" },
            { ...job("second", 1), state: "submitted", taskId: "existing" },
        ],
    };
    const storage = spyOn(persistence, "localForageStorageForScope").mockReturnValue({ getItem: async () => JSON.stringify([stored]), setItem: async () => {}, removeItem: async () => {} });
    const [loaded] = await store.loadTryOnBatches("reader");
    expect(storage).toHaveBeenCalledWith("reader");
    expect(loaded.planning?.state).toBe("unknown");
    expect(loaded.jobs.map((entry) => entry.state)).toEqual(["unknown", "submitted"]);
    expect(loaded.jobs[1].taskId).toBe("existing");
});

async function waitFor(predicate: () => boolean) {
    for (let i = 0; i < 100; i++) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(predicate()).toBe(true);
}

async function setup(scope: string) {
    dom = new Window({ url: "https://example.test" });
    Object.defineProperty(globalThis, "window", { configurable: true, value: dom });
    setActiveUserScope(scope);
    setTryOnAllowedFunctions(scope, ["fine-outfit"]);
    spyOn(store, "loadTryOnBatches").mockResolvedValue([]);
    spyOn(store, "saveTryOnBatches").mockResolvedValue();
    const user = useUserStore.getState();
    spyOn(useUserStore, "getState").mockReturnValue({ ...user, runtimeLimits: { ...user.runtimeLimits, activeTaskLimit: 3 } });
    const caps = capabilities.defaultModelCapabilityConfig();
    caps.image!.references.maxImages = 4;
    spyOn(capabilities, "modelCapabilityConfigFor").mockReturnValue(caps);
    spyOn(configStore, "resolveModelChannel").mockReturnValue({ id: "test" } as ReturnType<typeof configStore.resolveModelChannel>);
    spyOn(configStore, "logicalModelIDForConfig").mockReturnValue("");
    spyOn(taskAPI, "listGenerationTasks").mockResolvedValue([]);
    const ctx: runtime.TryOnRunContext = {
        scope,
        config: configStore.defaultConfig,
        agentModel: "",
        market: { region: "", platform: "", platformLabel: "", language: "", languageLabel: "" },
    };
    await waitFor(() => runtime.tryOnState(scope).batchesLoaded);
    const draft: TryOnDraft = {
        ...defaultTryOnDraft(),
        fn: "fine-outfit",
        imageModel: "test::image",
        count: 1,
        images: { "fine-outfit": (["model", "garment"] as const).map((slot) => ({ id: slot, slot, resourceId: slot, name: slot, previewUrl: "" })) },
    };
    return { ctx, draft };
}

test("图片已被接受但返回丢失，恢复使用只读批次查询，找回原任务且不重复提交", async () => {
    const { ctx, draft } = await setup("tryon-read");
    const create = spyOn(workbench, "createWorkbenchTask").mockRejectedValue(new Error("connection lost"));
    const batch = await runtime.startTryOnBatch(ctx, draft, "test");
    const currentJob = () => runtime.tryOnState(ctx.scope).batches[0].jobs[0];
    await waitFor(() => currentJob().state === "unknown");
    const lookup = spyOn(workbench, "listTryOnBatchTasks").mockResolvedValue([receipt("server-task", batch.id, currentJob().key)]);
    await runtime.recoverTryOnBatch(ctx, batch.id, false);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(currentJob().taskId).toBe("server-task");
    expect(create).toHaveBeenCalledTimes(1);
});

test("查询不到回执时保留未知状态，只有显式继续才沿用原键提交，权限收回后停止", async () => {
    const { ctx, draft } = await setup("tryon-continue");
    const create = spyOn(workbench, "createWorkbenchTask")
        .mockRejectedValueOnce(new Error("connection lost"))
        .mockImplementation(async ({ batch }) => receipt("success", batch!.id, batch!.slotKey));
    const batch = await runtime.startTryOnBatch(ctx, draft, "test");
    const currentJob = () => runtime.tryOnState(ctx.scope).batches[0].jobs[0];
    await waitFor(() => currentJob().state === "unknown");
    spyOn(workbench, "listTryOnBatchTasks").mockResolvedValue([]);
    await runtime.recoverTryOnBatch(ctx, batch.id, false);
    expect(currentJob().state).toBe("unknown");
    expect(create).toHaveBeenCalledTimes(1);
    setTryOnAllowedFunctions(ctx.scope, []);
    await runtime.recoverTryOnBatch(ctx, batch.id, true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(currentJob().state).toBe("unknown");
    setTryOnAllowedFunctions(ctx.scope, ["fine-outfit"]);
    await runtime.recoverTryOnBatch(ctx, batch.id, true);
    await waitFor(() => currentJob().taskId === "success");
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].batch).toEqual(create.mock.calls[0][0].batch);
    expect(create.mock.calls[0][0].batch?.slotKey).toBe(currentJob().key);
});

test("规划提交的回执丢失会暂停后续出图，查回原规划后继续监听", async () => {
    const { ctx, draft } = await setup("tryon-plan");
    setTryOnAllowedFunctions(ctx.scope, ["pose"]);
    const source: TryOnDraft = { ...draft, fn: "pose", images: { pose: (["subject", "pose"] as const).map((slot) => ({ id: slot, slot, resourceId: slot, name: slot, previewUrl: "" })) } };
    ctx.agentModel = "vision";
    spyOn(knowledge, "fetchTryOnKnowledge").mockResolvedValue({ knowledge: "", source: "builtin", entries: [] });
    spyOn(generation, "prepareBackendGenerationTask").mockResolvedValue({ type: "canvas_text", operation: "text", prompt: "plan" });
    const plan = spyOn(taskAPI, "createGenerationTask").mockRejectedValue(new Error("response lost"));
    const image = spyOn(workbench, "createWorkbenchTask").mockRejectedValue(new Error("unexpected image request"));
    const batch = await runtime.startTryOnBatch(ctx, source, "image");
    await waitFor(() => runtime.tryOnState(ctx.scope).batches[0].planning?.state === "unknown");
    spyOn(workbench, "listTryOnBatchTasks").mockResolvedValue([receipt("existing-plan", batch.id, "$planning")]);
    const listen = spyOn(taskAPI, "subscribeGenerationTasks").mockReturnValue(() => {});
    await runtime.recoverTryOnBatch(ctx, batch.id, false);
    expect(runtime.tryOnState(ctx.scope).batches[0].planning).toMatchObject({ taskId: "existing-plan", state: "running" });
    expect(listen.mock.calls[0][0]).toEqual(["existing-plan"]);
    expect(plan).toHaveBeenCalledTimes(1);
    expect(image).not.toHaveBeenCalled();
});

test("失败后重试使用同一个已确认的失败版本，未收到回执时再次点击仍使用旧版本", async () => {
    const { ctx, draft } = await setup("tryon-retry");
    const version = "2026-01-01T10:00:00.123456Z";
    spyOn(workbench, "createWorkbenchTask").mockImplementation(async ({ batch }) => ({ ...receipt("original", batch!.id, batch!.slotKey), status: "failed", updatedAt: version }));
    const batch = await runtime.startTryOnBatch(ctx, draft, "test");
    await waitFor(() => runtime.tryOnState(ctx.scope).batches[0].jobs[0].state === "submitted");
    const retried = spyOn(taskAPI, "retryGenerationTask")
        .mockRejectedValueOnce(new Error("response lost"))
        .mockResolvedValue(receipt("original", batch.id, batch.jobs[0].key));
    await expect(runtime.retryTryOnJob(ctx, batch.id, batch.jobs[0].key)).rejects.toThrow("response lost");
    await runtime.retryTryOnJob(ctx, batch.id, batch.jobs[0].key);
    expect(retried.mock.calls).toEqual([
        ["original", version],
        ["original", version],
    ]);
});
