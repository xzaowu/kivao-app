import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasResourceReference } from "../../src/lib/canvas/canvas-resource-references";

const dom = new Window({ url: "http://localhost/" });
// happy-dom's WAAPI cancellation rejects unfinished animations; exercise state with Motion's JS fallback.
Object.defineProperty(dom.HTMLElement.prototype, "animate", { configurable: true, value: undefined });
for (const key of ["window", "document", "navigator", "Element", "Node", "HTMLElement", "HTMLTextAreaElement", "MutationObserver", "ResizeObserver"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : dom[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom) });
const { act, useRef } = await import("react");
const { createRoot } = await import("react-dom/client");
const { splitMentionText, renderEditableContent, repairEditableMentionBoundaries, serializeEditableValue, getEditableSelection, setEditableSelection, staleEditableMentionParts, redrawEditableParts } = await import("../../src/components/canvas/canvas-mention-editable");
const { MentionHoverPreview, useMentionHoverPreview } = await import("../../src/components/canvas/canvas-mention-hover-preview");
const { CanvasConnectionCreateMenu } = await import("../../src/components/canvas/canvas-workspace-overlays");
const { useUserStore, defaultFeatureAvailability } = await import("../../src/stores/use-user-store");
const { CanvasNodeType } = await import("../../src/types/canvas");
const image: CanvasResourceReference = { id: "image-1", nodeId: "node-1", kind: "image", label: "图片1", title: "商品原图", previewUrl: "data:image/png;base64,AA==", active: true };
afterAll(() => dom.happyDOM.abort());

test("编号可紧接中文但不截断更长编号，名称和编码仍各有边界", () => {
    expect(splitMentionText("@图片1里的商品", [image])[0]).toMatchObject({ type: "mention", reference: { id: image.id } });
    expect(splitMentionText("@图片12里的商品", [image])).toEqual([{ type: "text", text: "@图片12里的商品" }]);
    const asset = { ...image, id: "asset:asset-1", assetId: "asset-1", label: "商品" };
    expect(splitMentionText("@商品图", [asset])).toEqual([{ type: "text", text: "@商品图" }]);
    expect(splitMentionText("@[asset:asset-1]里的商品", [asset])[0]).toMatchObject({ type: "mention", token: "@[asset:asset-1]" });
});

test("胶囊后输入数字补空格并保留选区，不会变成另一个引用", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    document.body.append(editor);
    renderEditableContent(editor, "@图片1", [image]);
    editor.append(document.createTextNode("2"));
    setEditableSelection(editor, 5);
    expect(repairEditableMentionBoundaries(editor)).toBe(true);
    expect(serializeEditableValue(editor)).toBe("@图片1 2");
    expect(getEditableSelection(editor)).toEqual({ start: 6, end: 6 });
    editor.remove();
});

test("异步引用到达后重绘真实胶囊且保留滚动与选区", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    document.body.append(editor);
    renderEditableContent(editor, "@图片1 的商品", []);
    setEditableSelection(editor, 5, 7);
    editor.scrollTop = 40;
    const parts = staleEditableMentionParts(editor, "@图片1 的商品", [image]);
    expect(parts).not.toBeNull();
    redrawEditableParts(editor, parts!, getEditableSelection(editor));
    expect(editor.querySelector("[data-mention-reference-id]")?.getAttribute("data-mention-reference-id")).toBe(image.id);
    expect(getEditableSelection(editor)).toEqual({ start: 5, end: 7 });
    expect(editor.scrollTop).toBe(40);
    expect(serializeEditableValue(editor)).toBe("@图片1 的商品");
    editor.remove();
});

function HoverHarness() {
    const hover = useMentionHoverPreview([image]);
    return <div onPointerOver={hover.onPointerOver} onPointerOut={hover.onPointerOut} onPointerDown={hover.dismiss}>
        <span data-mention-reference-id={image.id}>图片1</span>
        {hover.target ? <MentionHoverPreview target={hover.target} /> : null}
    </div>;
}

