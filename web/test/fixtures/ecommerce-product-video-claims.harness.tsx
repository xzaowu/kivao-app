import { afterAll, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { GenerationTask } from "@/services/api/task-center";
import type { ClaimReceipt } from "@/pages/ecommerce/product-video-claims-receipt";

const dom = new Window({ url: "http://localhost/ecommerce" });
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
] as const)
    Object.defineProperty(globalThis, key, { configurable: true, value: dom[key] });
Object.assign(globalThis, { window: dom, getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true });

const rows = new Map<string, ClaimReceipt | null>();
let readDenied = false;
let writeDenied = false;
const get = async (key: string) => {
    if (readDenied) throw Error("read denied");
    return rows.get(key);
};
mock.module("idb", () => ({
    openDB: async () => ({
        get: (_: string, key: string) => get(key),
        close: () => {},
        transaction: () => ({
            store: {
                get,
                put: async (value: ClaimReceipt | null, key: string) => {
                    if (writeDenied) throw Error("write denied");
                    rows.set(key, value);
                },
            },
            done: Promise.resolve(),
        }),
    }),
}));
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider, notifyManager } = await import("@tanstack/react-query");
notifyManager.setScheduler((cb) => queueMicrotask(cb));
const { setActiveUserScope } = await import("@/lib/user-scope");
const pricing = await import("@/services/api/logical-models");
const quoteRequest = await import("@/lib/model-pricing");
const selection = await import("@/lib/model-selection");
const tasks = await import("@/services/api/task-center");
const generation = await import("@/services/api/generation-task");
const { defaultConfig } = await import("@/stores/use-config-store");
const { ProductVideoClaims } = await import("@/pages/ecommerce/product-video-claims");
const { readClaimReceipt, replaceClaimReceipt } = await import("@/pages/ecommerce/product-video-claims-receipt");
const scope = ["claims-owner", "product-1", "frame-1"] as const;
const base: GenerationTask = {
    id: "analysis",
    type: "canvas_text",
    status: "succeeded",
    projectId: scope[1],
    createdAt: "",
    updatedAt: "",
    progress: 100,
    attempts: 1,
    prompt: "",
    resultJson: JSON.stringify({ text: JSON.stringify({ visibleDescription: "可见圆形瓶盖" }) }),
};
const quote = spyOn(pricing, "quoteModel").mockResolvedValue({ quote: { logicalModelId: "vision", billingMode: "fixed_request", estimated: false, amountMicrocredits: 10000, quantity: 1 } });
const compatibility = spyOn(selection, "modelCompatibilityError").mockReturnValue("");
const pricingIntent = spyOn(quoteRequest, "systemModelQuoteRequest").mockReturnValue({ logicalModelId: "vision" });
const prepare = spyOn(generation, "prepareBackendGenerationTask").mockImplementation(async (options) => ({
    projectId: options.projectId,
    type: "canvas_text",
    prompt: options.prompt,
    input: { metadata: { clientOperationId: options.clientOperationId } },
}));
const create = spyOn(tasks, "createGenerationTask");
const list = spyOn(tasks, "listGenerationTasks");
const detail = spyOn(tasks, "queryGenerationTask");
afterAll(async () => {
    await dom.happyDOM.abort();
});

async function mount(initialIds?: string[]) {
    setActiveUserScope(scope[0]);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host),
        client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const select = async (ids?: string[]) =>
        act(async () =>
            root.render(
                <QueryClientProvider client={client}>
                    <ProductVideoClaims
                        scope={scope[0]}
                        projectId={scope[1]}
                        frame={{ resourceId: scope[2], name: "商品图" }}
                        images={ids?.map((resourceId) => ({ resourceId, name: resourceId }))}
                        config={defaultConfig}
                        model="vision"
                        unavailable=""
                        disabled={false}
                        facts="用户已经写好的卖点"
                        onAccept={() => {
                            throw Error("禁止自动采纳");
                        }}
                        ensureProject={async () => scope[1]}
                        setSubmitting={() => {}}
                    />
                </QueryClientProvider>,
            ),
        );
    await select(initialIds);
    const button = (prefix: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(prefix));
    return {
        host,
        button,
        select,
        click: async (prefix: string) => {
            const b = button(prefix);
            expect(b, prefix).toBeDefined();
            expect(b!.disabled, prefix).toBe(false);
            await act(async () => b!.click());
        },
        close: async () => {
            await act(async () => root.unmount());
            client.clear();
            host.remove();
        },
    };
}

test("创建响应丢失，刷新后拒绝二次提交；错误项目/操作/类型不认领，恢复只读取，采纳留给用户", async () => {
    rows.clear();
    let stored = base;
    create.mockImplementation(async (req) => {
        const op = (req.input!.metadata as { clientOperationId: string }).clientOperationId;
        expect(await readClaimReceipt(scope)).toEqual({ operationId: op });
        stored = { ...base, clientOperationId: op };
        throw Error("response dropped");
    });
    detail.mockImplementation(async () => stored);
    let ui = await mount();
    try {
        await ui.click("AI 分析卖点");
        await ui.click("确认分析");
        expect(create).toHaveBeenCalledTimes(1);
        expect(ui.button("分析待核对")?.disabled).toBe(true);
    } finally {
        await ui.close();
    }
    ui = await mount();
    try {
        expect(ui.button("分析待核对")?.disabled).toBe(true);
        expect(create).toHaveBeenCalledTimes(1);
        list.mockRejectedValueOnce(Error("forbidden"));
        await ui.click("核对卖点分析任务");
        expect(ui.button("已人工核对")).toBeUndefined();
        list.mockResolvedValueOnce([
            { ...stored, projectId: "other" },
            { ...stored, type: "canvas_image" },
            { ...stored, clientOperationId: "different" },
        ]);
        await ui.click("核对卖点分析任务");
        expect(ui.button("已人工核对")).toBeDefined();
        list.mockResolvedValueOnce([stored]);
        await ui.click("已人工核对");
        expect(ui.button("可见圆形瓶盖")).toBeDefined();
        expect((await readClaimReceipt(scope))?.taskId).toBe(stored.id);
        expect(create).toHaveBeenCalledTimes(1);
    } finally {
        await ui.close();
    }
});

