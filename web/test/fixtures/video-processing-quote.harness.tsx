import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { ReactNode } from "react";
import type { CanvasNodeData } from "../../src/types/canvas";

const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    HTMLInputElement: dom.HTMLInputElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    localStorage: dom.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConfigProvider } = await import("antd");
const { CanvasNodeType } = await import("../../src/types/canvas");
const { createModelChannel, defaultConfig } = await import("../../src/stores/use-config-store");
const { useUserStore } = await import("../../src/stores/use-user-store");
const { defaultModelCapabilityConfig, VOLCENGINE_MEDIAKIT_VIDEO_DEPTH_PROTOCOL, VOLCENGINE_MEDIAKIT_ENHANCE_VIDEO_PROTOCOL } = await import("../../src/lib/model-capabilities");
const quotes = await import("../../src/services/api/logical-models");
const { CanvasVideoEnhanceDialog } = await import("../../src/components/canvas/canvas-video-enhance-dialog");
const { CanvasVideoDepthDialog } = await import("../../src/components/canvas/canvas-video-depth-dialog");

const config = {
    ...defaultConfig,
    channels: [
        createModelChannel({
            id: "processing",
            scope: "system",
            models: ["enhance", "depth", "depth-two"],
            modelCosts: ["enhance", "depth", "depth-two"].map((model) => {
                const protocol = model === "enhance" ? VOLCENGINE_MEDIAKIT_ENHANCE_VIDEO_PROTOCOL : VOLCENGINE_MEDIAKIT_VIDEO_DEPTH_PROTOCOL;
                return { model, displayName: model, capability: "video" as const, protocol, capabilityConfig: defaultModelCapabilityConfig(protocol), billingMode: "per_second" as const, unitPriceMicrocredits: 100 };
            }),
        }),
    ],
};
const source: CanvasNodeData = {
    id: "source",
    type: CanvasNodeType.Video,
    title: "测试原片",
    position: { x: 0, y: 0 },
    width: 300,
    height: 500,
    metadata: { storageKey: "resource:source", content: "/source.mp4", durationMs: 18000, naturalWidth: 1080, naturalHeight: 1920 },
};
const quote = { logicalModelId: "", billingMode: "per_second" as const, quantity: 18, amountMicrocredits: 1800, estimated: true };
const noop = () => {};
let root: ReturnType<typeof createRoot>;
let price: ReturnType<typeof spyOn>;
let pending: Array<{ resolve: (value: { quote: typeof quote }) => void; reject: (error: Error) => void; signal?: AbortSignal }>;
beforeEach(() => {
    pending = [];
    useUserStore.setState((s) => ({ features: { ...s.features, creditsEnabled: true } }));
    price = spyOn(quotes, "quoteModel").mockImplementation((_, signal) => new Promise((resolve, reject) => pending.push({ resolve, reject, signal })));
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
    price.mockRestore();
});
afterAll(() => dom.happyDOM.abort());
const render = (child: ReactNode) => act(async () => root.render(<ConfigProvider theme={{ token: { motion: false } }}>{child}</ConfigProvider>));
const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
const button = (text: string) => {
    const result = buttons().find((node) => node.textContent?.replaceAll(" ", "") === text);
    expect(result).toBeTruthy();
    return result!;
};

