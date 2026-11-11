import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasImageTextLine } from "../../src/components/canvas/canvas-node-text-edit-dialog";

const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, Element: dom.Element, Node: dom.Node, HTMLElement: dom.HTMLElement, SVGElement: dom.SVGElement, ShadowRoot: dom.ShadowRoot, getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
Object.defineProperty(dom.HTMLElement.prototype, "animate", { configurable: true, value: undefined });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConfigProvider } = await import("antd");
const { CanvasNodeTextEditDialog } = await import("../../src/components/canvas/canvas-node-text-edit-dialog");
const { canvasTextDetectionModel, canvasTextDetectionPriceLabel, canvasTextDetectionSupportError } = await import("../../src/components/canvas/canvas-node-text-detection");
const { defaultConfig, useConfigStore, createModelChannel } = await import("../../src/stores/use-config-store");
const { defaultModelCapabilityConfig } = await import("../../src/lib/model-capabilities");
const { apiClient } = await import("../../src/services/api/request");
apiClient.defaults.adapter = async () => { throw new Error("No real model calls allowed in the dialog fixture"); };
afterAll(() => dom.happyDOM.abort());

function configFor(maxImages: number) {
    const capabilityConfig = defaultModelCapabilityConfig("chat-completion", "vision-text");
    capabilityConfig.text!.references.maxImages = maxImages;
    return {
        ...defaultConfig, model: "test::vision-text", textModel: "test::vision-text",
        channels: [createModelChannel({ id: "test", name: "测试模型", scope: "system", baseUrl: "https://example.test", models: ["vision-text"], modelCosts: [{ model: "vision-text", capability: "text", billingMode: "fixed_request", unitPriceMicrocredits: 1_000_000, capabilityConfig }] })],
    };
}

test("弹窗模型和执行模型一致，固定价格说明可用，看图能力不作猜测", () => {
    const config = configFor(1);
    expect(canvasTextDetectionModel(config)).toBe(config.textModel);
    expect(canvasTextDetectionPriceLabel(config, config.textModel)).toBe("约 1 积分/次");
    expect(canvasTextDetectionSupportError(config, config.textModel)).toBe("");
    expect(canvasTextDetectionSupportError(configFor(0), config.textModel)).toContain("不支持图片输入");
});

test("打开和切图不提交任务；点击才识别，旧响应被隔离，不支持的模型按钮禁用", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    useConfigStore.setState({ config: configFor(1) });
    let calls = 0;
    const completions: Array<(lines: CanvasImageTextLine[]) => void> = [];
    const onDetect = () => { calls++; return new Promise<CanvasImageTextLine[]>((resolve) => completions.push(resolve)); };
    const render = (source: string) => root.render(<ConfigProvider theme={{ token: { motion: false } }}><CanvasNodeTextEditDialog open dataUrl={`data:image/png;base64,${source}`} onClose={() => {}} onDetect={onDetect} onConfirm={() => {}} /></ConfigProvider>);
    const detectButton = () => Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.replace(/\s/g, "") === "识别文字")!;
    try {
        await act(async () => render("source-one"));
        expect(calls).toBe(0);
        expect(document.body.textContent).toContain("积分/次");
        await act(async () => detectButton().click());
        expect(calls).toBe(1);
        expect(document.body.textContent).toContain("正在识别图片文字");
        await act(async () => render("source-two"));
        expect(calls).toBe(1);
        await act(async () => completions[0]!([{ original: "旧图文字", text: "旧图文字", location: "左上" }]));
        expect(document.body.textContent).not.toContain("第 1 行");
        expect(detectButton().disabled).toBe(false);
        await act(async () => detectButton().click());
        expect(calls).toBe(2);
        await act(async () => completions[1]!([{ original: "新图文字", text: "新图文字", location: "右上" }]));
        expect(document.body.textContent).toContain("第 1 行");
        expect(document.querySelector<HTMLInputElement>('input[placeholder="新图文字"]')?.value).toBe("新图文字");
        await act(async () => {
            useConfigStore.setState({ config: configFor(0) });
            render("source-three");
        });
        expect(detectButton().disabled).toBe(true);
        await act(async () => detectButton().click());
        expect(calls).toBe(2);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