test("鼠标延迟显示 body 预览，点击关闭、触屏不弹出、卸载清理计时器", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const timers = new Map<number, () => void>();
    const originalSetTimeout = window.setTimeout;
    const originalClearTimeout = window.clearTimeout;
    window.setTimeout = ((callback: () => void, delay: number) => {
        expect(delay).toBe(500);
        timers.set(1, callback);
        return 1;
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id: number) => { timers.delete(id); }) as typeof window.clearTimeout;
    try {
        await act(async () => root.render(<HoverHarness />));
        const chip = host.querySelector("span")!;
        await act(async () => chip.dispatchEvent(new dom.PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })));
        expect(document.querySelector(".canvas-mention-hover-preview")).toBeNull();
        expect(timers.size).toBe(1);
        await act(async () => { const open = timers.get(1)!; timers.clear(); open(); });
        const preview = document.querySelector(".canvas-mention-hover-preview")!;
        expect(preview.parentElement).toBe(document.body);
        expect(preview.textContent).toContain("商品原图");
        await act(async () => chip.dispatchEvent(new dom.PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" })));
        expect(document.querySelector(".canvas-mention-hover-preview")).toBeNull();
        await act(async () => chip.dispatchEvent(new dom.PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" })));
        await act(async () => chip.dispatchEvent(new dom.PointerEvent("pointerover", { bubbles: true, pointerType: "touch" })));
        expect(document.querySelector(".canvas-mention-hover-preview")).toBeNull();
        expect(timers.size).toBe(0);
        await act(async () => root.render(<HoverHarness key="pending-unmount" />));
        await act(async () => host.querySelector("span")!.dispatchEvent(new dom.PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })));
        expect(timers.size).toBe(1);
    } finally {
        await act(async () => root.unmount());
        expect(timers.size).toBe(0);
        window.setTimeout = originalSetTimeout;
        window.clearTimeout = originalClearTimeout;
        host.remove();
    }
});

test("固定行高菜单保留 KIVAO 绘图/转换开关、禁用原因和 Escape 关闭", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const created: string[] = [];
    let closed = 0;
    function Menu() {
        const container = useRef<HTMLDivElement>(null);
        return <div ref={container}><CanvasConnectionCreateMenu pending={{ position: { x: 20, y: 20 }, connection: { nodeId: "source", handleType: "source" } }} viewport={{ x: 0, y: 0, k: 1 }} viewportSize={{ width: 800, height: 600 }} containerRef={container} canCreateDrawing getDisabledReason={(type) => type === CanvasNodeType.Image ? "缺少图片模型" : ""} onCreate={(type) => created.push(type)} onClose={() => closed++} /></div>;
    }
    try {
        useUserStore.setState({ features: { ...defaultFeatureAvailability, canvasDrawingEnabled: false, canvasConversionEnabled: false } });
        await act(async () => root.render(<Menu />));
        expect(host.querySelectorAll("[data-create-option]")).toHaveLength(7);
        const button = host.querySelector<HTMLButtonElement>('[data-create-option="图片生成"]')!;
        expect(button.getAttribute("aria-disabled")).toBe("true");
        expect(button.getAttribute("aria-description")).toBe("缺少图片模型");
        await act(async () => button.click());
        expect(created).toEqual([]);
        await act(async () => host.querySelector<HTMLButtonElement>('[data-create-option="文本生成"]')!.click());
        expect(created).toEqual([CanvasNodeType.Text]);
        await act(async () => host.querySelector('[aria-label="创建下一步"]')!.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
        expect(closed).toBe(1);
        await act(async () => useUserStore.setState({ features: { ...defaultFeatureAvailability, canvasDrawingEnabled: true, canvasConversionEnabled: true } }));
        expect(host.querySelectorAll("[data-create-option]")).toHaveLength(9);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
