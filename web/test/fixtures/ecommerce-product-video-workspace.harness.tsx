import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import localforage from "localforage";
import type { ComponentProps } from "react";
import type { ProductVideoDraft } from "@/pages/ecommerce/product-video-workspace";
import type { GenerationTask } from "@/services/api/task-center";
import type { ImageAsset } from "@/stores/use-asset-store";

const dom = new Window({ url: "http://localhost/ecommerce?mode=video" });
for (const key of [
    "document",
    "navigator",
    "HTMLElement",
    "HTMLBodyElement",
    "HTMLHtmlElement",
    "Element",
    "CustomEvent",
    "SVGElement",
    "ShadowRoot",
    "Node",
    "Event",
    "MutationObserver",
    "ResizeObserver",
    "IntersectionObserver",
    "localStorage",
    "sessionStorage",
] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, value: dom[key] });
}
Object.assign(globalThis, { window: dom, getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true });
mock.module("@/components/cached-resource-image", () => ({ CachedResourceImage: ({ alt, onLoad, storageKey }: Pick<ComponentProps<"img">, "alt" | "onLoad"> & { storageKey?: string }) => <img alt={alt} onLoad={onLoad} data-resource={storageKey} /> }));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider, notifyManager, defaultScheduler } = await import("@tanstack/react-query");
const { ProductVideoWorkspace } = await import("@/pages/ecommerce/product-video-workspace");
const { emptyEcommerceDraft } = await import("@/services/api/ecommerce");
const { defaultModelCapabilityConfig } = await import("@/lib/model-capabilities");
const { createModelChannel, defaultConfig } = await import("@/stores/use-config-store");
const mediaMetadata = await import("@/lib/media-metadata");
const resources = await import("@/services/api/resources");
const assetSync = await import("@/services/user-data-sync");
const { useUserStore } = await import("@/stores/use-user-store");
const { getActiveUserScope, setActiveUserScope } = await import("@/lib/user-scope");
const pricing = await import("@/services/api/logical-models");
const tasks = await import("@/services/api/task-center");
const quote = spyOn(pricing, "quoteModel").mockResolvedValue({ quote: { logicalModelId: "clip", quantity: 15, billingMode: "per_second", amountMicrocredits: 2000000, estimated: false } });
const createTask = spyOn(tasks, "createGenerationTask").mockRejectedValue(new Error("本用例禁止提交生成任务"));
const listTasks = spyOn(tasks, "listGenerationTasks").mockResolvedValue([]);
const stored = new Map<string, unknown>();
const readCache = spyOn(localforage, "getItem").mockImplementation(async <T,>(key: string) => (stored.get(key) as T) ?? null);
const writeCache = spyOn(localforage, "setItem").mockImplementation(async <T,>(key: string, value: T) => {
    stored.set(key, value);
    return value;
});
spyOn(localforage, "removeItem").mockImplementation(async (key: string) => {
    stored.delete(key);
});
const { promoteProductVideoDraft, readProductVideoDraft } = await import("@/pages/ecommerce/product-video-draft");
const { isProductVideoVersion } = await import("@/pages/ecommerce/product-video-version");
const silentProfile = defaultModelCapabilityConfig("volcengine-ark-video");
silentProfile.video!.numberedImageReferences = true;
silentProfile.video!.references.maxVideos = 0;
silentProfile.video!.generateAudio = { supported: false, default: false };
const channel = createModelChannel({
    id: "studio",
    name: "本地",
    scope: "system",
    models: ["clip", "planner"],
    modelCosts: [
        { model: "clip", capability: "video", capabilityConfig: silentProfile, protocol: "volcengine-ark-video", billingMode: "per_second", unitPriceMicrocredits: 10000 },
        { model: "planner", capability: "text", capabilityConfig: defaultModelCapabilityConfig("newapi"), protocol: "newapi", billingMode: "fixed_request", unitPriceMicrocredits: 10000 },
    ],
});
const audioProfile = structuredClone(silentProfile);
audioProfile.video!.generateAudio = { supported: true, default: false };
const soundChannel = { ...channel, modelCosts: channel.modelCosts?.map((cost) => (cost.capability === "video" ? { ...cost, capabilityConfig: audioProfile } : cost)) };
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: InstanceType<typeof QueryClient>;
let editCache: { current: ProductVideoDraft | null };
function availableImage(id: string) {
    return { id, userId: "studio-user", kind: "image", status: "ready", provider: "local", endpoint: "", bucket: "", objectKey: id, publicUrl: "", mimeType: "image/webp", size: 64, createdAt: "", updatedAt: "" };
}
beforeEach(() => {
    spyOn(resources, "refreshResource").mockImplementation(async (id) => availableImage(id));
    stored.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    editCache = { current: null };
    quote.mockClear();
    createTask.mockClear();
    listTasks.mockReset().mockResolvedValue([]);
    sessionStorage.clear();
});
afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
});
afterAll(() => dom.happyDOM.abort());

async function render(overrides: Partial<ComponentProps<typeof ProductVideoWorkspace>> = {}) {
    await act(async () =>
        root.render(
            <QueryClientProvider client={client}>
                <ProductVideoWorkspace
                    scope="studio-user"
                    sessionId="studio-session"
                    draft={{ ...emptyEcommerceDraft(), productName: "旅行收纳包" }}
                    config={{ ...defaultConfig, channels: [soundChannel], videoModel: "studio::clip" }}
                    editCache={editCache}
                    images={[]}
                    visionModel=""
                    visionIssue="测试未启用识图"
                    uploading={false}
                    onUpload={async () => undefined}
                    ensureProject={async () => "project"}
                    view="create"
                    onLockChange={() => {}}
                    onViewChange={() => {}}
                    {...overrides}
                />
            </QueryClientProvider>,
        ),
    );
}
function findButton(text: string, container: ParentNode = host) {
    return [...container.querySelectorAll<HTMLButtonElement>("button")].find((node) => (node.getAttribute("aria-label") || node.textContent)?.trim() === text);
}
function button(text: string, container: ParentNode = host) {
    const found = findButton(text, container);
    expect(found, text).toBeDefined();
    return found!;
}
function remixChoice(title: "贴近原片" | "灵活改编") {
    const radio = host.querySelector<HTMLInputElement>(`input[type="radio"][aria-label="${title}"]`);
    expect(radio, title).not.toBeNull();
    return radio!;
}
function salesApproach(title: string) {
    const radio = [...host.querySelectorAll<HTMLInputElement>('.ec-sales-gallery input[type="radio"]')].find((input) => input.getAttribute("aria-label") === title);
    expect(radio, title).toBeDefined();
    return radio!;
}

async function openScript() {
    const summary = [...host.querySelectorAll("summary")].find((node) => node.textContent?.trim() === "自定义脚本");
    expect(summary, "自定义脚本").toBeDefined();
    if (!summary!.parentElement?.hasAttribute("open")) await click(summary!);
}

