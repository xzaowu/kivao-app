import { afterAll, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { CreateWorkbenchTaskInput } from "../../src/services/api/workbench";
import type { GenerationTask } from "../../src/services/api/task-center";

const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    CustomEvent: dom.CustomEvent,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
    __APP_VERSION__: "test",
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router");
const { App, ConfigProvider } = await import("antd");
const { default: localforage } = await import("localforage");
const persisted = new Map<string, unknown>();
const storageGet = spyOn(localforage, "getItem").mockImplementation(async (key) => (persisted.get(key) ?? null) as never);
const storageSet = spyOn(localforage, "setItem").mockImplementation(async (key, value) => {
    persisted.set(key, value);
    return value as never;
});
const storageRemove = spyOn(localforage, "removeItem").mockImplementation(async (key) => {
    persisted.delete(key);
});
const { http, apiClient, ApiError } = await import("../../src/services/api/request");
const { useUserStore, defaultFeatureAvailability } = await import("../../src/stores/use-user-store");
const { useConfigStore, defaultConfig, createModelChannel } = await import("../../src/stores/use-config-store");
const { defaultModelCapabilityConfig } = await import("../../src/lib/model-capabilities");
const { useCreationPreferencesStore } = await import("../../src/stores/use-creation-preferences-store");
const { WorkbenchPage } = await import("../../src/pages/workbench/image-workbench-page");

apiClient.defaults.adapter = async () => {
    throw new Error("Real network forbidden in workbench batch fixture");
};
const get = spyOn(http, "get");
const post = spyOn(http, "post");
afterAll(() => {
    get.mockRestore();
    post.mockRestore();
    storageGet.mockRestore();
    storageSet.mockRestore();
    storageRemove.mockRestore();
    dom.happyDOM.abort();
});

const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.replace(/\s/g, "") === label)!;

