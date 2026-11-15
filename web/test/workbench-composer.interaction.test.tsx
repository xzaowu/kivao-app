import { afterAll, afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { ReactNode } from "react";
import type { WorkbenchTool } from "../src/services/api/workbench";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConfigProvider } = await import("antd");
const { ParameterDisclosure, PromptSection, ReferenceSection, SceneSection } = await import("../src/pages/workbench/workbench-composer");
const roots: ReturnType<typeof createRoot>[] = [];
async function mount(children: ReactNode) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const render = async (content: ReactNode) => act(async () => root.render(<ConfigProvider theme={{ token: { motion: false } }}>{content}</ConfigProvider>));
    await render(children);
    return { host, render };
}
afterEach(async () => {
    for (const root of roots.splice(0)) await act(async () => root.unmount());
    document.body.innerHTML = "";
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) value ? Object.defineProperty(globalThis, key, value) : Reflect.deleteProperty(globalThis, key);
});

const tool: WorkbenchTool = {
    id: "product",
    kind: "video",
    categoryId: "video",
    name: "商品视频",
    subtitle: "选择器中保留的场景说明",
    description: "",
    sortOrder: 0,
    enabled: true,
    presets: [],
    inputContract: {
        promptRequired: true,
        minTextReferences: 0,
        slots: [
            { key: "product", name: "商品原图", mediaTypes: ["image"], required: true, minCount: 2, maxCount: 4 },
            { key: "sound", name: "参考声音", mediaTypes: ["audio"], required: false, minCount: 0, maxCount: 1 },
        ],
    },
};

test("场景入口直接打开完整选择器，已选场景不展开副标题", async () => {
    let opened = 0;
    const props = { kind: "video" as const, loading: false, error: "", onOpenLibrary: () => opened++, onRetry() {} };
    const { host, render } = await mount(<SceneSection {...props} tool={null} />);
    const button = host.querySelector("button")!;
    expect(button.textContent).toContain("选择创作场景（可选）");
    await act(async () => button.click());
    expect(opened).toBe(1);
    await render(<SceneSection {...props} tool={tool} />);
    expect(host.querySelector("button")!.textContent).toBe(tool.name);
    expect(host.textContent).not.toContain(tool.subtitle);
});

test("必填素材与缺少数量直接显示，可选素材默认收起且上传失败自动展开", async () => {
    const references = [{ id: "product-1", name: "商品图", kind: "image" as const, resourceId: "resource-1", previewUrl: "", progress: 100, uploading: false, role: "reference" as const, slotKey: "product" }];
    let picked = "";
    const props = { kind: "video" as const, tool, references, unslottedLimit: 9, onPick: (key?: string) => (picked = key || ""), onDropFiles() {}, onOpenLibrary() {}, onRemove() {}, onRoleChange() {}, onClear() {} };
    const { host, render } = await mount(<ReferenceSection {...props} />);
    expect(host.textContent).toContain("还需上传 1 个商品原图");
    expect(host.querySelector("details")!.open).toBe(false);
    expect(host.querySelector("details")!.textContent).toContain("参考声音");
    const add = host.querySelector<HTMLButtonElement>('[aria-label="上传商品原图"]')!;
    await act(async () => add.click());
    expect(picked).toBe("product");
    await render(<ReferenceSection {...props} references={[...references, { id: "sound-1", name: "声音", kind: "audio", previewUrl: "", progress: 0, uploading: false, error: "上传失败", role: "reference", slotKey: "sound" }]} />);
    expect(host.querySelector("details")!.open).toBe(true);
    expect(host.querySelector("summary")!.textContent).toContain("上传失败，请检查");
    expect(host.querySelectorAll(".wb-ref")).toHaveLength(2);
});

test("输入框放大缩小时保持编辑器与内容，灵感词仍能添加", async () => {
    let phrase = "";
    const { host } = await mount(
        <PromptSection
            kind="image"
            tool={null}
            preset={null}
            prompt="保留的描述 @商品原图"
            maxChars={32000}
            inspirations={[{ key: "light", label: "光线", phrases: ["柔和光线"] }]}
            editor={<textarea defaultValue="保留的描述 @商品原图" />}
            onChoosePreset={() => {}}
            onTogglePhrase={(value) => (phrase = value)}
            onClear={() => {}}
        />,
    );
    const editor = host.querySelector("textarea")!;
    expect(host.querySelector("details")!.open).toBe(false);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="放大输入框"]')!.click());
    expect(host.querySelector(".wb-prompt")!.classList.contains("is-expanded")).toBe(true);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="缩小输入框"]')!.click());
    expect(host.querySelector("textarea")).toBe(editor);
    expect(editor.value).toBe("保留的描述 @商品原图");
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "柔和光线")!.click());
    expect(phrase).toBe("柔和光线");
});

for (const mobile of [false, true]) {
    test(`${mobile ? "手机底部面板" : "电脑原位参数"}关闭重开保留选值，异常参数可展开修正`, async () => {
        dom.happyDOM.setWindowSize({ width: mobile ? 390 : 1440, height: 900 });
        const props = { summary: "15 秒 · 9:16 · 720p · 1 条", error: "" };
        const controls = <input aria-label="参数选值" defaultValue="15" />;
        const { host, render } = await mount(<ParameterDisclosure {...props}>{controls}</ParameterDisclosure>);
        const trigger = host.querySelector<HTMLButtonElement>("[aria-expanded]")!;
        expect(trigger.getAttribute("aria-expanded")).toBe(String(!mobile));
        expect(trigger.getAttribute("aria-haspopup")).toBe(mobile ? "dialog" : null);
        if (mobile) await act(async () => trigger.click());
        const field = document.querySelector<HTMLInputElement>('[aria-label="参数选值"]')!;
        expect(field).not.toBeNull();
        field.value = "10";
        if (mobile) await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="完成参数设置"]')!.click());
        else await act(async () => trigger.click());
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        await act(async () => trigger.click());
        expect(document.querySelector<HTMLInputElement>('[aria-label="参数选值"]')!.value).toBe("10");
        if (mobile) await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="完成参数设置"]')!.click());
        else await act(async () => trigger.click());
        await render(
            <ParameterDisclosure {...props} error="请修正时长">
                {controls}
            </ParameterDisclosure>,
        );
        expect(trigger.getAttribute("aria-expanded")).toBe("true");
    });
}

test("电脑默认展开，切换为手机不自动弹出参数，返回电脑保留收起选择", async () => {
    dom.happyDOM.setWindowSize({ width: 1440, height: 900 });
    const { host } = await mount(
        <ParameterDisclosure summary="15 秒 · 1 条" error="">
            <input aria-label="参数选值" defaultValue="15" />
        </ParameterDisclosure>,
    );
    const trigger = host.querySelector<HTMLButtonElement>("[aria-expanded]")!;
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await act(async () => dom.happyDOM.setWindowSize({ width: 390, height: 844 }));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await act(async () => dom.happyDOM.setWindowSize({ width: 1440, height: 900 }));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await act(async () => trigger.click());
    await act(async () => dom.happyDOM.setWindowSize({ width: 390, height: 844 }));
    await act(async () => dom.happyDOM.setWindowSize({ width: 1440, height: 900 }));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
});
