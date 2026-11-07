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
const { AuthDialogLayout } = await import("../../src/components/auth/auth-dialog-layout");
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
                          : {
                                tools: [
                                    {
                                        id: kind,
                                        kind,
                                        name: `${kind} public tool`,
                                        subtitle: "将参考商品置于纯白无缝背景中央，保留完整轮廓、真实颜色、材质和包装细节。",
                                        categoryId: "general",
                                        enabled: true,
                                        sortOrder: 0,
                                        resultExample: { items: [{ resourceId: "example-image", kind: "image", title: "匿名作品示例", description: "示例说明", url: "/example.png" }] },
                                        presets: [{ id: `${kind}-preset`, name: "标准效果", promptTemplate: "ADMIN_ONLY_TEMPLATE", enabled: true }],
                                    },
                                ],
                            }) as never,
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
                                    <AuthDialogLayout />
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
                expect(host.querySelector('[aria-label="创作流程"]')).toBeNull();
                expect(host.querySelector('[aria-label="重置工作台"]')).toBeNull();
                expect(host.querySelector(".workbench-block-label")).toBeNull();
                expect(host.querySelector(".workbench-guide-stage")).toBeNull();
                expect(host.textContent).not.toContain("作品会在这里呈现");
                expect(Array.from(host.querySelectorAll(".workbench-mobile-tabs .ant-segmented-item-label")).map((element) => element.textContent)).toEqual(["生成", "结果", "任务", "示例"]);
                expect(host.querySelector(".workbench-goal-picker")).toBeNull();
                expect(host.querySelector(".workbench-goal-card")).toBeNull();
                expect(host.textContent).not.toContain(`${kind} public tool`);
                expect(host.querySelector(".workbench-model-empty")?.textContent).toContain("登录后查看模型");
                expect(host.querySelector('a[href="/settings?section=models"]')).toBeNull();
                const library = host.querySelector<HTMLButtonElement>('[aria-label="从素材库选择参考素材"]')!;
                expect(library).not.toBeNull();
                await act(async () => library.click());
                expect(Array.from(document.querySelectorAll('[role="dialog"]')).some((dialog) => dialog.textContent?.includes("登录 / 注册"))).toBe(true);
                expect(get.mock.calls.every(([path]) => path === "/workbench/tools" || path === "/features" || path === "/banner-announcements" || path === "/auth/settings")).toBe(true);
                expect(post).not.toHaveBeenCalled();
                await act(async () => document.querySelector<HTMLButtonElement>(".ant-modal-close")!.click());
                const scenePicker = host.querySelector<HTMLButtonElement>(".workbench-tool-choice")!;
                expect(scenePicker.querySelector("strong")?.textContent).toBe("选择创作场景（可选）");
                expect(scenePicker.querySelector("small")).toBeNull();
                expect(host.querySelector(".workbench-direct-create")).toBeNull();
                await act(async () => scenePicker.click());
                expect(scenePicker.getAttribute("aria-expanded")).toBe("true");
                const scene = document.querySelector<HTMLButtonElement>(".workbench-picker-modal .workbench-tool-card")!;
                expect(scene.textContent).toContain(`${kind} public tool`);
                expect(scene.querySelector("small")).toBeNull();
                expect(scene.querySelector("img")?.getAttribute("src")).toBe("/example.png");
                expect(document.querySelector(".workbench-tool-library-heading")).toBeNull();
                const autoplay = document.querySelector<HTMLButtonElement>('.workbench-preview-autoplay [role="switch"]')!;
                const previousAutoplay = autoplay.getAttribute("aria-checked");
                await act(async () => autoplay.click());
                expect(autoplay.getAttribute("aria-checked")).not.toBe(previousAutoplay);
                await act(async () => scene.click());
                expect(scenePicker.getAttribute("aria-expanded")).toBe("false");
                expect(scenePicker.querySelector("strong")?.textContent).toBe(`${kind} public tool`);
                expect(scenePicker.querySelector("small")).toBeNull();
                expect(scenePicker.querySelector(".workbench-tool-change")).toBeNull();
                const clearScene = host.querySelector<HTMLButtonElement>(".workbench-tool-bar .workbench-direct-create")!;
                expect(clearScene.textContent).toBe("清除选择");
                expect(scenePicker.contains(clearScene)).toBe(false);
                expect(host.querySelector(".workbench-goal-picker")).toBeNull();
                expect(host.textContent).not.toContain("ADMIN_ONLY_TEMPLATE");
                expect(host.querySelector('[aria-label="生成提示词，可输入 @ 引用参考素材"]')).toBeNull();
                expect(host.querySelector('[aria-label="补充要求，可输入 @ 引用素材"]')).not.toBeNull();
                expect(host.querySelector('[aria-label="选择生成效果"]')?.textContent).toContain("标准效果");
                const tabs = Array.from(host.querySelectorAll<HTMLElement>(".workbench-mobile-tabs .ant-segmented-item"));
                await act(async () => tabs.find((element) => element.textContent === "示例")!.click());
                expect(host.querySelector(".workbench-example-title")?.textContent).toBe("匿名作品示例");
                expect(host.querySelector(".workbench-example figcaption")?.textContent).toBe("示例说明");
                expect(post).not.toHaveBeenCalled();
                await act(async () => tabs.find((element) => element.textContent === "生成")!.click());
                await act(async () => scenePicker.click());
                expect(scenePicker.getAttribute("aria-expanded")).toBe("true");
                await act(async () => document.querySelector<HTMLButtonElement>(".workbench-picker-modal .ant-modal-close")!.click());
                await act(async () => clearScene.click());
                expect(scenePicker.querySelector("strong")?.textContent).toBe("选择创作场景（可选）");
                expect(scenePicker.getAttribute("aria-expanded")).toBe("false");
                expect(document.activeElement).toBe(scenePicker);
                expect(host.querySelector(".workbench-direct-create")).toBeNull();
                expect(host.querySelector('[aria-label="生成提示词，可输入 @ 引用参考素材"]')).not.toBeNull();
                const generate = host.querySelector<HTMLButtonElement>(".workbench-submit")!;
                expect(generate.textContent).toContain("登录后生成");
                expect(generate.disabled).toBe(false);
                await act(async () => generate.click());
                expect(Array.from(document.querySelectorAll('[role="dialog"]')).some((dialog) => dialog.textContent?.includes("登录 / 注册"))).toBe(true);
                expect(get.mock.calls.length).toBeGreaterThan(0);
                expect(get.mock.calls.every(([path]) => path === "/workbench/tools" || path === "/features" || path === "/banner-announcements" || path === "/auth/settings")).toBe(true);
                expect(post).not.toHaveBeenCalled();
            } finally {
                await act(async () => root.unmount());
                queryClient.clear();
                host.remove();
            }
        });
    }
}