async function click(element: HTMLElement) {
    await act(async () => element.click());
}
function fields() {
    return [...host.querySelectorAll<HTMLTextAreaElement>('textarea[id^="ec-video-shot-"]')].map((field) => field.value);
}
async function edit(id: string, text: string) {
    const input = host.querySelector<HTMLTextAreaElement>(`#${id}`)!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

test("带货视频在一页展示九种拍法，无图可浏览和编辑，上传仅打开文件选择", async () => {
    await render();
    expect(host.querySelector('nav[aria-label="商品视频制作步骤"]')).toBeNull();
    const titles = ["达人口播推荐", "买家问答", "边用边讲", "日常种草", "开箱分享", "情景带货", "使用演示", "痛点解决", "选购对照"];
    expect(host.querySelectorAll(".ec-sales-gallery input")).toHaveLength(9);
    for (const title of titles) expect(salesApproach(title)).toBeDefined();
    expect(salesApproach("达人口播推荐").checked).toBe(true);
    await click(salesApproach("买家问答"));
    await openScript();
    expect(fields()).toHaveLength(3);
    await edit("ec-video-shot-0", "第一镜从拉开收纳包开始");
    expect(fields()[0]).toBe("第一镜从拉开收纳包开始");
    const file = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    const pickFile = spyOn(file, "click");
    expect(file.multiple).toBe(true);
    await click(button("上传商品参考图"));
    expect(pickFile).toHaveBeenCalledTimes(1);
    expect(findButton("查看报价")?.disabled ?? true).toBe(true);
    expect(quote).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
});

test("带货商品图批量导入保留成功项，三张可排序移除，报价和任务都按当前参考图顺序", async () => {
    const importer = mock(async (file: File) => {
        if (file.name === "坏图.webp") throw new Error("坏图无法上传");
        return file.name.split(".")[0];
    });
    await render({ onUpload: importer });
    async function chooseFiles(names: string[]) {
        const input = host.querySelector<HTMLInputElement>('input[aria-label="选择商品参考图文件"]')!;
        Object.defineProperty(input, "files", { configurable: true, value: names.map((name) => new File(["fixture"], name, { type: "image/webp" })) });
        await act(async () => {
            input.dispatchEvent(new Event("change", { bubbles: true }));
        });
    }
    const ids = () => editCache.current?.productImages?.map((item) => item.resourceId);
    await chooseFiles(["a.webp", "b.webp", "c.webp", "d.webp"]);
    expect(importer).not.toHaveBeenCalled();
    expect(host.textContent).toContain("最多可选择 3 张");
    await chooseFiles(["front.webp", "坏图.webp", "side.webp"]);
    expect(host.textContent).toContain("坏图无法上传");
    expect(ids()).toEqual(["front", "side"]);
    const images = [{ resourceId: "detail", name: "项目细节图" }];
    await render({ images, onUpload: importer });
    await click(button("项目细节图"));
    expect(ids()).toEqual(["front", "side", "detail"]);
    expect(button("从素材库选择商品参考图").disabled).toBe(true);
    await click(button("向前移动项目细节图"));
    expect(ids()).toEqual(["front", "detail", "side"]);
    await click(button("查看报价"));
    expect(quote.mock.calls.at(-1)?.[0].intent).toMatchObject({ operation: "reference_to_video", inputs: { image: 3, video: 0 } });
    await click(button("移除side.webp"));
    expect(findButton("确认生成 1 条视频")).toBeUndefined();
    await act(async () => root.render(null));
    editCache = { current: null };
    await render({ images, onUpload: importer });
    expect(ids()).toEqual(["front", "detail"]);
    await chooseFiles(["side.webp"]);
    expect(ids()).toEqual(["front", "detail", "side"]);
    await click(button("查看报价"));
    createTask.mockResolvedValueOnce({ id: "three-product-images", type: "canvas_video", status: "queued", attempts: 0, createdAt: "", updatedAt: "", prompt: "" });
    await click(button("确认生成 1 条视频"));
    expect(createTask).toHaveBeenCalledTimes(1);
    const submitted = createTask.mock.calls[0][0];
    expect(submitted.operation).toBe("reference_to_video");
    expect(submitted.input?.referenceImages).toEqual(ids()!.map((id) => expect.objectContaining({ id, role: "reference", storageKey: `resource:${id}` })));
    expect(submitted.input?.metadata?.ecommerceVideoVersion).toMatchObject({ productImages: editCache.current!.productImages });
    expect(submitted.input?.metadata).not.toHaveProperty("videoStartFrameNodeId");
    expect(submitted.input?.metadata).not.toHaveProperty("videoEndFrameNodeId");
    for (const name of ["front.webp", "项目细节图", "side.webp"]) await click(button(`移除${name}`));
    await act(async () => root.render(null));
    editCache = { current: null };
    await render({ images, onUpload: importer });
    expect(ids()).toEqual([]);
    expect(button("查看报价").disabled).toBe(true);
});

test("选库图可取消、校验归属与可用性、恢复首帧并要求口播换图重确", async () => {
    const scope = "studio-user";
    const previousScope = getActiveUserScope();
    const { user, hydrated } = useUserStore.getState();
    setActiveUserScope(scope);
    useUserStore.setState({ user: { id: scope, username: "fixture", displayName: "fixture", role: "user", status: "active" }, hydrated: true });
    notifyManager.setScheduler(queueMicrotask);
    const images = [{ resourceId: "product", name: "项目商品原图" }];
    const options = { scope, projectId: "project", images };
    const libraryAssets: ImageAsset[] = ["first", "second", "foreign", "deleted", "wrong-kind"].map((id) => ({
        id: `asset-${id}`,
        kind: "image",
        title: `素材库 ${id}`,
        tags: [],
        coverUrl: "",
        createdAt: "",
        updatedAt: "",
        data: { storageKey: `resource:${id}`, dataUrl: "", width: 720, height: 1280, bytes: 64, mimeType: "image/webp" },
    }));
    libraryAssets.push({ ...libraryAssets[0], id: "asset-cover-only", title: "只有预览封面", coverUrl: "/fixtures/cover.webp", data: { ...libraryAssets[0].data, storageKey: "local-preview" } });
    const library = spyOn(assetSync, "loadAssetLibraryPage").mockResolvedValue({ assets: libraryAssets, total: libraryAssets.length, page: 1, pageSize: 40, categoryCounts: {} });
    let secondAvailable = true;
    const lookup = spyOn(resources, "refreshResource").mockImplementation(async (id) => ({
        id,
        userId: id === "foreign" ? "another-user" : scope,
        kind: id === "wrong-kind" ? "video" : "image",
        status: id === "deleted" || (id === "second" && !secondAvailable) ? "deleted" : "ready",
        provider: "local",
        endpoint: "",
        bucket: "",
        objectKey: id,
        publicUrl: "",
        mimeType: "image/webp",
        size: 64,
        createdAt: "",
        updatedAt: "",
    }));
    const upload = spyOn(resources, "uploadResourceFile").mockRejectedValue(new Error("已有素材无需重新上传"));
    function dialog() {
        const node = document.querySelector<HTMLElement>(".asset-picker-shell");
        expect(node).not.toBeNull();
        return node!;
    }
    async function pick(label: string, ...ids: string[]) {
        await click(button(label));
        const picker = dialog();
        for (const id of ids) {
            const card = picker.querySelector<HTMLButtonElement>(`button.asset-picker-card-action[title="素材库 ${id}"]`);
            expect(card).not.toBeNull();
            await click(card!);
        }
        await click(button(`使用 ${ids.length} 个素材`, picker));
    }
    try {
        await render(options);
        const basic = "从素材库选择商品参考图";
        const presenter = "从素材库选择人货同框图";
        await click(button(basic));
        const modal = dialog().closest('[role="dialog"]');
        expect(document.getElementById(modal?.getAttribute("aria-labelledby") || "")?.textContent).toBe("从素材库选择「商品参考图」");
        expect(library).toHaveBeenCalledWith(expect.objectContaining({ kind: "image" }));
        const unsynced = [...dialog().querySelectorAll<HTMLButtonElement>(".asset-picker-card-action")].find((item) => item.textContent?.includes("只有预览封面"));
        expect(unsynced?.disabled).toBe(true);
        expect(unsynced?.textContent).toContain("素材尚未同步，请从设备上传原文件");
        await click(unsynced!);
        expect(button("使用所选素材", dialog()).disabled).toBe(true);
        expect(upload).not.toHaveBeenCalled();
        const cancel = dialog().querySelector<HTMLButtonElement>(".asset-picker-actions button");
        expect(cancel).not.toBeNull();
        await click(cancel!);
        expect(lookup).not.toHaveBeenCalledWith("first");
        expect(editCache.current?.libraryFrame).toBeUndefined();
        await pick(basic, "first", "second");
        expect(editCache.current?.productImages).toContainEqual({ resourceId: "first", name: "素材库 first", source: "library" });
        expect(lookup).toHaveBeenCalledWith("first");
        await act(async () => root.render(null));
        editCache = { current: null };
        await render(options);
        expect(editCache.current?.productImages).toContainEqual({ resourceId: "first", name: "素材库 first", source: "library" });
        await click(button("视频复刻"));
        await pick("从素材库选择商品参考图", "first");
        expect(editCache.current?.chosenImage).toBe("first");
        expect(editCache.current?.referenceVideo).toBeUndefined();
        await click(button("人物口播"));
        expect(findButton("确认使用这张同框图")).toBeUndefined();
        await pick(presenter, "first");
        const preview = () => host.querySelector<HTMLImageElement>(".ec-video-frame-ready img")!;
        await act(async () => {
            preview().dispatchEvent(new Event("load"));
        });
        await click(button("确认使用这张同框图"));
        expect(editCache.current?.presenter?.frameResourceId).toBe("first");
        await pick(presenter, "second");
        expect(editCache.current?.presenterPhoto?.resourceId).toBe("second");
        expect(editCache.current?.chosenImage).toBe("first");
        expect(editCache.current?.presenter?.frameResourceId).toBeUndefined();
        expect(button("确认使用这张同框图").disabled).toBe(true);
        await act(async () => {
            preview().dispatchEvent(new Event("load"));
        });
        expect(button("确认使用这张同框图").disabled).toBe(false);
        await click(button("带货视频"));
        await click(button("移除素材库 first"));
        await pick(basic, "second");
        expect(editCache.current?.productImages?.map((image) => image.resourceId)).toEqual(["product", "second"]);
        expect(dialog().textContent).toContain("已经添加");
        await click(dialog().querySelector<HTMLButtonElement>(".asset-picker-actions button")!);
        for (const id of ["foreign", "deleted", "wrong-kind"]) {
            await pick(basic, id);
            expect(lookup).toHaveBeenCalledWith(id);
            expect(editCache.current?.productImages?.map((image) => image.resourceId)).toEqual(["product", "second"]);
            expect([...document.querySelectorAll('[role="alert"]')].some((node) => Boolean(node.textContent?.trim()))).toBe(true);
            const close = document.querySelector<HTMLButtonElement>(".asset-picker-actions button");
            if (close && document.querySelector(".asset-picker-footer-error")) await click(close);
        }
        expect(quote).not.toHaveBeenCalled();
        expect(createTask).not.toHaveBeenCalled();
        expect(upload).not.toHaveBeenCalled();
        await click(button("查看报价"));
        secondAvailable = false;
        await click(button("确认生成 1 条视频"));
        expect(createTask).not.toHaveBeenCalled();
        expect(quote).toHaveBeenCalledTimes(1);
        expect(host.textContent).toContain("当前不可用");
        secondAvailable = true;
        await click(button("查看报价"));
        createTask.mockResolvedValueOnce({ id: "library-video", type: "canvas_video", status: "queued", attempts: 0, createdAt: "", updatedAt: "", prompt: "" });
        await click(button("确认生成 1 条视频"));
        expect(createTask).toHaveBeenCalledTimes(1);
        expect(createTask.mock.calls[0][0].input).toMatchObject({
            referenceImages: [
                { id: "product", storageKey: "resource:product", role: "reference" },
                { id: "second", storageKey: "resource:second", role: "reference" },
            ],
            metadata: { ecommerceVideoVersion: { productImages: [{ resourceId: "product" }, { resourceId: "second", source: "library" }] } },
        });
    } finally {
        await act(async () => root.render(null));
        notifyManager.setScheduler(defaultScheduler);
        library.mockRestore();
        lookup.mockRestore();
        upload.mockRestore();
        useUserStore.setState({ user, hydrated });
        setActiveUserScope(previousScope);
    }
});

test("参考复刻按实测参考片报价，恢复草稿后须再次确认才提交商品图与视频", async () => {
    const images = [{ resourceId: "product-image", name: "商品正面" }];
    const account = "studio-user";
    const durationMs = 7240;
    const reference = { resourceId: "reference-clip", name: "走位.mp4", durationMs };
    const resource = {
        id: reference.resourceId,
        userId: account,
        kind: "video",
        status: "ready",
        provider: "local",
        endpoint: "",
        bucket: "",
        objectKey: "qa/video.mp4",
        publicUrl: "",
        mimeType: "video/mp4",
        size: 128,
        durationMs,
        createdAt: "",
        updatedAt: "",
    };
    const probe = spyOn(mediaMetadata, "probeMediaDurationMs").mockResolvedValue(durationMs);
    const upload = spyOn(resources, "uploadResourceFile").mockResolvedValue(resource);
    const lookup = spyOn(resources, "refreshResource").mockImplementation(async (id) => (id === resource.id ? resource : availableImage(id)));
    const previousScope = getActiveUserScope();
    setActiveUserScope(account);
    // Deliver refetch results inside React act before the next user interaction.
    notifyManager.setScheduler(queueMicrotask);
    const remixProfile = defaultModelCapabilityConfig("volcengine-ark-video");
    remixProfile.video!.numberedImageReferences = true;
    remixProfile.video!.remixReferences = true;
    remixProfile.video!.remixGenerateAudio = true;
    remixProfile.video!.generateAudio = { supported: true, default: false };
    const compatible = createModelChannel({
        id: "studio-remix",
        name: "复刻测试",
        scope: "system",
        models: ["remix"],
        modelCosts: [{ model: "remix", capability: "video", protocol: "volcengine-ark-video", capabilityConfig: remixProfile, billingMode: "per_second", unitPriceMicrocredits: 10000 }],
    });
    const config = { ...defaultConfig, channels: [channel, compatible], videoModel: "studio-remix::remix" };
    try {
        await render({ images });
        await click(salesApproach("买家问答"));
        await openScript();
        const salesShots = fields();
        expect(salesShots[0]).toContain("主播");
        const salesVoice = "如果你也经常找不到钥匙，来看看这个隔层。";
        await edit("ec-video-voice", salesVoice);
        await click(button("视频复刻"));
        expect(host.querySelector('nav[aria-label="商品视频制作步骤"]')).toBeNull();
        expect(remixChoice("贴近原片").checked).toBe(true);
        expect(findButton("使用此拍法")).toBeUndefined();
        const input = host.querySelector<HTMLInputElement>('input[type="file"][accept*="video"]')!;
        expect(input).not.toBeNull();
        const file = new File(["local"], reference.name, { type: "video/mp4" });
        Object.defineProperty(input, "files", { configurable: true, value: [file] });
        await act(async () => {
            input.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(probe).toHaveBeenCalledWith(file);
        expect(upload).toHaveBeenCalledTimes(1);
        expect(editCache.current?.referenceVideo).toMatchObject(reference);
        expect(findButton("查看报价")?.disabled ?? true).toBe(true);
        expect(quote).not.toHaveBeenCalled();
        expect(createTask).not.toHaveBeenCalled();

        await render({ images, config });
        expect(button("查看报价").disabled).toBe(false);
        await openScript();
        const autoShots = fields();
        expect(autoShots).toHaveLength(3);
        expect(autoShots.join(" ")).toContain("参考片");
        expect(autoShots).not.toEqual(salesShots);
        await edit("ec-video-shot-0", "沿参考片的开场动线拉开提包拉链");
        const originalShots = fields();
        expect(host.querySelector<HTMLTextAreaElement>("#ec-video-voice")?.value).toBe("");
        const remixVoice = "参考片的镜头走到这里，拉开拉链。";
        await edit("ec-video-voice", remixVoice);
        const withoutAudio = structuredClone(remixProfile);
        withoutAudio.video!.remixGenerateAudio = false;
        const silentRemix = { ...compatible, modelCosts: compatible.modelCosts?.map((cost) => ({ ...cost, capabilityConfig: withoutAudio })) };
        await render({ images, config: { ...config, channels: [silentRemix] } });
        expect(button("查看报价").disabled).toBe(true);
        expect(host.textContent).toMatch(/有声|声音/);
        await edit("ec-video-voice", "");
        expect(button("查看报价").disabled).toBe(false);
        await edit("ec-video-voice", remixVoice);
        await render({ images, config });
        await click(button("查看报价"));
        expect(quote.mock.calls[0][0]).toMatchObject({ intent: { operation: "reference_to_video", inputs: { image: 1, video: 1 }, referenceVideoDurationsMs: [durationMs], options: { videoGenerateAudio: true } } });
        expect(createTask).not.toHaveBeenCalled();
        await act(async () => root.render(null));
        editCache = { current: null };
        await render({ images, config });
        expect(editCache.current?.mode).toBe("reference");
        expect(editCache.current?.referenceVideo).toMatchObject(reference);
        expect(fields()).toEqual(originalShots);
        expect(findButton("确认生成 1 条视频")).toBeUndefined();
        expect(quote).toHaveBeenCalledTimes(1);
        expect(createTask).not.toHaveBeenCalled();

        await act(async () => root.render(null));
        editCache = { current: null };
        lookup.mockImplementation(async (id) => (id === resource.id ? { ...resource, status: "deleted" } : availableImage(id)));
        await render({ images, config });
        expect(lookup).toHaveBeenCalledWith(reference.resourceId);
        expect(findButton("查看报价")?.disabled ?? true).toBe(true);
        expect(quote).toHaveBeenCalledTimes(1);
        expect(createTask).not.toHaveBeenCalled();
        lookup.mockImplementation(async (id) => (id === resource.id ? resource : availableImage(id)));
        await click(button("带货视频"));
        expect(salesApproach("买家问答").checked).toBe(true);
        await openScript();
        expect(fields()).toEqual(salesShots);
        expect(host.querySelector<HTMLTextAreaElement>("#ec-video-voice")?.value).toBe(salesVoice);
        await click(button("查看报价"));
        expect(quote.mock.calls.at(-1)![0].intent).toMatchObject({ operation: "reference_to_video", inputs: { image: 1, video: 0 } });
        expect(quote.mock.calls.at(-1)![0].intent?.referenceVideoDurationsMs).toBeUndefined();
        await click(button("视频复刻"));
        expect(fields()).toEqual(originalShots);
        expect(host.querySelector<HTMLTextAreaElement>("#ec-video-voice")?.value).toBe(remixVoice);
        expect(findButton("确认生成 1 条视频")).toBeUndefined();
        await click(button("查看报价"));
        expect(createTask).not.toHaveBeenCalled();
        quote.mockRejectedValueOnce(new Error("暂时无法重新获取报价"));
        await click(button("确认生成 1 条视频"));
        expect(findButton("确认生成 1 条视频")).toBeUndefined();
        expect(host.textContent).toContain("暂时无法重新获取报价");
        expect(createTask).not.toHaveBeenCalled();
        await click(button("查看报价"));
        lookup.mockImplementation(async (id) => (id === resource.id ? { ...resource, durationMs: durationMs + 1 } : availableImage(id)));
        await click(button("确认生成 1 条视频"));
        expect(host.textContent).toContain("参考视频已失效或时长有变化");
        expect(createTask).not.toHaveBeenCalled();
        lookup.mockImplementation(async (id) => (id === resource.id ? resource : availableImage(id)));
        await click(button("重新核对素材"));
        await click(button("查看报价"));
        const updatedQuote = { quote: { logicalModelId: "clip", quantity: 15, billingMode: "per_second" as const, amountMicrocredits: 3000000, estimated: false } };
        quote.mockResolvedValueOnce(updatedQuote).mockResolvedValueOnce(updatedQuote);
        await click(button("确认生成 1 条视频"));
        expect(host.textContent).toContain("报价已更新");
        expect(createTask).not.toHaveBeenCalled();
        createTask.mockResolvedValueOnce({ id: "local-remix-task", type: "canvas_video", status: "queued", prompt: "", attempts: 0, createdAt: "", updatedAt: "" });
        await click(button("确认生成 1 条视频"));
        expect(createTask).toHaveBeenCalledTimes(1);
        const submitted = createTask.mock.calls[0][0];
        expect(submitted.input?.referenceImages).toEqual([expect.objectContaining({ id: images[0].resourceId, storageKey: "resource:product-image", role: "reference" })]);
        expect(submitted.input?.referenceVideos).toEqual([expect.objectContaining({ id: reference.resourceId, storageKey: "resource:reference-clip", durationMs })]);
        expect(submitted.input?.metadata).toMatchObject({
            videoEditOperation: "reference_to_video",
            ecommerceVideoVersion: { referenceVideo: reference, shots: originalShots, voice: remixVoice, settings: { generateAudio: true } },
            ecommerceVideoQuote: { billingMode: "per_second", amountMicrocredits: 3000000 },
        });
        for (const shot of salesShots) expect(submitted.prompt).not.toContain(shot);
        expect(submitted.prompt).not.toContain(salesVoice);
        expect(submitted.prompt).toContain(remixVoice);
        expect(submitted.input?.metadata).not.toHaveProperty("videoStartFrameNodeId");
    } finally {
        notifyManager.setScheduler(defaultScheduler);
        setActiveUserScope(previousScope);
        probe.mockRestore();
        upload.mockRestore();
        lookup.mockRestore();
    }
});

test("带货视频旧分镜图默认仅预演，启用后报价与提交使用相同的商品图和分镜图", async () => {
    const images = [
        { resourceId: "bag", name: "商品正面" },
        { resourceId: "detail", name: "内袋特写" },
    ];
    const salesProfile = defaultModelCapabilityConfig("volcengine-ark-video");
    salesProfile.video!.numberedImageReferences = true;
    const compatible = createModelChannel({
        id: "sales",
        name: "多图测试",
        scope: "system",
        models: ["clip"],
        modelCosts: [{ model: "clip", capability: "video", protocol: "volcengine-ark-video", capabilityConfig: salesProfile, billingMode: "per_second", unitPriceMicrocredits: 10000 }],
    });
    const config = { ...defaultConfig, channels: [compatible], videoModel: "sales::clip" };
    const scope = "studio-user";
    let detailAvailable = true;
    let bagAvailable = true;
    const lookup = spyOn(resources, "refreshResource").mockImplementation(async (id) => ({
        id,
        userId: scope,
        kind: "image",
        status: (id === "detail" && !detailAvailable) || (id === "bag" && !bagAvailable) ? "deleted" : "ready",
        mimeType: "image/png",
        provider: "local",
        objectKey: id,
        endpoint: "",
        publicUrl: "",
        bucket: "",
        size: 100,
        createdAt: "",
        updatedAt: "",
    }));
    editCache.current = {
        scope,
        sessionId: "studio-session",
        projectId: "project",
        chosenImage: "bag",
        chosenModel: "sales::clip",
        facts: "有两个内袋",
        purpose: "demo",
        picking: false,
        voice: "",
        step: "review",
        story: { purpose: "demo", shots: ["展示旅行包", "展示内袋", "放入钥匙"], edited: true, boards: [{}, { frame: images[1] }, { frame: images[1] }] },
    };
    try {
        await render({ config, images, projectId: "project" });
        await openScript();
        const toggle = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((control) => control.labels?.[0]?.textContent.includes("生成时使用分镜参考图"))!;
        expect(toggle.checked).toBe(false);
        await click(button("查看报价"));
        expect(quote.mock.calls.at(-1)?.[0].intent).toMatchObject({ operation: "reference_to_video", inputs: { image: 1, video: 0 } });
        await click(toggle);
        expect(findButton("确认生成 1 条视频")).toBeUndefined();
        await render({ config, images: [images[1]], projectId: "project" });
        bagAvailable = false;
        await click(button("查看报价"));
        expect(host.textContent).toContain("当前不可用");
        expect(quote).toHaveBeenCalledTimes(1);
        bagAvailable = true;
        await render({ config, images, projectId: "project" });
        await click(button("查看报价"));
        expect(quote.mock.calls.at(-1)?.[0].intent).toMatchObject({ operation: "reference_to_video", inputs: { image: 2, video: 0 }, options: { videoSeconds: 15 } });
        detailAvailable = false;
        await click(button("确认生成 1 条视频"));
        expect(host.textContent).toContain("内袋特写」当前不可用");
        expect(createTask).not.toHaveBeenCalled();
        detailAvailable = true;
        await click(button("查看报价"));
        createTask.mockResolvedValueOnce({ id: "sales-task", type: "canvas_video", status: "queued", prompt: "", attempts: 0, createdAt: "", updatedAt: "" });
        await click(button("确认生成 1 条视频"));
        expect(createTask).toHaveBeenCalledTimes(1);
        const submitted = createTask.mock.calls[0][0];
        expect(submitted.operation).toBe("reference_to_video");
        expect(submitted.input?.referenceImages).toEqual(images.map(({ resourceId }) => expect.objectContaining({ id: resourceId, role: "reference", storageKey: `resource:${resourceId}` })));
        expect(submitted.input?.metadata).toMatchObject({ ecommerceVideoVersion: { boardInputs: true }, ecommerceVideoQuote: { billingMode: "per_second", amountMicrocredits: 2000000 } });
        expect(submitted.input?.metadata).not.toHaveProperty("videoStartFrameNodeId");
        expect(submitted.prompt).toContain("【参考图2】展示内袋");
        expect(submitted.prompt).toContain("【参考图2】放入钥匙");
    } finally {
        lookup.mockRestore();
    }
});

test("人物口播同页确认首帧、台词和有声模型，换图改稿后重新核价，从作品恢复原稿", async () => {
    const images = [
        { resourceId: "front-frame", name: "手持商品正面" },
        { resourceId: "side-frame", name: "手持商品侧面" },
    ];
    const voice = "拉开这层拉链，就能把钥匙和卡片分开放。";
    const projectId = "presenter-project";
    const scope = "studio-user";
    const previousScope = getActiveUserScope();
    setActiveUserScope(scope);
    notifyManager.setScheduler(queueMicrotask);
    const lookup = spyOn(resources, "refreshResource").mockImplementation(async (id) => ({
        id,
        userId: scope,
        kind: "image",
        status: "ready",
        provider: "local",
        mimeType: "image/webp",
        size: 1024,
        endpoint: "",
        bucket: "",
        objectKey: id,
        publicUrl: "",
        createdAt: "",
        updatedAt: "",
    }));
    const presenterProfile = defaultModelCapabilityConfig("volcengine-ark-video");
    presenterProfile.video!.presenterFirstFrameAudio = true;
    const compatible = createModelChannel({
        id: "speak",
        scope: "system",
        name: "有声测试",
        models: ["presenter"],
        modelCosts: [{ model: "presenter", capability: "video", protocol: "volcengine-ark-video", capabilityConfig: presenterProfile, billingMode: "per_second", unitPriceMicrocredits: 10000 }],
    });
    const options = { scope, projectId, images, ensureProject: async () => projectId };
    const configured = { ...options, config: { ...defaultConfig, channels: [soundChannel, compatible], videoModel: "studio::clip" } };
    async function loadFrame(id: string) {
        const rendered = host.querySelectorAll<HTMLImageElement>(`img[data-resource="resource:${id}"]`);
        expect(rendered.length).toBeGreaterThan(0);
        await act(async () => {
            for (const image of rendered) image.dispatchEvent(new Event("load"));
        });
    }
    try {
        await render({ ...options, config: { ...defaultConfig, channels: [soundChannel], videoModel: "studio::clip" } });
        await click(button("人物口播"));
        expect(host.querySelectorAll('nav[aria-label="商品视频制作步骤"]').length).toBe(0);
        const voiceInput = () => host.querySelector<HTMLTextAreaElement>("#ec-video-voice")!;
        expect(voiceInput()).not.toBeNull();
        expect(Boolean(voiceInput().closest("[hidden], details:not([open])"))).toBe(false);
        expect(Boolean(button("查看报价").closest("[hidden], details:not([open])"))).toBe(false);
        expect(button("查看报价").disabled).toBe(true);
        expect(host.querySelector(".ec-frame-composer")).toBeNull();
        expect(host.querySelector(".ec-video-frame-ready")).toBeNull();
        expect(findButton("确认使用这张同框图")).toBeUndefined();
        await click(button("选模特合成"));
        expect(host.querySelector(".ec-frame-composer")).not.toBeNull();
        await click(button("使用已有同框图"));
        expect(host.querySelector(".ec-frame-composer")).toBeNull();
        await click(button(images[0].name));
        expect(button("确认使用这张同框图").disabled).toBe(true);
        await loadFrame(images[0].resourceId);
        await click(button("确认使用这张同框图"));
        const label = [...host.querySelectorAll("label")].find((node) => node.textContent?.includes("边用边讲") && node.querySelector('input[type="radio"]'));
        expect(label).toBeDefined();
        await click(label!.querySelector<HTMLInputElement>("input")!);
        await edit("ec-video-voice", voice);
        expect(findButton("查看报价")?.disabled ?? true).toBe(true);
        expect(quote).not.toHaveBeenCalled();
        expect(createTask).not.toHaveBeenCalled();

        await render(configured);
        await click(button("查看报价"));
        expect(quote.mock.calls[0][0]).toMatchObject({ channelId: "speak", intent: { operation: "image_to_video", inputs: { image: 1, video: 0, audio: 0 }, options: { videoSeconds: 15, videoGenerateAudio: true } } });
        expect(createTask).not.toHaveBeenCalled();
        const interimVoice = "出门时我会把钥匙和卡片分开放在不同的内袋里。".repeat(4);
        await edit("ec-video-voice", interimVoice);
        expect(host.querySelector("#" + voiceInput().getAttribute("aria-describedby"))?.textContent).toContain("试读");
        expect(voiceInput().value).toBe(interimVoice);
        expect(findButton("确认生成 1 条视频")).toBeUndefined();
        await click(button("查看报价"));
        expect(button("确认生成 1 条视频").disabled).toBe(false);
        await click(button(images[1].name));
        expect(findButton("确认生成 1 条视频")).toBeUndefined();
        await click(button(images[0].name));
        await loadFrame(images[0].resourceId);
        expect(button("确认使用这张同框图").disabled).toBe(false);
        expect(findButton("查看报价")?.disabled ?? true).toBe(true);
        await click(button(images[1].name));
        await loadFrame(images[1].resourceId);
        expect(button("确认使用这张同框图").disabled).toBe(false);
        expect(findButton("查看报价")?.disabled ?? true).toBe(true);
        await click(button("确认使用这张同框图"));
        await edit("ec-video-voice", "  ");
        expect(findButton("查看报价")?.disabled ?? true).toBe(true);
        await edit("ec-video-voice", voice);
        await act(async () => root.render(null));
        editCache = { current: null };
        await render(configured);
        await loadFrame(images[1].resourceId);
        expect(editCache.current?.presenter).toMatchObject({ frameResourceId: "side-frame", delivery: "demonstrate" });
        expect(voiceInput().value).toBe(voice);
        expect(quote).toHaveBeenCalledTimes(2);
        expect(createTask).not.toHaveBeenCalled();
        await click(button("查看报价"));
        expect(createTask).not.toHaveBeenCalled();
        createTask.mockResolvedValueOnce({ id: "presenter-task", projectId, type: "canvas_video", status: "queued", prompt: "", attempts: 0, createdAt: "", updatedAt: "" });
        await click(button("确认生成 1 条视频"));
        expect(createTask).toHaveBeenCalledTimes(1);
        const submitted = createTask.mock.calls[0][0];
        expect(submitted.operation).toBe("image_to_video");
        expect(submitted.input?.config).toMatchObject({ videoGenerateAudio: "true" });
        expect(submitted.prompt).toContain(voice);
        expect(submitted.input?.referenceImages).toEqual([expect.objectContaining({ id: "side-frame", storageKey: "resource:side-frame", role: "first_frame" })]);
        expect(submitted.input?.referenceVideos).toEqual([]);
        const metadata = submitted.input?.metadata;
        expect(metadata).toMatchObject({
            ecommerceVideoQuote: { billingMode: "per_second", amountMicrocredits: 2000000 },
            ecommerceVideoVersion: { presenter: { frameResourceId: "side-frame", delivery: "demonstrate" }, voice, settings: { generateAudio: true } },
        });
        const version = metadata?.ecommerceVideoVersion;
        if (!isProductVideoVersion(version)) throw new Error("作品应包含可恢复的人物口播脚本");
        const result: GenerationTask = {
            id: "presenter-task",
            projectId,
            type: "canvas_video",
            status: "succeeded",
            prompt: submitted.prompt,
            attempts: 1,
            createdAt: "",
            updatedAt: "",
            previewUrl: "/api/resources/qa/file",
            clientContext: { assetTitle: "收纳包口播", ecommerceVideoVersion: version },
        };
        await click(button("带货视频"));
        await openScript();
        await edit("ec-video-voice", "其它创作草稿");
        listTasks.mockResolvedValue([result]);
        client.setQueryData(["ecommerce-product-videos", scope, projectId], [result]);
        await render({ ...configured, view: "works" });
        await click(button("沿用脚本，换个开场"));
        await click(button("使用作品脚本"));
        await render(configured);
        expect(editCache.current?.presenter).toMatchObject(version.presenter!);
        expect(voiceInput().value).toBe(voice);
        expect(quote).toHaveBeenCalledTimes(4);
        expect(createTask).toHaveBeenCalledTimes(1);
        for (const content of ["voice", "photo"] as const) {
            const dormant = { ...configured, projectId: "unfinished-" + content, sessionId: "session-" + content };
            await render(dormant);
            await click(button("人物口播"));
            if (content === "voice") await edit("ec-video-voice", "先保留这一句草稿。");
            else await click(button(images[0].name));
            await click(button("带货视频"));
            const works = [{ ...result, projectId: dormant.projectId }];
            listTasks.mockResolvedValue(works);
            client.setQueryData(["ecommerce-product-videos", scope, dormant.projectId], works);
            await render({ ...dormant, view: "works" });
            await click(button("沿用脚本，换个开场"));
            await click(button("保留当前草稿"));
            expect(editCache.current?.presenterVoice).toBe(content === "voice" ? "先保留这一句草稿。" : "");
            expect(editCache.current?.presenterPhoto).toEqual(content === "photo" ? images[0] : null);
            expect(editCache.current?.revisionSource).toBeUndefined();
        }
    } finally {
        lookup.mockRestore();
        notifyManager.setScheduler(defaultScheduler);
        setActiveUserScope(previousScope);
    }
});

test("口播分镜按需展开，手写镜头和台词在其它视频玩法中各自保存", async () => {
    await render();
    await click(button("人物口播"));
    const shot = () => host.querySelector<HTMLTextAreaElement>("#ec-video-shot-0")!;
    const voice = () => host.querySelector<HTMLTextAreaElement>("#ec-video-voice")!;
    const script = shot()?.closest("details");
    expect(script?.open).toBe(false);
    await click(script!.querySelector("summary")!);
    expect(Boolean(shot().closest("[hidden], details:not([open])"))).toBe(false);
    await edit("ec-video-shot-0", "人物直视镜头，手指停在收纳包的拉链上。");
    await edit("ec-video-voice", "这是我出门常带的收纳包。");
    const presenterShots = fields();
    expect(presenterShots).toHaveLength(3);
    await click(button("带货视频"));
    await openScript();
    expect(voice().value).toBe("");
    await edit("ec-video-voice", "这是带货版解说。");
    expect(fields()).not.toEqual(presenterShots);
    await click(button("视频复刻"));
    await openScript();
    expect(voice().value).toBe("");
    await edit("ec-video-voice", "这是参考片的旁白。");
    await click(button("人物口播"));
    expect(voice().value).toBe("这是我出门常带的收纳包。");
    expect(fields()).toEqual(presenterShots);
    expect(editCache.current?.voice).toBe("这是带货版解说。");
    expect(editCache.current?.referenceScript?.voice).toBe("这是参考片的旁白。");
    expect(quote).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
});

test("旧人物口播草稿恢复所选同框图、手写台词和合成入口", async () => {
    const images = [
        { resourceId: "product", name: "商品原图" },
        { resourceId: "portrait", name: "手持商品照" },
    ];
    const legacy: ProductVideoDraft = {
        scope: "studio-user",
        sessionId: "studio-session",
        chosenModel: "",
        chosenImage: "portrait",
        facts: "",
        purpose: "showcase",
        picking: false,
        story: null,
        voice: "这就是我手上这个小包。",
        mode: "presenter",
        step: "script",
    };
    editCache.current = { ...legacy };
    await render({ images });
    expect(button("使用已有同框图").getAttribute("aria-checked")).toBe("true");
    expect(editCache.current?.presenterPhoto).toEqual(images[1]);
    expect(host.querySelector<HTMLTextAreaElement>("#ec-video-voice")?.value).toBe(legacy.voice);
    expect(editCache.current?.presenter?.frameResourceId).toBeUndefined();
    expect(button("查看报价").disabled).toBe(true);
    expect(host.querySelector<HTMLTextAreaElement>("#ec-video-shot-0")?.closest("details")?.open).toBe(true);
    const castSession = "旧合成草稿";
    editCache.current = { ...legacy, presenterInput: "cast", sessionId: castSession };
    await render({ images, sessionId: castSession });
    expect(button("选模特合成").getAttribute("aria-checked")).toBe("true");
    expect(host.querySelector(".ec-frame-composer")).not.toBeNull();
    await click(button("使用已有同框图"));
    expect(editCache.current?.presenterPhoto).toBeNull();
    expect(findButton("确认使用这张同框图")).toBeUndefined();
    expect(quote).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
});

test("复刻在同页先选择方式，缺少参考片可以添加素材且不会请求模型", async () => {
    await render();
    await click(button("视频复刻"));
    expect(host.querySelector('nav[aria-label="商品视频制作步骤"]')).toBeNull();
    expect(remixChoice("贴近原片").checked).toBe(true);
    await click(remixChoice("灵活改编"));
    expect(remixChoice("灵活改编").checked).toBe(true);
    expect(editCache.current?.referencePreset).toBe("adapt");
    expect(editCache.current?.referenceScript?.story).toBeNull();
    expect(findButton("使用此拍法")).toBeUndefined();
    expect(button("查看报价").disabled).toBe(true);
    const file = host.querySelector<HTMLInputElement>('input[type="file"][accept*="video"]')!;
    const openFile = spyOn(file, "click");
    await click(button("上传参考视频"));
    expect(openFile).toHaveBeenCalledTimes(1);
    expect(quote).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
});

test("复刻切换方式、项目图和恢复自动分镜会更新报价，保留用户手写直到确认恢复", async () => {
    const images = [
        { resourceId: "front", name: "商品正面" },
        { resourceId: "side", name: "商品侧面" },
    ];
    const profile = defaultModelCapabilityConfig("volcengine-ark-video");
    profile.video!.remixReferences = true;
    const remixChannel = { ...channel, modelCosts: channel.modelCosts?.map((cost) => (cost.capability === "video" ? { ...cost, capabilityConfig: profile } : cost)) };
    const config = { ...defaultConfig, channels: [remixChannel], videoModel: "studio::clip" };
    const referenceVideo = { resourceId: "clip", name: "走位.mp4", durationMs: 8000, aspects: ["rhythm", "camera", "framing"] as const };
    editCache.current = {
        scope: "studio-user",
        sessionId: "studio-session",
        chosenModel: config.videoModel,
        chosenImage: "front",
        facts: "双向拉链",
        purpose: "showcase",
        picking: false,
        story: null,
        voice: "",
        mode: "reference",
        referenceVideo: { ...referenceVideo, aspects: [...referenceVideo.aspects] },
    };
    const clip = (id: string) => ({ ...availableImage(id), kind: "video", mimeType: "video/mp4", durationMs: referenceVideo.durationMs });
    spyOn(resources, "refreshResource").mockImplementation(async (id) => (id === "clip" || id === "another-clip" ? clip(id) : availableImage(id)));
    const probe = spyOn(mediaMetadata, "probeMediaDurationMs").mockResolvedValue(referenceVideo.durationMs);
    const upload = spyOn(resources, "uploadResourceFile").mockResolvedValue(clip("another-clip"));
    const previousScope = getActiveUserScope();
    setActiveUserScope("studio-user");
    notifyManager.setScheduler(queueMicrotask);
    try {
        await render({ config, images });
        expect(button("查看报价").disabled).toBe(false);
        await click(button("查看报价"));
        expect(button("确认生成 1 条视频").disabled).toBe(false);
        await click(button("商品侧面"));
        expect(button("查看报价").disabled).toBe(false);
        expect(findButton("确认生成 1 条视频")).toBeUndefined();
        await openScript();
        const initial = fields();
        expect(initial).toHaveLength(3);
        await click(remixChoice("灵活改编"));
        expect(fields()).not.toEqual(initial);
        const stage = host.querySelector<HTMLElement>('section[aria-label="分镜预演"]')!;
        const shots = [...stage.querySelectorAll<HTMLButtonElement>('[aria-label="镜头时间线"] button')];
        expect(shots).toHaveLength(3);
        await click(button("播放分镜", stage));
        expect(button("暂停预演", stage).getAttribute("aria-pressed")).toBe("true");
        await click(button("暂停预演", stage));
        await click(shots[1]);
        await edit("ec-video-shot-1", "把双向拉链停在镜头中间");
        const manual = fields();
        await click(host.querySelectorAll<HTMLButtonElement>(".ec-shot-notes button")[1]);
        const target = host.querySelector<HTMLSelectElement>(".ec-video-planning select")!;
        expect(target.value).toBe("1");
        await click(button("AI 起草旁白"));
        expect(target.value).toBe("voice");
        await click(remixChoice("贴近原片"));
        expect(fields()).toEqual(manual);
        await click(button("查看报价"));
        expect(button("确认生成 1 条视频").disabled).toBe(false);
        const replacementInput = host.querySelector<HTMLInputElement>('input[type="file"][accept*="video"]')!;
        Object.defineProperty(replacementInput, "files", { configurable: true, value: [new File(["local"], "另一个机位.mp4", { type: "video/mp4" })] });
        await act(async () => {
            replacementInput.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(editCache.current?.referenceVideo).toMatchObject({ resourceId: "another-clip", durationMs: referenceVideo.durationMs });
        expect(findButton("确认生成 1 条视频")).toBeUndefined();
        expect(fields()).toEqual(manual);
        await click(button("恢复自动分镜"));
        expect(button("查看报价").disabled).toBe(true);
        await click(button("保留当前分镜"));
        expect(fields()).toEqual(manual);
        await click(button("恢复自动分镜"));
        await click(button("确认恢复自动分镜"));
        expect(fields()[1]).not.toBe(manual[1]);
        expect(fields().join(" ")).toContain("参考片");
        expect(editCache.current?.referenceScript?.story).toBeNull();
        await click(button("查看报价"));
        expect(button("确认生成 1 条视频").disabled).toBe(false);
        await click(button("移除参考视频"));
        expect(editCache.current?.referenceVideo).toBeUndefined();
        expect(button("查看报价").disabled).toBe(true);
        expect(findButton("确认生成 1 条视频")).toBeUndefined();
        expect(quote).toHaveBeenCalledTimes(3);
        expect(createTask).not.toHaveBeenCalled();
    } finally {
        notifyManager.setScheduler(defaultScheduler);
        setActiveUserScope(previousScope);
        probe.mockRestore();
        upload.mockRestore();
    }
});

test("同页默认即可报价，选择另一拍法后重新报价并确认才创建一条视频", async () => {
    await render({ images: [{ resourceId: "front", name: "商品正面" }] });
    expect(host.querySelector('nav[aria-label="商品视频制作步骤"]')).toBeNull();
    expect(button("查看报价").disabled).toBe(false);
    const customScript = host.querySelector<HTMLDetailsElement>("details.ec-sales-script")!;
    expect(customScript.open).toBe(false);
    expect(editCache.current?.story).toBeNull();
    await click(button("查看报价"));
    expect(quote).toHaveBeenCalledTimes(1);
    expect(quote.mock.calls[0][0].intent?.options).toMatchObject({ videoSeconds: 15, videoGenerateAudio: true });
    expect(button("确认生成 1 条视频").disabled).toBe(false);
    await click(salesApproach("日常种草"));
    expect(findButton("确认生成 1 条视频")).toBeUndefined();
    expect(quote).toHaveBeenCalledTimes(1);
    expect(createTask).not.toHaveBeenCalled();
    await edit("ec-video-facts", "内袋有双向拉链");
    await click(button("查看报价"));
    createTask.mockResolvedValueOnce({ id: "sales-one-page", type: "canvas_video", status: "queued", prompt: "", attempts: 0, createdAt: "", updatedAt: "" });
    await click(button("确认生成 1 条视频"));
    expect(createTask).toHaveBeenCalledTimes(1);
    const submitted = createTask.mock.calls[0][0];
    expect(submitted.prompt).toContain("画外音");
    expect(submitted.input?.config).toMatchObject({ videoGenerateAudio: "true" });
    const version = submitted.input?.metadata?.ecommerceVideoVersion;
    expect(version).toMatchObject({ approachId: "daily-pick", purpose: "lifestyle", facts: "内袋有双向拉链", settings: { generateAudio: true } });
    if (!isProductVideoVersion(version)) throw new Error("带货视频缺少有效版本");
    expect(version.shots[1]).toContain("内袋有双向拉链");
    expect(customScript.open).toBe(false);
});

test("默认达人口播只需商品图，切换语言后重新报价，空台词随成片生成人声", async () => {
    const speechChannel = { ...soundChannel, id: "speech", name: "有声视频" };
    await render({ images: [{ resourceId: "front", name: "旅行收纳包" }], config: { ...defaultConfig, channels: [channel, speechChannel], videoModel: "studio::clip" } });
    await click(button("查看报价"));
    const language = host.querySelector<HTMLSelectElement>('select[name="outputLanguage"]')!;
    await act(async () => {
        language.value = "en";
        language.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(findButton("确认生成 1 条视频")).toBeUndefined();
    await click(button("查看报价"));
    expect(quote.mock.calls.at(-1)![0]).toMatchObject({ channelId: "speech", intent: { inputs: { image: 1, audio: 0 }, options: { videoGenerateAudio: true } } });
    expect(createTask).not.toHaveBeenCalled();
    createTask.mockResolvedValueOnce({ id: "host-sale", type: "canvas_video", status: "queued", prompt: "", attempts: 0, createdAt: "", updatedAt: "" });
    await click(button("确认生成 1 条视频"));
    expect(createTask).toHaveBeenCalledTimes(1);
    const submitted = createTask.mock.calls[0][0];
    expect(submitted.prompt).toContain("成片语言：英文");
    expect(submitted.prompt).toMatch(/出镜.{0,15}口播/);
    expect(submitted.prompt).toContain("成片语言生成");
    expect(submitted.input?.config).toMatchObject({ videoGenerateAudio: "true" });
    expect(submitted.input?.metadata?.ecommerceVideoVersion).toMatchObject({ approachId: "host-pick", language: "en", voice: "", settings: { generateAudio: true } });
});

test("仅有无声模型时能改用无口播演示，手写台词可找回且不随无声任务发送", async () => {
    const images = [{ resourceId: "front", name: "旅行收纳包" }];
    await render({ images, config: { ...defaultConfig, channels: [channel], videoModel: "studio::clip" } });
    expect(button("查看报价").disabled).toBe(true);
    await openScript();
    const line = "钥匙和卡片可以这样分开放。";
    await edit("ec-video-voice", line);
    await click(salesApproach("使用演示"));
    expect(button("查看报价").disabled).toBe(false);
    await click(button("查看报价"));
    expect(quote.mock.calls.at(-1)![0].intent?.options?.videoGenerateAudio).not.toBe(true);
    await click(salesApproach("达人口播推荐"));
    expect(host.querySelector<HTMLTextAreaElement>("#ec-video-voice")?.value).toBe(line);
    expect(button("查看报价").disabled).toBe(true);
    await click(salesApproach("使用演示"));
    await click(button("查看报价"));
    expect(createTask).not.toHaveBeenCalled();
    createTask.mockResolvedValueOnce({ id: "silent-sale", type: "canvas_video", status: "queued", prompt: "", attempts: 0, createdAt: "", updatedAt: "" });
    await click(button("确认生成 1 条视频"));
    expect(createTask).toHaveBeenCalledTimes(1);
    const submitted = createTask.mock.calls[0][0];
    expect(submitted.prompt).toContain("无口播");
    expect(submitted.prompt).not.toContain(line);
    expect(submitted.input?.config?.videoGenerateAudio).not.toBe("true");
    expect(submitted.input?.metadata?.ecommerceVideoVersion).toMatchObject({ approachId: "how-to", voice: "", settings: { generateAudio: false } });
    expect(editCache.current?.voice).toBe(line);
});

test("视觉故事板分别保存三镜配图、景别与运镜，非本用户图片无法使用", async () => {
    const previousScope = getActiveUserScope();
    const { user, hydrated } = useUserStore.getState();
    const scope = "studio-user";
    setActiveUserScope(scope);
    useUserStore.setState({ user: { id: scope, username: "fixture", displayName: "fixture", role: "user", status: "active" }, hydrated: true });
    const images = [
        { resourceId: "product", name: "商品正面" },
        { resourceId: "zipper", name: "拉链近照" },
        { resourceId: "foreign", name: "无权使用的图片" },
    ];
    const lookup = spyOn(resources, "refreshResource").mockImplementation(async (id) => ({
        id,
        userId: id === "foreign" ? "other" : scope,
        kind: "image",
        status: "ready",
        provider: "local",
        endpoint: "",
        bucket: "",
        objectKey: id,
        publicUrl: "",
        mimeType: "image/webp",
        size: 32,
        createdAt: "",
        updatedAt: "",
    }));
    const strip = () => [...host.querySelectorAll<HTMLButtonElement>(".ec-board-strip button")];
    async function select(index: number, value: string) {
        const field = host.querySelectorAll<HTMLSelectElement>(".ec-board-controls select")[index];
        await act(async () => {
            field.value = value;
            field.dispatchEvent(new Event("change", { bubbles: true }));
        });
    }
    try {
        await render({ images });
        await openScript();
        const baseline = fields();
        expect(strip()).toHaveLength(3);
        await click(strip()[1]);
        await select(0, "detail");
        await select(1, "push");
        await select(2, "zipper");
        expect(strip()[1].querySelector("img")?.alt).toBe("拉链近照");
        expect(strip()[1].textContent).toContain("特写 · 向前推近");
        await select(2, "foreign");
        expect(host.querySelector(".ec-board-controls [role=alert]")).not.toBeNull();
        expect(editCache.current?.story?.boards?.[1].frame?.resourceId).toBe("zipper");
        await click(salesApproach("边用边讲"));
        await click(button("保留当前分镜"));
        await edit("ec-video-shot-0", "拉开包口");
        await click(strip()[0]);
        await select(2, "product");
        await click(strip()[2]);
        expect(host.querySelector<HTMLSelectElement>('.ec-board-controls [aria-label="收尾分镜参考图"]')?.value).toBe("");
        await act(async () => root.render(null));
        editCache = { current: null };
        await render({ images });
        await openScript();
        expect(fields()).toEqual(["拉开包口", ...baseline.slice(1)]);
        expect(
            strip()
                .slice(0, 2)
                .map((node) => node.querySelector("img")?.alt),
        ).toEqual(["商品正面", "拉链近照"]);
        await click(strip()[1]);
        await click(button("清除细节分镜参考图"));
        expect(editCache.current?.story?.boards).toEqual([{ frame: images[0] }, { framing: "detail", camera: "push" }, {}]);
        expect(editCache.current?.chosenImage).not.toBe("zipper");
        expect(quote).not.toHaveBeenCalled();
        expect(createTask).not.toHaveBeenCalled();
    } finally {
        await act(async () => root.render(null));
        lookup.mockRestore();
        useUserStore.setState({ user, hydrated });
        setActiveUserScope(previousScope);
    }
});

test("选拍法可改稿，切换需要明确替换；作品和会话切换保持镜头、口播与卖点", async () => {
    const images = [{ resourceId: "product-image", name: "收纳包正面" }];
    await render({ images });
    await openScript();
    const original = fields();
    expect(original).toHaveLength(3);
    await edit("ec-video-shot-0", "镜头停在拉链处");
    await edit("ec-video-facts", "主图可见双层拉链");
    await edit("ec-video-voice", "带你看看收纳包的细节");
    await click(salesApproach("开箱分享"));
    const manuallyEdited = ["镜头停在拉链处", ...original.slice(1)];
    expect(editCache.current?.story?.shots).toEqual(manuallyEdited);
    expect(button("应用新拍法")).toBeDefined();
    await click(button("保留当前分镜"));
    expect(fields()).toEqual(manuallyEdited);
    await click(salesApproach("痛点解决"));
    await click(button("应用新拍法"));
    await openScript();
    const replaced = fields();
    expect(replaced).toHaveLength(3);
    expect(replaced[0]).not.toBe("镜头停在拉链处");
    expect(quote).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
    await render({ images, view: "works" });
    expect(host.querySelector('[aria-label="本项目近期视频"]')).not.toBeNull();
    await act(async () => root.render(null));
    await render({ images });
    await openScript();
    expect(fields()).toEqual(replaced);
    expect(host.querySelector<HTMLTextAreaElement>("#ec-video-facts")!.value).toBe("主图可见双层拉链");
    expect(host.querySelector<HTMLTextAreaElement>("#ec-video-voice")!.value).toBe("带你看看收纳包的细节");
    expect(quote).not.toHaveBeenCalled();
    await click(button("查看报价"));
    expect(quote).toHaveBeenCalledTimes(1);
    expect(button("确认生成 1 条视频").disabled).toBe(false);
    await edit("ec-video-shot-0", "改成从商品正侧面开始");
    expect(button("查看报价").disabled).toBe(false);
    expect(quote).toHaveBeenCalledTimes(1);
    expect(createTask).not.toHaveBeenCalled();
    createTask.mockResolvedValueOnce({ id: "local-video-task", type: "canvas_video", status: "queued", prompt: "", attempts: 0, createdAt: "", updatedAt: "" });
    await click(button("查看报价"));
    await click(button("确认生成 1 条视频"));
    expect(createTask).toHaveBeenCalledTimes(1);
    const submitted = createTask.mock.calls[0][0];
    expect(submitted.input?.referenceImages).toEqual([expect.objectContaining({ id: "product-image", role: "reference", storageKey: "resource:product-image" })]);
    expect(submitted.input?.metadata).not.toHaveProperty("videoStartFrameNodeId");
    expect(submitted.prompt).toContain("改成从商品正侧面开始");
    expect(submitted.prompt).toContain("带你看看收纳包的细节");
    expect(submitted.input?.metadata).toMatchObject({
        stage: "product-video",
        ecommerceProjectId: "project",
        clientOperationId: expect.any(String),
        ecommerceVideoVersion: {
            schema: 1,
            frame: images[0],
            productName: "旅行收纳包",
            model: "studio::clip",
            facts: "主图可见双层拉链",
            purpose: "demo",
            shots: ["改成从商品正侧面开始", ...replaced.slice(1)],
            voice: "带你看看收纳包的细节",
            settings: { seconds: 15 },
        },
    });
});

test("清空组件内存后按未建项目会话或已创建项目恢复分镜、口播和首帧，隔离其他项目与账号", async () => {
    const images = [
        { resourceId: "front", name: "正面" },
        { resourceId: "side", name: "侧面" },
    ];
    await render({ images });
    await click(button("侧面"));
    await click(salesApproach("痛点解决"));
    await openScript();
    await edit("ec-video-shot-0", "取出包中的手机");
    await edit("ec-video-facts", "双层收纳");
    await edit("ec-video-voice", "分类更方便");
    const saved = structuredClone(editCache.current);
    await act(async () => root.render(null));
    editCache = { current: null };
    await render({ images });
    expect(editCache.current).toEqual(saved);
    await openScript();
    expect(fields()[0]).toBe("取出包中的手机");
    await render({ images, sessionId: "another-new-session" });
    expect(editCache.current?.story).toBeNull();
    await act(async () => root.render(null));
    await promoteProductVideoDraft("studio-user", "studio-session", "bag-project");
    expect(await readProductVideoDraft("studio-user", "studio-session")).toBeNull();
    editCache = { current: null };
    await render({ images, projectId: "bag-project", sessionId: "history-entry" });
    expect(editCache.current).toEqual({ ...saved, sessionId: "history-entry", projectId: "bag-project" });
    await render({ images, projectId: "bag-project", sessionId: "history-entry", scope: "other-user" });
    expect(editCache.current?.story).toBeNull();
    expect(editCache.current?.facts).toBe("");
    await render({ images, projectId: "other-project", sessionId: "other-history-entry" });
    expect(editCache.current?.story).toBeNull();
    expect(quote).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
});

test("未建项目首次保存时保留正在编辑的控件，后续镜头修改只写入正式项目", async () => {
    await render();
    await openScript();
    await edit("ec-video-shot-0", "在镜头前打开包");
    const field = host.querySelector("#ec-video-shot-0");
    await render({ projectId: "new-project" });
    expect(host.querySelector("#ec-video-shot-0")).toBe(field);
    await edit("ec-video-shot-0", "在镜头前展示拉链");
    expect(await readProductVideoDraft("studio-user", "studio-session")).toBeNull();
    const projectDraft = await readProductVideoDraft("studio-user", "another-session", "new-project");
    expect(projectDraft?.story?.shots[0]).toBe("在镜头前展示拉链");
    expect(quote).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
});

test("旧参考视频草稿恢复原模式和素材", async () => {
    const { localForageStorageForScope } = await import("@/lib/localforage-storage");
    const scope = "studio-user";
    const sessionId = "legacy-reference";
    const referenceVideo = { resourceId: "clip", name: "参考片", durationMs: 6250 };
    const shots = ["跟随原片里的手部动作", "推近到商品提手", "以参考片的节奏收尾"];
    const legacy = {
        scope,
        sessionId,
        chosenImage: "photo",
        chosenModel: "studio::clip",
        facts: "",
        purpose: "showcase",
        story: { purpose: "showcase", approachId: "detail", edited: true, shots },
        picking: false,
        voice: "这句只给旧复刻用。",
        remixEnabled: true,
        referenceVideo,
    };
    await localForageStorageForScope(scope).setItem("ecommerce-video-draft-v1:session:" + sessionId, JSON.stringify(legacy));
    expect(await readProductVideoDraft(scope, sessionId)).toMatchObject({ mode: "reference", referenceVideo });
    const lookup = spyOn(resources, "refreshResource").mockRejectedValue(new Error("仅验证本地脚本恢复"));
    try {
        await render({ sessionId, images: [{ resourceId: "photo", name: "参考商品" }] });
        expect(fields()).toEqual(shots);
        expect(host.querySelector<HTMLTextAreaElement>("#ec-video-voice")?.value).toBe(legacy.voice);
        await click(button("带货视频"));
        expect(salesApproach("达人口播推荐").checked).toBe(true);
        await openScript();
        expect(fields()).not.toEqual(shots);
        expect(host.querySelector<HTMLTextAreaElement>("#ec-video-voice")?.value).toBe("");
    } finally {
        lookup.mockRestore();
    }
});

test("旧商品展示草稿保留当时的三镜和无声规格", async () => {
    const { localForageStorageForScope } = await import("@/lib/localforage-storage");
    const scope = "studio-user";
    const sessionId = "legacy-sales";
    const shots = ["灯光沿杯子边缘移动", "拍近杯口", "回到杯子正面"];
    const legacy = {
        scope,
        sessionId,
        mode: "image",
        chosenImage: "cup",
        chosenModel: "studio::clip",
        facts: "",
        voice: "",
        purpose: "showcase",
        candidateId: "reveal",
        picking: false,
        story: { purpose: "showcase", approachId: "reveal", shots, edited: false, followBrief: true },
    };
    await localForageStorageForScope(scope).setItem("ecommerce-video-draft-v1:session:" + sessionId, JSON.stringify(legacy));
    await render({ scope, sessionId, images: [{ resourceId: "cup", name: "原商品图" }], config: { ...defaultConfig, channels: [channel], videoModel: "studio::clip" } });
    await openScript();
    expect(fields()).toEqual(shots);
    expect(salesApproach("达人口播推荐").checked).toBe(false);
    await click(button("查看报价"));
    expect(quote).toHaveBeenCalledTimes(1);
    expect(quote.mock.calls[0][0].intent?.options?.videoGenerateAudio).not.toBe(true);
    expect(createTask).not.toHaveBeenCalled();
});

test("读取本机草稿失败时保留已有内容，成功重试后可继续编辑，保存失败也能显式重试", async () => {
    await render();
    await openScript();
    await edit("ec-video-shot-0", "保留的第一镜");
    await act(async () => root.render(null));
    editCache = { current: null };
    readCache.mockRejectedValueOnce(new Error("IndexedDB not ready"));
    await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("视频草稿读取失败");
    expect(fields()).toEqual([]);
    await click(button("重新读取"));
    await openScript();
    expect(fields()[0]).toBe("保留的第一镜");
    writeCache.mockRejectedValueOnce(new Error("quota exceeded"));
    await edit("ec-video-shot-0", "更新的第一镜");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("视频草稿保存失败");
    expect((await readProductVideoDraft("studio-user", "studio-session"))?.story?.shots[0]).toBe("保留的第一镜");
    await click(button("重试保存"));
    expect(findButton("重试保存")).toBeUndefined();
    expect((await readProductVideoDraft("studio-user", "studio-session"))?.story?.shots[0]).toBe("更新的第一镜");
    expect(quote).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
});

test("简报建议逐项选用，一键只补空白，AI 先报价并隔离回执", async () => {
    await render({ planningModel: "studio::planner" });
    const panel = host.querySelector<HTMLDetailsElement>("details.ec-shoot-brief:not(.ec-video-shoot-review)")!;
    await click(panel.querySelector("summary")!);
    const fields = () => Object.fromEntries([...panel.querySelectorAll<HTMLInputElement>("input")].map((input) => [input.name, input.value]));
    const audience = panel.querySelector<HTMLInputElement>('input[name="audience"]')!;
    const description = panel.querySelector<HTMLInputElement>('input[name="scene"]')!;
    async function write(input: HTMLInputElement, value: string) {
        await act(async () => {
            Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(input, value);
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
    }
    await write(audience, "保留我填写的人群");
    await click(button("一键填入空白项", panel));
    expect(fields().audience).toBe("保留我填写的人群");
    expect(fields().scene).toContain("包");
    expect(quote).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
    const price = { logicalModelId: "planner", quantity: 1, billingMode: "fixed_request" as const, amountMicrocredits: 1000000, estimated: false };
    quote.mockResolvedValue({ quote: price });
    await click(button("AI 起草简报 · 查看报价", panel));
    expect(createTask).not.toHaveBeenCalled();
    const ai = { audience: "先看容量的人", scene: "把包放上玄关的小凳", closing: "收起拉链，检查是否适合每天携带" };
    createTask.mockImplementationOnce(async (request) => ({
        id: "test-brief",
        projectId: "project",
        type: "canvas_text",
        status: "succeeded",
        prompt: request.prompt,
        attempts: 1,
        createdAt: "",
        updatedAt: "",
        resultJson: JSON.stringify({ text: JSON.stringify(ai) }),
    }));
    await click(button("确认起草 · 1 积分", panel));
    expect(createTask.mock.calls[0][0].input?.metadata).toMatchObject({ assetTitle: "商品视频 · 拍摄简报", stage: "product-video-storyboard" });
    expect(sessionStorage.getItem(JSON.stringify(["ecommerce-video-shoot-brief", "studio-user", "project"]))).toContain("test-brief");
    expect(sessionStorage.getItem(JSON.stringify(["ecommerce-video-planning", "studio-user", "project"]))).toBeNull();
    expect(fields().scene).not.toBe(ai.scene);
    await write(description, "");
    await click(button("用 AI 建议填入空白项", panel));
    expect(fields()).toMatchObject({ audience: "保留我填写的人群", scene: ai.scene });
    await click(button("替换「看完希望观众做什么」为 AI 建议：" + ai.closing, panel));
    expect(fields().closing).toBe(ai.closing);
    expect(createTask).toHaveBeenCalledTimes(1);
});

test("拍摄简报丢失回执后刷新可认领同一项目的原任务，期间不会再次提交", async () => {
    const opts = { planningModel: "studio::planner", projectId: "project" };
    await render(opts);
    const find = () => host.querySelector<HTMLDetailsElement>("details.ec-shoot-brief:not(.ec-video-shoot-review)")!;
    const panel = find();
    await click(panel.querySelector("summary")!);
    const price = { logicalModelId: "planner", quantity: 1, billingMode: "fixed_request" as const, amountMicrocredits: 0, estimated: false };
    quote.mockResolvedValue({ quote: price });
    createTask.mockRejectedValueOnce(new Error("acknowledgement lost"));
    await click(button("AI 起草简报 · 查看报价", panel));
    await click(button("确认起草 · 0 积分", panel));
    expect(panel.textContent).toContain("尚未确认提交结果");
    const operation = JSON.parse(sessionStorage.getItem(JSON.stringify(["ecommerce-video-shoot-brief", "studio-user", "project"]))!).operationId;
    await act(async () => root.render(null));
    await render(opts);
    expect(find().open).toBe(true);
    expect(findButton("AI 起草简报 · 查看报价", find())).toBeUndefined();
    const saved = {
        id: "original-brief",
        type: "canvas_text" as const,
        status: "succeeded" as const,
        projectId: "project",
        clientOperationId: operation,
        prompt: createTask.mock.calls[0][0].prompt,
        attempts: 1,
        createdAt: "",
        updatedAt: "",
        resultJson: JSON.stringify({ text: JSON.stringify({ audience: "挑包的人", scene: "客厅桌面", closing: "确认包的尺寸" }) }),
    };
    listTasks.mockResolvedValueOnce([{ ...saved, id: "unrelated", projectId: "other" }]);
    await click(button("核对简报任务", find()));
    expect(find().textContent).toContain("尚未找到对应回执");
    listTasks.mockResolvedValueOnce([saved]);
    const lookup = spyOn(tasks, "queryGenerationTask").mockResolvedValueOnce(saved);
    try {
        await act(async () => {
            button("核对简报任务", find()).click();
        });
        if (!findButton("用 AI 建议填入空白项", find())) {
            await new Promise<void>((resolve, reject) => {
                const panel = find();
                const timer = setTimeout(() => {
                    observer.disconnect();
                    reject(new Error("简报未恢复"));
                }, 2000);
                const observer = new dom.MutationObserver(() => {
                    if (findButton("用 AI 建议填入空白项", panel)) {
                        clearTimeout(timer);
                        observer.disconnect();
                        resolve();
                    }
                });
                observer.observe(panel, { childList: true, characterData: true, subtree: true });
            });
        }
        expect(find().textContent).toContain("AI 建议已就绪");
        await click(button("用 AI 建议填入空白项", find()));
        expect(find().querySelector<HTMLInputElement>('input[name="scene"]')?.value).toBe("客厅桌面");
        expect(createTask).toHaveBeenCalledTimes(1);
    } finally {
        lookup.mockRestore();
    }
});

test("AI 单镜建议先独立报价、价格变化重新确认、采纳和撤销均保留其它镜头", async () => {
    await render({ planningModel: "studio::planner" });
    await openScript();
    const before = fields();
    const panel = host.querySelector<HTMLDetailsElement>(".ec-video-planning")!;
    await click(panel.querySelector("summary")!);
    const range = panel.querySelector("select")!;
    await act(async () => {
        range.value = "1";
        range.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(quote).not.toHaveBeenCalled();
    const price = { logicalModelId: "planner", quantity: 1, billingMode: "fixed_request" as const, amountMicrocredits: 1000000, estimated: false };
    quote.mockResolvedValueOnce({ quote: price }).mockResolvedValueOnce({ quote: { ...price, amountMicrocredits: 2000000 } });
    await click(button("查看策划报价", panel));
    await click(button("确认策划 · 1 积分", panel));
    expect(createTask).not.toHaveBeenCalled();
    quote.mockResolvedValueOnce({ quote: { ...price, amountMicrocredits: 2000000 } });
    createTask.mockImplementationOnce(async (request) => ({
        id: "plan-middle",
        projectId: "project",
        type: "canvas_text",
        status: "succeeded",
        prompt: request.prompt,
        attempts: 1,
        createdAt: "",
        updatedAt: "",
        resultJson: JSON.stringify({ text: JSON.stringify({ shots: ["侧面微距展示拉链。"] }) }),
    }));
    await click(button("确认策划 · 2 积分", panel));
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask.mock.calls[0][0].input?.metadata).toMatchObject({ stage: "product-video-storyboard" });
    expect(fields()).toEqual(before);
    await click(button("采纳建议", panel));
    expect(fields()).toEqual([before[0], "侧面微距展示拉链。", before[2]]);
    await edit("ec-video-shot-0", "保留后来的手写开场");
    await click(button("撤销采纳", panel));
    expect(fields()).toEqual(["保留后来的手写开场", before[1], before[2]]);
    expect(createTask).toHaveBeenCalledTimes(1);
});

test("项目卖点按需加入本轮，勾选保存失败可重试且不会生成", async () => {
    const saveFacts = mock(async (_items: string[], _original: string[]) => {});
    saveFacts.mockRejectedValueOnce(new Error("连接中断"));
    await render({ draft: { ...emptyEcommerceDraft(), productName: "收纳包", productFacts: ["双层内袋"] }, onSaveFacts: saveFacts });
    await edit("ec-video-facts", "金属拉链\n手提");
    const details = host.querySelector<HTMLDetailsElement>(".ec-product-facts")!;
    await click(details.querySelector("summary")!);
    await click(button("加入本轮：双层内袋", details));
    const current = () => host.querySelector<HTMLTextAreaElement>("#ec-video-facts")!.value;
    expect(current()).toBe("金属拉链\n手提\n双层内袋");
    await click(button("从本轮移除：双层内袋", details));
    expect(current()).toBe("金属拉链\n手提");
    await click(button("编辑商品资料", details));
    const checks = details.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]');
    expect(checks).toHaveLength(2);
    await click(checks[0]);
    await click(button("保存到项目", details));
    expect(details.querySelector('[role="alert"]')?.textContent).toBe("连接中断");
    await click(button("保存到项目", details));
    expect(saveFacts).toHaveBeenLastCalledWith(["双层内袋", "金属拉链"], ["双层内袋"]);
    expect(details.querySelector('[role="status"]')?.textContent).toContain("已保存");
    expect(current()).toBe("金属拉链\n手提");
    expect(quote).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
});

test("口播台词只在确认文本报价后起草，采纳与撤销保留手写原稿和镜头", async () => {
    await render({ planningModel: "studio::planner" });
    await click(button("人物口播"));
    await edit("ec-video-voice", "我原来写的开场。");
    await click(button("AI 起草台词"));
    const panel = host.querySelector<HTMLDetailsElement>(".ec-video-planning")!;
    expect(panel.open).toBe(true);
    expect(panel.querySelector("select")?.value).toBe("voice");
    expect(Boolean(button("查看台词报价", panel).closest("[hidden], details:not([open])"))).toBe(false);
    expect(button("查看台词报价", panel).disabled).toBe(true);
    await edit("ec-video-facts", "双层内袋");
    const before = fields();
    const price = { logicalModelId: "planner", quantity: 1, billingMode: "fixed_request" as const, amountMicrocredits: 1000000, estimated: false };
    quote.mockResolvedValueOnce({ quote: price }).mockResolvedValueOnce({ quote: price });
    await click(button("查看台词报价", panel));
    expect(createTask).not.toHaveBeenCalled();
    createTask.mockImplementationOnce(async (req) => ({
        id: "voice-copy",
        projectId: "project",
        type: "canvas_text",
        status: "succeeded",
        prompt: req.prompt,
        attempts: 1,
        createdAt: "",
        updatedAt: "",
        resultJson: JSON.stringify({ text: JSON.stringify({ voice: "打开看看，双层内袋可以分开放。" }) }),
    }));
    await click(button("确认起草台词 · 1 积分", panel));
    expect(createTask.mock.calls[0][0].input?.metadata).toMatchObject({ stage: "product-video-storyboard" });
    const voice = () => host.querySelector<HTMLTextAreaElement>("#ec-video-voice")!.value;
    expect(voice()).toBe("我原来写的开场。");
    await click(button("采用这版台词", panel));
    expect(voice()).toBe("打开看看，双层内袋可以分开放。");
    expect(fields()).toEqual(before);
    await click(button("撤销采用台词", panel));
    expect(voice()).toBe("我原来写的开场。");
    expect(createTask).toHaveBeenCalledTimes(1);
});

test("整条分镜建议过期、回复缺镜头和回执不明时均保留原稿", async () => {
    await render({ planningModel: "studio::planner" });
    await openScript();
    const panel = host.querySelector<HTMLDetailsElement>(".ec-video-planning")!;
    await click(panel.querySelector("summary")!);
    const original = fields();
    const price = { logicalModelId: "planner", quantity: 1, billingMode: "fixed_request" as const, amountMicrocredits: 0, estimated: false };
    async function requestProposal() {
        quote.mockResolvedValueOnce({ quote: price }).mockResolvedValueOnce({ quote: price });
        await click(button("查看策划报价", panel));
        await click(button("确认策划 · 0 积分", panel));
    }
    function respond(id: string, shots: string[]) {
        createTask.mockImplementationOnce(async (request) => ({
            id,
            projectId: "project",
            type: "canvas_text",
            status: "succeeded",
            prompt: request.prompt,
            attempts: 1,
            createdAt: "",
            updatedAt: "",
            resultJson: JSON.stringify({ text: JSON.stringify({ shots }) }),
        }));
    }
    respond("full-plan", ["开场近景", "转向侧面", "远景收尾"]);
    await requestProposal();
    expect(button("采纳建议", panel)).toBeDefined();
    await edit("ec-video-shot-0", "手动保留的首镜");
    expect(findButton("采纳建议", panel)).toBeUndefined();
    expect(panel.textContent).toContain("放弃旧建议");
    await click(button("放弃建议", panel));
    respond("broken-plan", ["只有一镜"]);
    await requestProposal();
    expect(panel.textContent).toContain("没有收到完整的分镜建议");
    expect(findButton("采纳建议", panel)).toBeUndefined();
    await click(button("放弃建议", panel));
    createTask.mockRejectedValueOnce(new Error("response lost"));
    await requestProposal();
    expect(panel.textContent).toContain("尚未确认提交结果");
    expect(findButton("查看策划报价", panel)).toBeUndefined();
    expect(createTask).toHaveBeenCalledTimes(3);
    expect(fields()).toEqual(["手动保留的首镜", ...original.slice(1)]);
});

test("从成片找回当时脚本，另起一版需要明确替换草稿并重新确认生成", async () => {
    const images = [{ resourceId: "front-bag", name: "商品正面" }];
    const version = {
        schema: 1 as const,
        frame: images[0],
        model: "studio::clip",
        facts: "双面拉链",
        purpose: "showcase" as const,
        approachId: "orbit",
        shots: ["逆光拍商品轮廓", "展示两面的拉链", "回到全景"],
        boards: [{}, { framing: "detail", camera: "push", frame: { resourceId: "editorial-reference", name: "拉链机位参考" } }, {}] satisfies import("@/services/api/task-center").ProductVideoBoards,
        shootBrief: { scene: "山脚的小木屋", closing: "展示可选择的款式" },
        voice: "从正面打开",
        productName: "旅行收纳包",
        audience: "登山者",
        language: "ja",
        region: "日本",
        settings: { seconds: 15 as const, ratio: "9:16", resolution: "720p", generateAudio: false },
    };
    const source: GenerationTask = {
        id: "original-clip",
        projectId: "bag-project",
        type: "canvas_video",
        status: "succeeded",
        prompt: "original prompt",
        attempts: 1,
        createdAt: "2026-11-16T01:02:03Z",
        updatedAt: "2026-11-16T01:03:03Z",
        previewUrl: "/api/resources/clip-1/file",
        clientContext: { assetTitle: "收纳包初版", ecommerceVideoVersion: version },
    };
    const old: GenerationTask = { ...source, id: "pre-snapshots", clientContext: { assetTitle: "旧版成片" } };
    const failed: GenerationTask = { ...source, id: "failed-clip", status: "failed", previewUrl: "", clientContext: { assetTitle: "失败的成片", ecommerceVideoVersion: { ...version, parentTaskId: "older-original" } } };
    const options = { images, projectId: "bag-project", ensureProject: async () => "bag-project", onViewChange: mock() };
    const items = [source, old, failed];
    listTasks.mockResolvedValue(items);
    await render(options);
    await openScript();
    await edit("ec-video-shot-0", "保留这条未提交的草稿");
    client.setQueryData(["ecommerce-product-videos", "studio-user", "bag-project"], items);
    await render({ ...options, view: "works" });
    function card(title: string) {
        const result = [...host.querySelectorAll("article")].find((node) => node.textContent?.includes(title));
        expect(result, title).toBeDefined();
        return result!;
    }
    expect(new URL(card("旧版成片").querySelector("video")!.src).pathname).toBe(old.previewUrl!);
    expect(findButton("沿用脚本，换个开场", card("旧版成片"))).toBeUndefined();
    expect(button("从原稿继续编辑", card("失败的成片"))).toBeDefined();
    const lookup = spyOn(tasks, "queryGenerationTask");
    try {
        const parent: GenerationTask = { ...source, id: "older-original", clientContext: { ...source.clientContext, assetTitle: "早期来源作品" } };
        lookup.mockResolvedValueOnce({ ...parent, projectId: "unrelated-project" });
        await click(button("查看来源作品", card("失败的成片")));
        expect(host.textContent).not.toContain("早期来源作品");
        lookup.mockResolvedValueOnce(parent);
        await click(button("查看来源作品", card("失败的成片")));
        expect(card("早期来源作品")).toBeDefined();
        expect(lookup.mock.calls.map(([id]) => id)).toEqual([parent.id, parent.id]);
    } finally {
        lookup.mockRestore();
    }
    const original = card("收纳包初版");
    const details = [...original.querySelectorAll("summary")].find((node) => node.textContent?.includes("查看原始脚本"));
    expect(details).toBeDefined();
    await click(details!);
    for (const value of [...version.shots, version.voice, version.frame.name]) expect(original.textContent).toContain(value);
    await click(button("沿用脚本，换个开场", original));
    expect(editCache.current?.story?.shots[0]).toBe("保留这条未提交的草稿");
    await click(button("使用作品脚本"));
    await render(options);
    await openScript();
    expect(fields()).toEqual(version.shots);
    expect(host.querySelector<HTMLTextAreaElement>("#ec-video-voice")?.value).toBe(version.voice);
    expect(host.querySelector<HTMLTextAreaElement>("#ec-video-facts")?.value).toBe(version.facts);
    await edit("ec-video-shot-0", "以登山步道的全景开场");
    expect(quote).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
    expect(version.shots[0]).toBe("逆光拍商品轮廓");
    const childShots = ["以登山步道的全景开场", ...version.shots.slice(1)];
    await act(async () => root.render(null));
    editCache = { current: null };
    await render(options);
    await openScript();
    expect(fields()).toEqual(childShots);
    const market = host.querySelector<HTMLSelectElement>('select[name="marketRegion"]')!;
    const language = host.querySelector<HTMLSelectElement>('select[name="outputLanguage"]')!;
    expect(market.value).toBe("日本");
    expect(language.value).toBe("ja");
    await click(button("查看报价"));
    expect(createTask).not.toHaveBeenCalled();
    await act(async () => {
        market.value = "新加坡";
        market.dispatchEvent(new Event("change", { bubbles: true }));
        language.value = "en";
        language.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(findButton("确认生成 1 条视频")).toBeUndefined();
    expect(createTask).not.toHaveBeenCalled();
    await click(button("查看报价"));
    createTask.mockResolvedValueOnce({ ...source, id: "new-clip", status: "queued" });
    await click(button("确认生成 1 条视频"));
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask.mock.calls[0][0].input?.metadata).toMatchObject({
        ecommerceVideoVersion: { parentTaskId: source.id, shots: childShots, boards: version.boards, shootBrief: version.shootBrief, voice: version.voice, facts: version.facts, frame: version.frame, region: "新加坡", language: "en" },
    });
    const created = createTask.mock.calls[0][0];
    expect(created.input?.referenceImages).toHaveLength(1);
    expect(created.prompt).toContain("特写 · 向前推近");
    expect(created.prompt).toContain(version.shootBrief.scene);
    expect(created.prompt).toContain("投放市场：新加坡");
    expect(created.prompt).toContain("成片语言：英文");
    expect(created.prompt).toContain(version.shootBrief.closing);
    expect(created.prompt).not.toContain("editorial-reference");
    expect(created.prompt).not.toContain("拉链机位参考");
    expect(source.clientContext?.ecommerceVideoVersion?.shots[0]).toBe("逆光拍商品轮廓");
    const replacement = { resourceId: "another-photo", name: "备用图" };
    await render({ ...options, images: [replacement], config: { ...defaultConfig, videoModel: "another-studio::clip", channels: [{ ...channel, id: "another-studio" }] } });
    expect(host.textContent).toContain("原视频模型已不可用");
    expect(editCache.current?.productImages?.[0].resourceId).toBe("front-bag");
    await click(button("备用图"));
    expect(host.textContent).toContain("原视频模型已不可用");
    expect(button("查看报价").disabled).toBe(true);
    expect(createTask).toHaveBeenCalledTimes(1);
});

test("视频提交回执丢失后刷新只核对原操作，同标题的其他任务不会被当作回执", async () => {
    const options = { images: [{ resourceId: "main", name: "商品" }], projectId: "bag-project", ensureProject: async () => "bag-project" };
    await render(options);
    await openScript();
    const original = fields();
    createTask.mockRejectedValueOnce(new Error("response lost after accept"));
    await click(button("查看报价"));
    await click(button("确认生成 1 条视频"));
    expect(createTask).toHaveBeenCalledTimes(1);
    const request = createTask.mock.calls[0][0];
    const operationId = (request.input?.metadata as { clientOperationId?: string })?.clientOperationId;
    expect(operationId).toBeTruthy();
    await act(async () => root.render(null));
    editCache = { current: null };
    const accepted: GenerationTask = {
        id: "server-accepted",
        clientOperationId: operationId,
        projectId: options.projectId,
        type: "canvas_video",
        status: "succeeded",
        prompt: request.prompt,
        attempts: 1,
        createdAt: "2026-11-17T01:00:00Z",
        updatedAt: "2026-11-17T01:00:15Z",
        clientContext: { assetTitle: "同名短片" },
    };
    const unrelated = { ...accepted, id: "another-clip", clientOperationId: "different-operation" };
    listTasks.mockResolvedValue([unrelated]);
    await render({ ...options, view: "works" });
    await click(button("核对提交结果"));
    expect(button("核对提交结果")).toBeDefined();
    listTasks.mockResolvedValue([unrelated, accepted]);
    await click(button("核对提交结果"));
    expect(findButton("核对提交结果")).toBeUndefined();
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(quote).toHaveBeenCalledTimes(2);
    await render(options);
    expect(fields()).toEqual(original);
});
