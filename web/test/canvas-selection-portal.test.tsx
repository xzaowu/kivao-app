import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, Event: dom.Event, CustomEvent: dom.CustomEvent, MouseEvent: dom.MouseEvent, requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act, useRef, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { createPortal } = await import("react-dom");
const { useCanvasSelectionController } = await import("../src/pages/canvas/use-canvas-selection-controller");
const { createCanvasNode } = await import("../src/lib/canvas/canvas-project-domain");
const { CanvasNodeType } = await import("../src/types/canvas");

afterAll(async () => {
    await dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("portal menu click executes without selecting or dragging its React parent node", async () => {
    const host = document.createElement("div");
    const portalHost = document.createElement("div");
    document.body.append(host, portalHost);
    const node = createCanvasNode(CanvasNodeType.Text, { x: 50, y: 80 });
    const selected = { current: new Set<string>() };
    const paused = { current: false };
    let interactions = 0;
    let menuClicks = 0;
    function Harness() {
        const containerRef = useRef<HTMLDivElement>(null);
        const nodesRef = useRef([node]);
        const viewportRef = useRef({ x: 0, y: 0, k: 1 });
        const [, setNodes] = useState([node]);
        const [, setSelected] = useState(new Set<string>());
        const controller = useCanvasSelectionController({
            containerRef, nodesRef, viewportRef, selectedNodeIdsRef: selected, historyPausedRef: paused,
            screenToCanvas: (x, y) => ({ x, y }), setNodes, setSelectedNodeIds: setSelected,
            setSelectedConnectionId: () => {}, cancelPendingConnectionCreate: () => {}, onCanvasSelectionStart: () => {},
            onNodeInteractionStart: () => { interactions++; }, onNodeClick: () => {}, onDeselect: () => {},
        });
        return <div ref={containerRef} onMouseDown={(event) => controller.handleNodeMouseDown(event, node.id)}>
            <span data-node-body>Node body</span>
            {createPortal(<div role="menuitem" onClick={() => { menuClicks++; }}>Menu command</div>, portalHost)}
        </div>;
    }
    const root = createRoot(host);
    try {
        await act(() => root.render(<Harness />));
        const menu = portalHost.querySelector("[role=menuitem]")!;
        await act(() => {
            menu.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
            menu.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
        });
        expect(menuClicks).toBe(1);
        expect(interactions).toBe(0);
        expect(selected.current.size).toBe(0);
        expect(paused.current).toBe(false);
        await act(() => host.querySelector("[data-node-body]")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
        expect(interactions).toBe(1);
        expect(selected.current.has(node.id)).toBe(true);
        expect(paused.current).toBe(true);
        await act(() => window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 })));
        expect(paused.current).toBe(false);
    } finally {
        await act(() => root.unmount());
        host.remove();
        portalHost.remove();
    }
});