test("未找到须明确人工释放，复查失败不清回执；回执存储失败不发送，旧 taskId 仍能恢复建议", async () => {
    const operationId = "00000000-0000-4000-8000-000000000001";
    rows.clear();
    create.mockClear();
    quote.mockClear();
    await replaceClaimReceipt(scope, null, { operationId });
    list.mockResolvedValue([]);
    let ui = await mount();
    try {
        await ui.click("核对卖点分析任务");
        list.mockRejectedValueOnce(Error("permission denied"));
        await ui.click("已人工核对");
        expect(await readClaimReceipt(scope)).toEqual({ operationId });
        expect(ui.button("已人工核对")).toBeUndefined();
        await ui.click("核对卖点分析任务");
        await ui.click("已人工核对");
        expect(await readClaimReceipt(scope)).toBeNull();
        expect(quote).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
        await ui.click("AI 分析卖点");
        writeDenied = true;
        await ui.click("确认分析");
        expect(create).not.toHaveBeenCalled();
    } finally {
        writeDenied = false;
        await ui.close();
    }
    readDenied = true;
    ui = await mount();
    try {
        expect(ui.button("AI 分析卖点")?.disabled).toBe(true);
        expect(ui.button("重新读取回执")).toBeDefined();
    } finally {
        readDenied = false;
        await ui.close();
    }
    rows.clear();
    sessionStorage.setItem("ecommerce:video-claims:" + scope.join(":"), base.id);
    expect(await readClaimReceipt([scope[0], scope[1], "other"])).toBeNull();
    detail.mockResolvedValue(base);
    ui = await mount();
    try {
        expect(ui.button("可见圆形瓶盖")).toBeDefined();
        expect(create).not.toHaveBeenCalled();
    } finally {
        await ui.close();
        sessionStorage.clear();
    }
});

test("整组商品图参与能力筛选、报价和同一个看图任务；换图、换顺序及旧单图回执互相隔离", async () => {
    rows.clear();
    create.mockClear();
    quote.mockClear();
    prepare.mockClear();
    const ids = [scope[2], "back", "detail"];
    const receiptScope = [scope[0], scope[1], ...ids] as const;
    create.mockImplementation(async (req) => {
        const operation = (req.input!.metadata as { clientOperationId: string }).clientOperationId;
        expect(await readClaimReceipt(receiptScope)).toEqual({ operationId: operation });
        throw Error("未收到回执");
    });
    const ui = await mount(ids);
    try {
        expect(ui.host.textContent).toContain("一起分析这 3 张商品图");
        expect(compatibility.mock.lastCall?.[2]?.input).toMatchObject({ imageCount: 3, referenceImageCount: 3 });
        expect(pricingIntent.mock.lastCall?.[3]?.input).toMatchObject({ imageCount: 3, referenceImageCount: 3 });
        await ui.click("AI 分析卖点");
        await ui.select([ids[0], ids[2]]);
        expect(ui.button("确认分析")).toBeUndefined();
        expect(pricingIntent.mock.lastCall?.[3]?.input?.imageCount).toBe(2);
        await ui.click("AI 分析卖点");
        await ui.select(ids);
        await ui.click("AI 分析卖点");
        await ui.click("确认分析");
        expect(create).toHaveBeenCalledTimes(1);
        const submitted = prepare.mock.calls[0][0];
        expect(submitted.mode).toBe("text");
        expect(submitted.metadata).toMatchObject({ stage: "product-understanding", productVideoClaims: true, ecommerceProjectId: scope[1] });
        expect(submitted.referenceImages?.map((image) => [image.id, image.storageKey])).toEqual(ids.map((id) => [id, "resource:" + id]));
        expect(ui.button("分析待核对")?.disabled).toBe(true);
    } finally {
        await ui.close();
    }
    const reordered = await mount([scope[2], ids[2], ids[1]]);
    try {
        expect(reordered.button("AI 分析卖点")?.disabled).toBe(false);
        expect(await readClaimReceipt(scope)).toBeNull();
        await reordered.select(ids);
        expect(reordered.button("分析待核对")?.disabled).toBe(true);
        expect(create).toHaveBeenCalledTimes(1);
        compatibility.mockImplementation((_config, _model, requirements) => ((requirements?.input?.imageCount || 0) > 1 ? "最多支持 1 张参考图" : ""));
        await reordered.select([ids[1], ids[2]]);
        expect(reordered.button("AI 分析卖点")?.disabled).toBe(true);
        expect(reordered.host.textContent).toContain("最多支持 1 张参考图");
        for (const invalid of [[], [ids[0], ids[0]], [...ids, "fourth"]]) {
            await reordered.select(invalid);
            expect(reordered.button("AI 分析卖点")?.disabled).toBe(true);
        }
        expect(create).toHaveBeenCalledTimes(1);
    } finally {
        compatibility.mockReturnValue("");
        await reordered.close();
    }
});
