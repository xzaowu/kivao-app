import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { WorkbenchTool } from "../../src/services/api/workbench";
const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    ResizeObserver: dom.ResizeObserver,
    MutationObserver: dom.MutationObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const storage = { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };
mock.module("@/lib/localforage-storage", () => ({ localForageStorage: storage, localForageStorageForScope: () => storage }));
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter, useNavigate, useLocation } = await import("react-router");
const antd = await import("antd");
const notices: string[] = [];
const app = { message: { error: (v: string) => notices.push(v), warning: (v: string) => notices.push(v), info: (v: string) => notices.push(v), success() {} }, modal: {} };
mock.module("antd", () => ({ ...antd, App: { ...antd.App, useApp: () => app } }));
const stores = await import("../../src/stores/use-config-store");
const { defaultModelCapabilityConfig } = await import("../../src/lib/model-capabilities");
const { useUserStore } = await import("../../src/stores/use-user-store");
const { useCreationPreferencesStore } = await import("../../src/stores/use-creation-preferences-store");
const { setActiveUserScope } = await import("../../src/lib/user-scope");
const { getWorkbenchDraft } = await import("../../src/pages/workbench/workbench-draft");
const catalog = await import("../../src/services/api/workbench");
function scene(id: string, maxCount: number): WorkbenchTool {
    return {
        id,
        name: `场景${id}`,
        kind: "image",
        categoryId: "test",
        description: "",
        sortOrder: 0,
        enabled: true,
        presets: Array.from({ length: 7 }, (_, index) => ({ id: `${id}-${index}`, name: `效果${index + 1}`, promptTemplate: `${id}模板${index + 1}` })),
        inputContract: { promptRequired: true, minTextReferences: 0, slots: [{ key: id, name: `素材${id}`, mediaTypes: ["image"], required: false, minCount: 0, maxCount }] },
    };
}
const tools = [scene("A", 2), scene("B", 1)];
let availableTools = tools;
let submissions = 0;
mock.module("@/services/api/workbench", () => ({
    ...catalog,
    listWorkbenchTools: async () => ({ tools: availableTools }),
    listWorkbenchTasks: async () => [],
    createWorkbenchTask: async () => {
        submissions++;
        throw new Error("unexpected generation");
    },
}));
let editPrompt!: (value: string) => void;
mock.module("@/components/canvas/canvas-resource-mention-textarea", () => ({
    CanvasResourceMentionTextarea: (props: { value: string; onChange(value: string): void }) => {
        editPrompt = props.onChange;
        return <textarea aria-label="测试描述" value={props.value} readOnly />;
    },
}));
const composer = await import("../../src/pages/workbench/workbench-composer");
let submit!: () => void;
let submitDisabled: string | undefined;
mock.module("../../src/pages/workbench/workbench-composer", () => ({
    ...composer,
    ComposerFooter: (props: { onSubmit(): void; disabledReason?: string }) => {
        submit = props.onSubmit;
        submitDisabled = props.disabledReason;
        return null;
    },
}));
const { WorkbenchPage } = await import("../../src/pages/workbench/image-workbench-page");
let root: ReturnType<typeof createRoot> | undefined;
let navigate: ReturnType<typeof useNavigate>;
let route = "";
function Harness() {
    navigate = useNavigate();
    const location = useLocation();
    route = `${location.pathname}${location.search}`;
    return location.pathname === "/away" ? <p>其它页面</p> : <WorkbenchPage kind={location.pathname.includes("video") ? "video" : "image"} />;
}
beforeEach(() => {
    setActiveUserScope(crypto.randomUUID());
    notices.length = submissions = 0;
    availableTools = tools;
    const capability = defaultModelCapabilityConfig("openai");
    capability.image!.references.maxImages = 8;
    capability.video!.references.maxImages = 8;
    stores.useConfigStore.setState({
        config: {
            ...stores.defaultConfig,
            model: "fixture::image",
            imageModel: "fixture::image",
            videoModel: "fixture::video",
            channels: [
                stores.createModelChannel({
                    id: "fixture",
                    scope: "system",
                    apiKey: "system",
                    models: ["image", "video"],
                    modelCosts: ["image", "video"].map((model) => ({ model, capability: model as "image" | "video", protocol: "openai", capabilityConfig: capability, billingMode: "fixed_request", unitPriceMicrocredits: 0 })),
                }),
            ],
        },
    });
    useUserStore.setState({ hydrated: true, features: { ...useUserStore.getState().features, creditsEnabled: false } });
    useCreationPreferencesStore.setState({ hydrated: true, preferences: {} });
});
afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined;
    document.body.innerHTML = "";
});
afterAll(() => dom.happyDOM.abort());
async function mount(path = "/image?tool=A") {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
        root!.render(
            <antd.ConfigProvider theme={{ token: { motion: false } }}>
                <MemoryRouter initialEntries={[path]}>
                    <Harness />
                </MemoryRouter>
            </antd.ConfigProvider>,
        ),
    );
}
async function press(text: string) {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.replace(/\s/g, "") === text);
    expect(button).toBeTruthy();
    await act(async () => button!.click());
}
async function chooseB() {
    await act(async () => document.querySelector<HTMLButtonElement>(".wb-scene-current")!.click());
    const card = [...document.querySelectorAll<HTMLButtonElement>(".wb-scene-card")].find((item) => item.querySelector("strong")?.textContent === "场景B")!;
    expect(card).toBeTruthy();
    await act(async () => card.click());
}
function seedDraft() {
    const entry = getWorkbenchDraft("image");
    entry.setField("tool", tools[0]);
    entry.setField("preset", tools[0].presets[0]);
    entry.setField("prompt", "自定义 @[node:two] 与 @hello");
    entry.setField(
        "references",
        ["one", "two"].map((id) => ({ id, name: id, kind: "image", resourceId: `resource-${id}`, previewUrl: "", progress: 100, uploading: false, role: "reference", slotKey: "A" })),
    );
    return entry;
}

