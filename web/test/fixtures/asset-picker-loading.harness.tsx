import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
for (const key of ["document", "navigator", "HTMLElement", "HTMLBodyElement", "HTMLHtmlElement", "Element", "SVGElement", "ShadowRoot", "Node", "CustomEvent", "MutationObserver", "ResizeObserver"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom[key] });
}
Object.assign(globalThis, { window: dom, getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true });
const storage = new Map<string, string>();
mock.module("@/lib/localforage-storage", () => ({
    localForageStorageForScope: () => ({
        getItem: async (key: string) => storage.get(key) ?? null,
        setItem: async (key: string, value: string) => {
            storage.set(key, value);
        },
        removeItem: async (key: string) => {
            storage.delete(key);
        },
    }),
}));
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConfigProvider, App } = await import("antd");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const sync = await import("../../src/services/user-data-sync");
let loadPage: typeof sync.loadAssetLibraryPage;
mock.module("@/services/user-data-sync", () => ({ ...sync, loadAssetLibraryPage: (...args: Parameters<typeof loadPage>) => loadPage(...args) }));
const { AssetLibraryPickerModal } = await import("../../src/components/assets/asset-library-picker-modal");
const { useUserStore } = await import("../../src/stores/use-user-store");
const roots: ReturnType<typeof createRoot>[] = [];
const clients: InstanceType<typeof QueryClient>[] = [];
const page = { assets: [], total: 0, page: 1, pageSize: 40, categoryCounts: {} };
beforeEach(() => {
    useUserStore.setState({ user: { id: "picker-loading-user", username: "fixture", displayName: "fixture", role: "user", status: "active" }, hydrated: true });
});
afterEach(async () => {
    for (const root of roots.splice(0)) await act(async () => root.unmount());
    for (const client of clients.splice(0)) client.clear();
    document.body.innerHTML = "";
});
afterAll(() => dom.happyDOM.abort());
async function mount(items: Parameters<typeof AssetLibraryPickerModal>[0]["items"] = []) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    clients.push(client);
    await act(async () =>
        root.render(
            <QueryClientProvider client={client}>
                <ConfigProvider theme={{ token: { motion: false } }}>
                    <App>
                        <AssetLibraryPickerModal remoteLibrary open items={items} categoryLabels={{ all: "全部" }} onClose={() => {}} onConfirm={() => {}} emptyTitle="素材确实为空" />
                    </App>
                </ConfigProvider>
            </QueryClientProvider>,
        ),
    );
}
async function flushQuery() {
    // React Query 默认异步批量通知；这里只冲刷通知队列，不代替页面等待条件。
    await act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
}
test("首次远程素材请求期间显示加载状态，成功空结果才显示空态", async () => {
    let complete!: (value: typeof page) => void;
    loadPage = () =>
        new Promise((resolve) => {
            complete = resolve;
        });
    await mount();
    expect(document.querySelector('.asset-picker-grid[aria-busy="true"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("素材确实为空");
    await act(async () => complete(page));
    await flushQuery();
    expect(document.querySelector('.asset-picker-grid[aria-busy="true"]')).toBeNull();
    expect(document.body.textContent).toContain("素材确实为空");
});
test("远程请求失败保留重试入口，重试过程中重新显示加载而非空态", async () => {
    let attempts = 0;
    let complete!: (value: typeof page) => void;
    loadPage = async () => {
        if (++attempts === 1) throw new Error("temporary fixture failure");
        return new Promise((resolve) => {
            complete = resolve;
        });
    };
    await mount();
    await flushQuery();
    const retry = document.querySelector<HTMLButtonElement>('.asset-picker-empty[role="alert"] button');
    expect(retry).not.toBeNull();
    expect(document.body.textContent).not.toContain("素材确实为空");
    await act(async () => retry!.click());
    await flushQuery();
    expect(document.querySelector('.asset-picker-grid[aria-busy="true"]')).not.toBeNull();
    await act(async () => complete(page));
    await flushQuery();
    expect(attempts).toBe(2);
    expect(document.body.textContent).toContain("素材确实为空");
});
test("已有本地素材在远程加载期间仍可显示和选择", async () => {
    loadPage = () => new Promise(() => {});
    await mount([{ id: "local-text", title: "已缓存参考文本", category: "material", kindLabel: "文本", mediaKind: "text", description: "本地参考" }]);
    expect(document.querySelector('.asset-picker-grid[aria-busy="true"]')).toBeNull();
    expect(document.body.textContent).toContain("已缓存参考文本");
    const card = document.querySelector<HTMLButtonElement>(".asset-picker-card-action");
    expect(card).not.toBeNull();
    await act(async () => card!.click());
    expect(card!.getAttribute("aria-pressed")).toBe("true");
});