test("增强报价失败明确提示，重试只读报价，成功后连续点击仅确认一次", async () => {
    const confirm = mock();
    await render(<CanvasVideoEnhanceDialog node={source} open config={config} onClose={noop} onConfirm={confirm} />);
    expect(button("开始增强").disabled).toBe(true);
    await act(async () => pending[0].reject(new Error("offline")));
    expect(document.body.textContent).toContain("积分报价暂不可用");
    expect(document.body.textContent).not.toContain("正在计算积分");
    await act(async () => button("重试报价").click());
    expect(price).toHaveBeenCalledTimes(2);
    expect(confirm).not.toHaveBeenCalled();
    expect(button("开始增强").disabled).toBe(true);
    await act(async () => pending[1].resolve({ quote }));
    expect(button("开始增强").disabled).toBe(false);
    await act(async () => {
        button("开始增强").click();
        button("开始增强").click();
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatchObject({ model: "processing::enhance", resolution: "1080p" });
});

test("增强切换规格和替换源资源立即作废报价，迟到报价不能启用开始", async () => {
    const confirm = mock();
    const editor = (node = source) => <CanvasVideoEnhanceDialog node={node} open config={config} onClose={noop} onConfirm={confirm} />;
    await render(editor());
    await act(async () => button("2K").click());
    expect(pending[0].signal?.aborted).toBe(true);
    await act(async () => pending[0].resolve({ quote }));
    expect(button("开始增强").disabled).toBe(true);
    await act(async () => pending[1].resolve({ quote }));
    expect(button("开始增强").disabled).toBe(false);
    await render(editor({ ...source, metadata: { ...source.metadata, storageKey: "resource:new-source" } }));
    expect(button("开始增强").disabled).toBe(true);
    expect(price).toHaveBeenCalledTimes(3);
    await act(async () => pending[2].resolve({ quote }));
    await act(async () => button("开始增强").click());
    expect(confirm.mock.calls[0][0].resolution).toBe("2k");
});

test("增强模型从目录移除后不能沿用旧报价提交，关闭积分时不请求报价", async () => {
    const confirm = mock();
    await render(<CanvasVideoEnhanceDialog node={source} open config={config} onClose={noop} onConfirm={confirm} />);
    await act(async () => pending[0].resolve({ quote }));
    await render(<CanvasVideoEnhanceDialog node={source} open config={{ ...config, channels: [] }} onClose={noop} onConfirm={confirm} />);
    expect(button("开始增强").disabled).toBe(true);
    await act(async () => useUserStore.setState((s) => ({ features: { ...s.features, creditsEnabled: false } })));
    await render(<CanvasVideoEnhanceDialog key="no-credits" node={source} open config={config} onClose={noop} onConfirm={confirm} />);
    expect(button("开始增强").disabled).toBe(false);
    expect(price).toHaveBeenCalledTimes(1);
});

async function chooseDepthModel(title: string) {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="深度处理模型"]');
    expect(input).toBeTruthy();
    await act(async () => input!.dispatchEvent(new dom.MouseEvent("mousedown", { bubbles: true })));
    const option = [...document.querySelectorAll<HTMLElement>(".ant-select-item-option")].find((item) => item.textContent === title);
    expect(option).toBeTruthy();
    await act(async () => option!.click());
}

test("深度报价失败可原地重试，切换模型后的旧响应不能启用开始", async () => {
    const confirm = mock();
    await render(<CanvasVideoDepthDialog node={source} open config={config} onClose={noop} onConfirm={confirm} />);
    await act(async () => pending[0].reject(new Error("offline")));
    await act(async () => button("重试报价").click());
    expect(price).toHaveBeenCalledTimes(2);
    expect(confirm).not.toHaveBeenCalled();
    await chooseDepthModel("depth-two");
    expect(pending[1].signal?.aborted).toBe(true);
    await act(async () => pending[1].resolve({ quote }));
    expect(button("开始处理").disabled).toBe(true);
    await act(async () => pending[2].resolve({ quote }));
    expect(button("开始处理").disabled).toBe(false);
    await act(async () => {
        button("开始处理").click();
        button("开始处理").click();
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith({ model: "processing::depth-two" });
});

test("深度模型下架后不能沿用旧报价，唯一可用模型仍可主动选择并重新报价", async () => {
    const confirm = mock();
    await render(<CanvasVideoDepthDialog node={source} open config={config} onClose={noop} onConfirm={confirm} />);
    await act(async () => pending[0].resolve({ quote }));
    const available = { ...config, channels: config.channels.map((channel) => ({ ...channel, models: ["depth-two"], modelCosts: channel.modelCosts?.filter((item) => item.model === "depth-two") })) };
    await render(<CanvasVideoDepthDialog node={source} open config={available} onClose={noop} onConfirm={confirm} />);
    expect(price).toHaveBeenCalledTimes(1);
    expect(button("开始处理").disabled).toBe(true);
    expect(document.body.textContent).toContain("原模型已不可用，请选择可用模型");
    await chooseDepthModel("depth-two");
    expect(price).toHaveBeenCalledTimes(2);
    expect(button("开始处理").disabled).toBe(true);
    await act(async () => pending[1].resolve({ quote }));
    expect(button("开始处理").disabled).toBe(false);
    await act(async () => button("开始处理").click());
    expect(confirm).toHaveBeenCalledWith({ model: "processing::depth-two" });
});

test("深度源资源替换立即作废报价，不会沿用旧资源报价提交", async () => {
    const confirm = mock();
    await render(<CanvasVideoDepthDialog node={source} open config={config} onClose={noop} onConfirm={confirm} />);
    await act(async () => pending[0].resolve({ quote }));
    const replacement = { ...source, metadata: { ...source.metadata, storageKey: "resource:replacement" } };
    await render(<CanvasVideoDepthDialog node={replacement} open config={config} onClose={noop} onConfirm={confirm} />);
    expect(button("开始处理").disabled).toBe(true);
    expect(price).toHaveBeenCalledTimes(2);
    await act(async () => button("开始处理").click());
    expect(confirm).not.toHaveBeenCalled();
    await act(async () => pending[1].resolve({ quote }));
    expect(button("开始处理").disabled).toBe(false);
});