test("切换场景取消不改变原场景、URL、预设、描述和槽位", async () => {
    const entry = seedDraft();
    await mount();
    const before = entry.store.getState();
    await chooseB();
    expect(entry.store.getState()).toEqual(before);
    expect(route).toBe("/image?tool=A");
    await press("返回");
    expect(entry.store.getState()).toEqual(before);
    expect(route).toBe("/image?tool=A");
});

test("场景确认追加才迁移槽位并清理被移除的结构化引用", async () => {
    const entry = seedDraft();
    await mount();
    await chooseB();
    await press("追加到末尾");
    expect(entry.store.getState().tool?.id).toBe("B");
    expect(entry.store.getState().references).toHaveLength(1);
    expect(entry.store.getState().references[0].slotKey).toBe("B");
    expect(entry.store.getState().prompt).toBe("自定义  与 @hello\nB模板1");
    expect(route).toBe("/image?tool=B&preset=B-0");
    expect(submissions).toBe(0);
});

test("外部场景链接的取消恢复旧地址，确认替换才更新草稿", async () => {
    const entry = seedDraft();
    await mount();
    await act(async () => navigate("/image?tool=B"));
    await press("返回");
    expect(route).toBe("/image?tool=A&preset=A-0");
    expect(entry.store.getState().references).toHaveLength(2);
    await act(async () => navigate("/image?tool=B"));
    await press("替换");
    expect(entry.store.getState().prompt).toBe("B模板1");
    expect(entry.store.getState().tool?.id).toBe("B");
});

test("页面切换保留各自草稿；失效结构化引用不发起任务", async () => {
    await mount("/image");
    await act(async () => editPrompt("图片草稿 @[node:missing]"));
    await act(async () => navigate("/video"));
    await act(async () => editPrompt("视频草稿"));
    await act(async () => navigate("/image"));
    expect(getWorkbenchDraft("image").store.getState().prompt).toBe("图片草稿 @[node:missing]");
    await act(async () => submit());
    expect(notices).toContain("描述中有已失效的素材引用，请删除或重新选择素材");
    expect(submissions).toBe(0);
    await act(async () => navigate("/video"));
    expect(getWorkbenchDraft("video").store.getState().prompt).toBe("视频草稿");
});

test("完整显示第六、第七效果，选中后按原规则替换模板", async () => {
    await mount();
    expect(document.querySelectorAll(".wb-preset")).toHaveLength(7);
    await press("效果7");
    expect(getWorkbenchDraft("image").store.getState().preset?.id).toBe("A-6");
    expect(getWorkbenchDraft("image").store.getState().prompt).toBe("A模板7");
    expect(route).toBe("/image?tool=A&preset=A-6");
});

test("同场景显式效果链接先确认，取消恢复地址，追加同步效果及 URL", async () => {
    const entry = seedDraft();
    await mount();
    const before = entry.store.getState();
    await act(async () => navigate("/image?tool=A&preset=A-6"));
    expect(entry.store.getState()).toEqual(before);
    await press("返回");
    expect(route).toBe("/image?tool=A&preset=A-0");
    expect(entry.store.getState()).toEqual(before);
    await act(async () => navigate("/image?tool=A&preset=A-6"));
    await press("追加到末尾");
    expect(entry.store.getState().preset?.id).toBe("A-6");
    expect(entry.store.getState().prompt).toBe("自定义 @[node:two] 与 @hello\nA模板7");
    expect(entry.store.getState().references).toEqual(before.references);
    expect(route).toBe("/image?tool=A&preset=A-6");
    await act(async () => navigate("/image?tool=A&preset=removed"));
    expect(route).toBe("/image?tool=A&preset=A-6");
    expect(submissions).toBe(0);
});

