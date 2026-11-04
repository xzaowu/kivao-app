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
    __APP_VERSION__: "test",
})) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router");
const { App } = await import("antd");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { http } = await import("../../src/services/api/request");
const { useUserStore } = await import("../../src/stores/use-user-store");
const { defaultFeatureAvailability } = await import("../../src/stores/use-user-store");
const { WorkbenchPage } = await import("../../src/pages/workbench/image-workbench-page");
const { default: UserLayout } = await import("../../src/layouts/user-layout");
const { RequireFeature } = await import("../../src/components/auth/require-feature");
const get = spyOn(http, "get").mockResolvedValue({ tools: [] });
const post = spyOn(http, "post").mockResolvedValue({});

afterAll(() => {
    get.mockRestore();
    post.mockRestore();
    dom.happyDOM.abort();
});

test("guest home loads public feature flags before showing workbench navigation", async () => {
    useUserStore.setState({ user: null, hydrated: true, features: defaultFeatureAvailability });
    get.mockClear();
    post.mockClear();
    get.mockImplementation(async (path) => (path === "/features" ? { features: { ...defaultFeatureAvailability, imageWorkbenchEnabled: true, videoWorkbenchEnabled: true } } : { banners: [] }) as never);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
        await act(async () =>
            root.render(
                <MemoryRouter>
                    <QueryClientProvider client={queryClient}>
                        <App>
                            <UserLayout>
                                <div>Guest home</div>
                            </UserLayout>
                        </App>
                    </QueryClientProvider>
                </MemoryRouter>,
            ),
        );
        expect(host.querySelector('a[href="/toolbox/image"]')).not.toBeNull();
        expect(host.querySelector('a[href="/toolbox/video"]')).not.toBeNull();
        expect(get.mock.calls.some(([path]) => path === "/features")).toBe(true);
        expect(get.mock.calls.every(([path]) => path === "/features" || path === "/banner-announcements")).toBe(true);
        expect(post).not.toHaveBeenCalled();
    } finally {
        await act(async () => root.unmount());
        queryClient.clear();
        host.remove();
    }
});

for (const kind of ["image", "video"] as const) {
    for (const enabled of [true, false]) {
        test(`${kind} guest navigation respects feature=${enabled} and requires login to generate`, async () => {
            useUserStore.setState({ user: null, hydrated: true, features: defaultFeatureAvailability });
            get.mockClear();
            get.mockImplementation(
                async (path) =>
                    (path === "/features"
                        ? { features: { ...defaultFeatureAvailability, imageWorkbenchEnabled: enabled, videoWorkbenchEnabled: enabled } }
                        : path === "/banner-announcements"
                          ? { banners: [] }
                          : { tools: [{ id: kind, kind, name: `${kind} public tool`, categoryId: "general", enabled: true, sortOrder: 0, presets: [] }] }) as never,
            );
            post.mockClear();
            const host = document.createElement("div");
            document.body.append(host);
            const root = createRoot(host);
            const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
            try {
                await act(async () =>
                    root.render(
                        <MemoryRouter>
                            <QueryClientProvider client={queryClient}>
                                <App>
                                    <UserLayout>
                                        <RequireFeature feature={kind === "image" ? "imageWorkbenchEnabled" : "videoWorkbenchEnabled"}>
                                            <WorkbenchPage kind={kind} />
                                        </RequireFeature>
                                    </UserLayout>
                                </App>
                            </QueryClientProvider>
                        </MemoryRouter>,
                    ),
                );
                expect(Boolean(host.querySelector(`a[href="/toolbox/${kind}"]`))).toBe(enabled);
                if (!enabled) {
                    expect(host.textContent).toContain((kind === "image" ? "生图" : "视频") + "暂未开放");
                    expect(host.querySelector(".workbench-submit")).toBeNull();
                    expect(get.mock.calls.every(([path]) => path === "/features" || path === "/banner-announcements")).toBe(true);
                    expect(post).not.toHaveBeenCalled();
                    return;
                }
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
                expect(get.mock.calls.every(([path]) => path === "/workbench/tools" || path === "/features" || path === "/banner-announcements")).toBe(true);
                expect(post).not.toHaveBeenCalled();
            } finally {
                await act(async () => root.unmount());
                queryClient.clear();
                host.remove();
            }
        });
    }
}