for (const kind of ["image", "video"] as const) {
    test(`${kind}: response loss only queries receipts; remaining items keep their original identity`, async () => {
        const capabilityConfig = defaultModelCapabilityConfig(kind === "image" ? "openai-image" : "minimax-video", "local-test");
        capabilityConfig.image!.maxOutputs = 1;
        const model = "local::local-test";
        useUserStore.setState({ user: { id: "batch-owner", username: "fixture", displayName: "Local test", role: "user", status: "active" }, hydrated: true, features: { ...defaultFeatureAvailability, customChannelsEnabled: true, creditsEnabled: true } });
        useConfigStore.setState({
            config: {
                ...defaultConfig,
                model,
                imageModel: model,
                videoModel: model,
                channels: [
                    createModelChannel({
                        id: "local",
                        name: "测试模型",
                        scope: "system",
                        baseUrl: "https://example.test",
                        apiKey: "fixture-only-not-a-real-key",
                        models: ["local-test"],
                        modelCosts: [{ model: "local-test", capability: kind, protocol: kind === "image" ? "openai-image" : "minimax-video", billingMode: "fixed_request", unitPriceMicrocredits: 1_000_000, capabilityConfig }],
                    }),
                ],
            },
        });
        useCreationPreferencesStore.setState({ hydrated: true, preferences: {} });
        const submissions: CreateWorkbenchTaskInput[] = [];
        const stored = new Map<number, GenerationTask>();
        const now = new Date().toISOString();
        let receiptQueries = 0;
        get.mockImplementation(async (path) => {
            if (path === "/workbench/tools") return { tools: [] } as never;
            if (path === "/workbench/tasks") return [...stored.values()] as never;
            if (path.startsWith("/workbench/batches/")) {
                receiptQueries++;
                return { task: receiptQueries === 1 ? null : stored.get(1) || null } as never;
            }
            if (path.startsWith("/tasks/")) throw new ApiError("Details temporarily unavailable", { status: 503 });
            throw new Error(`Unexpected read ${path}`);
        });
        post.mockImplementation(async (path, value) => {
            if (path === "/model-catalog/quote") return { quote: { amountMicrocredits: 1_000_000, estimated: false } } as never;
            if (path !== "/workbench/tasks") throw new Error(`Unexpected write ${path}`);
            const input = structuredClone(value) as CreateWorkbenchTaskInput;
            submissions.push(input);
            const batch = input.batch!;
            const task: GenerationTask = {
                id: `task-${batch.index}`,
                status: "queued",
                type: `canvas_${kind}`,
                prompt: input.prompt,
                attempts: 0,
                createdAt: now,
                updatedAt: now,
                clientContext: { batchId: batch.id, batchIndex: batch.index, batchCount: batch.count },
            };
            stored.set(batch.index, task);
            if (submissions.length === 2) throw new ApiError("Response lost", { retryable: true });
            return task as never;
        });
        const host = document.createElement("div");
        document.body.append(host);
        let root = createRoot(host);
        const render = () =>
            root.render(
                <MemoryRouter>
                    <ConfigProvider theme={{ token: { motion: false } }}>
                        <App>
                            <WorkbenchPage kind={kind} />
                        </App>
                    </ConfigProvider>
                </MemoryRouter>,
            );
        try {
            await act(async () => render());
            const editor = host.querySelector<HTMLTextAreaElement>("textarea.workbench-prompt-input")!;
            expect(editor).not.toBeNull();
            await act(async () => {
                Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, "value")!.set!.call(editor, "A local test scene");
                editor.dispatchEvent(new dom.Event("input", { bubbles: true }));
            });
            const three = Array.from(host.querySelectorAll<HTMLButtonElement>(".workbench-count-picker button")).find((item) => item.textContent === "3")!;
            expect(three).not.toBeNull();
            await act(async () => three.click());
            expect(host.querySelector(".workbench-submit-estimate")?.textContent).toContain("3 积分");
            const submit = host.querySelector<HTMLButtonElement>(".workbench-submit")!;
            expect(submit.disabled).toBe(false);
            await act(async () => {
                submit.click();
                submit.click();
            });
            expect(submissions).toHaveLength(2);
            expect(new Set(submissions.map((input) => input.batch!.id)).size).toBe(1);
            expect(host.querySelector('[aria-label="批量提交进度"]')?.textContent).toContain("已受理 1 / 3");
            expect(button("继续未提交任务").disabled).toBe(true);
            expect(submit.disabled).toBe(true);
            expect(button("取消未提交项")).toBeUndefined();
            expect(JSON.stringify([...persisted.values()])).not.toContain("fixture-only-not-a-real-key");
            await act(async () => root.unmount());
            root = createRoot(host);
            await act(async () => render());
            expect(submissions).toHaveLength(2);
            expect(receiptQueries).toBe(0);
            expect(button("继续未提交任务").disabled).toBe(true);
            await act(async () => button("查询任务回执").click());
            expect(receiptQueries).toBe(1);
            expect(submissions).toHaveLength(2);
            expect(button("继续未提交任务").disabled).toBe(true);
            expect(button("重试未确认任务").disabled).toBe(false);
            await act(async () => button("查询任务回执").click());
            expect(receiptQueries).toBe(2);
            expect(submissions).toHaveLength(2);
            expect(button("继续未提交任务").disabled).toBe(false);
            await act(async () => button("继续未提交任务").click());
            expect(submissions).toHaveLength(3);
            expect(submissions.map((input) => input.batch!.index)).toEqual([0, 1, 2]);
            expect(submissions.every((input) => input.prompt === "A local test scene")).toBe(true);
            expect(JSON.stringify(submissions)).not.toContain("fixture-only-not-a-real-key");
            expect(host.querySelector('[aria-label="批量提交进度"]')).toBeNull();
            expect(stored.size).toBe(3);
            expect([...persisted.keys()].filter((key) => key.includes(":workbench-batch:"))).toHaveLength(0);
            // Reading a task detail failed, but no accepted item was sent again.
            expect(submissions).toHaveLength(3);
            expect(host.querySelector(".workbench-count-picker")?.textContent).toContain(kind === "image" ? "生成张数" : "生成条数");
            await act(async () => useUserStore.setState({ user: null }));
            expect(host.querySelector(".workbench-task-list")?.textContent).not.toContain("A local test scene");
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    });
}