test("返回时已下架场景降为自由创作，保留描述和素材", async () => {
    const entry = seedDraft();
    await mount();
    await act(async () => navigate("/away"));
    availableTools = [];
    await act(async () => navigate("/image?tool=A"));
    expect(entry.store.getState()).toMatchObject({ tool: null, preset: null, prompt: "自定义 @[node:two] 与 @hello" });
    expect(entry.store.getState().references).toHaveLength(2);
    expect(entry.store.getState().references.every((item) => item.slotKey === undefined)).toBe(true);
    expect(route).toBe("/image");
    expect(submissions).toBe(0);
});

test("清空描述同步清除效果地址，离开再返回仍为空", async () => {
    await mount();
    await press("效果7");
    await press("清空");
    expect(route).toBe("/image?tool=A");
    await act(async () => navigate("/away"));
    await act(async () => navigate("/image?tool=A"));
    expect(getWorkbenchDraft("image").store.getState()).toMatchObject({ prompt: "", preset: null });
    expect(submissions).toBe(0);
});

for (const limit of [0, 1]) {
    test(`模型参考上限降到 ${limit}，素材仍可见可删除，不兼容提交被拦截`, async () => {
        const entry = seedDraft();
        entry.setField("tool", null);
        entry.setField("preset", null);
        await mount("/image");
        const next = structuredClone(stores.useConfigStore.getState().config);
        next.channels![0].modelCosts![0].capabilityConfig!.image!.references.maxImages = limit;
        await act(async () => stores.useConfigStore.setState({ config: next }));
        expect(document.querySelectorAll(".wb-ref-remove")).toHaveLength(2);
        expect(entry.store.getState().references).toHaveLength(2);
        expect(submitDisabled).toContain(limit ? "最多支持 1 个图片素材" : "不支持参考图片");
        expect(document.querySelector('[role="alert"]')?.textContent).toBe(submitDisabled);
        await act(async () => submit());
        expect(submissions).toBe(0);
        expect(notices).toContain(submitDisabled!);
        while (entry.store.getState().references.length > limit) {
            await act(async () => document.querySelector<HTMLButtonElement>(".wb-ref-remove")!.click());
        }
        expect(submitDisabled).toBeUndefined();
        expect(entry.store.getState().prompt).toContain("@hello");
    });
}

test("同一场景目录更新槽位后，兼容素材匹配新槽位并保留原内容", async () => {
    const entry = seedDraft();
    await mount();
    await act(async () => navigate("/away"));
    const changed = structuredClone(tools[0]);
    changed.inputContract!.slots[0].key = "new-slot";
    availableTools = [changed];
    await act(async () => navigate("/image?tool=A"));
    expect(entry.store.getState().references).toHaveLength(2);
    expect(entry.store.getState().references.every((item) => item.slotKey === "new-slot")).toBe(true);
    expect(document.querySelectorAll(".wb-ref-remove")).toHaveLength(2);
    expect(entry.store.getState().prompt).toBe("自定义 @[node:two] 与 @hello");
    expect(submitDisabled).toBeUndefined();
    expect(submissions).toBe(0);
});

test("目录槽位缩减后无法分配的素材直接可见，删除后恢复可提交状态", async () => {
    const entry = seedDraft();
    await mount();
    await act(async () => navigate("/away"));
    const changed = structuredClone(tools[0]);
    changed.inputContract!.slots[0].maxCount = 1;
    availableTools = [changed];
    await act(async () => navigate("/image?tool=A"));
    expect(entry.store.getState().references).toHaveLength(2);
    expect(entry.store.getState().references[1].slotKey).toBeUndefined();
    const remove = document.querySelector<HTMLButtonElement>('[aria-label="移除two"]')!;
    expect(remove.closest("details")).toBeNull();
    expect(document.body.textContent).toContain("未分配素材");
    expect(submitDisabled).toContain("有素材尚未匹配当前场景");
    await act(async () => submit());
    expect(submissions).toBe(0);
    await act(async () => remove.click());
    expect(entry.store.getState().references).toHaveLength(1);
    expect(submitDisabled).toBeUndefined();
    expect(entry.store.getState().prompt).toBe("自定义  与 @hello");
});
