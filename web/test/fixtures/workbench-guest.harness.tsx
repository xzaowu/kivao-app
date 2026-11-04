import { afterAll, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    CustomEvent: dom.CustomEvent,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router");
const { App } = await import("antd");
const { http } = await import("../../src/services/api/request");
const { useUserStore } = await import("../../src/stores/use-user-store");
const { WorkbenchPage } = await import("../../src/pages/workbench/image-workbench-page");
const get = spyOn(http, "get").mockResolvedValue({ tools: [] });
const post = spyOn(http, "post").mockResolvedValue({});

afterAll(() => {
    get.mockRestore();
    post.mockRestore();
    dom.happyDOM.abort();
});

for (const kind of ["image", "video"] as const) {
    test(`${kind} guest page opens login before any task or upload request`, async () => {
        useUserStore.setState({ user: null, hydrated: true });
        get.mockClear();
        get.mockResolvedValue({ tools: [{ id: kind, kind, name: `${kind} public tool`, categoryId: "general", enabled: true, sortOrder: 0, presets: [] }] });
        post.mockClear();
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);
        try {
            await act(async () =>
                root.render(
                    <MemoryRouter>
                        <App>
                            <WorkbenchPage kind={kind} />
                        </App>
                    </MemoryRouter>,
                ),
            );
            expect(host.querySelector(`[data-kind="${kind}"]`)).not.toBeNull();
            expect(host.textContent).toContain(`${kind} public tool`);
            expect(host.querySelector(".workbench-model-empty")?.textContent).toContain("登录后查看模型");
            expect(host.querySelector('a[href="/settings?section=models"]')).toBeNull();
            const generate = host.querySelector<HTMLButtonElement>(".workbench-submit")!;
            expect(generate.textContent).toContain("登录后生成");
            expect(generate.disabled).toBe(false);
            await act(async () => generate.click());
            expect(document.querySelector('[role="dialog"]')?.textContent).toContain("登录后开始创作");
            expect(get.mock.calls.length).toBeGreaterThan(0);
            expect(get.mock.calls.every(([path]) => path === "/workbench/tools")).toBe(true);
            expect(post).not.toHaveBeenCalled();
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    });
}
