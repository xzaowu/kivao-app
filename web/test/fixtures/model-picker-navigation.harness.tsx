import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
for (const key of ["document", "navigator", "HTMLElement", "HTMLBodyElement", "HTMLHtmlElement", "Element", "SVGElement", "ShadowRoot", "Node", "CustomEvent", "MutationObserver", "ResizeObserver"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom[key] });
}
Object.assign(globalThis, {
    window: dom,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
});
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConfigProvider } = await import("antd");
let reloads = 0;
mock.module("@/lib/user-session", () => ({
    refreshSystemChannels: async () => {
        reloads++;
        useModelCatalogStore.setState({ status: "loading" });
        await Promise.resolve();
        useConfigStore.setState({ config });
        useModelCatalogStore.setState({ status: "ready" });
    },
}));
const { ModelPicker } = await import("../../src/components/model-picker");
const { createModelChannel, defaultConfig, normalizeConfigSnapshot, useConfigStore } = await import("../../src/stores/use-config-store");
const { defaultModelCapabilityConfig } = await import("../../src/lib/model-capabilities");
const { useUserStore } = await import("../../src/stores/use-user-store");
const { useModelCatalogStore } = await import("../../src/stores/use-model-catalog-store");
const { useAuthDialogStore } = await import("../../src/stores/use-auth-dialog-store");
const user = { id: "picker-user", username: "fixture", displayName: "fixture", role: "user" as const, status: "active" as const };
const channel = createModelChannel({
    id: "picker-test",
    name: "本地测试",
    scope: "system",
    models: ["image-a", "image-b"],
    modelCosts: ["a", "b"].map((suffix) => ({
        model: `image-${suffix}`,
        displayName: `分组${suffix.toUpperCase()}`,
        channelLabel: `线路${suffix.toUpperCase()}`,
        capability: "image" as const,
        unitPriceMicrocredits: 0,
        capabilityConfig: defaultModelCapabilityConfig("openai-image", `image-${suffix}`),
    })),
});
const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [channel], imageModel: "picker-test::image-a", imageModels: ["picker-test::image-a", "picker-test::image-b"] } }).config;
const roots: ReturnType<typeof createRoot>[] = [];

beforeEach(() => {
    reloads = 0;
    useUserStore.setState((state) => ({ user, hydrated: true, features: { ...state.features, creditsEnabled: false, customChannelsEnabled: false } }));
    useModelCatalogStore.setState({ status: "ready" });
    useAuthDialogStore.getState().closeDialog();
});

async function mount(initial = "picker-test::image-a", settings: { config?: typeof config; live?: boolean; modelFilter?: (model: string) => boolean; catalogSource?: "provided" } = {}) {
    const changes: string[] = [];
    function Harness() {
        const [value, setValue] = useState(initial);
        const storedConfig = useConfigStore((state) => state.config);
        return (
            <ModelPicker
                config={settings.live ? storedConfig : settings.config || config}
                value={value}
                capability="image"
                showSelectedPrice={false}
                modelFilter={settings.modelFilter}
                catalogSource={settings.catalogSource}
                onChange={(next) => {
                    changes.push(next);
                    setValue(next);
                }}
            />
        );
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () =>
        root.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <Harness />
            </ConfigProvider>,
        ),
    );
    const trigger = host.querySelector<HTMLButtonElement>("button")!;
    await act(async () => trigger.click());
    return { trigger, changes };
}
function menu() {
    return document.querySelector<HTMLElement>(".canvas-model-picker-menu")!;
}
function button(text: string) {
    return Array.from(menu().querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.includes(text))!;
}
async function click(text: string) {
    const target = button(text);
    expect(target, `缺少按钮 ${text}`).toBeDefined();
    await act(async () => target.click());
}
afterEach(async () => {
    for (const root of roots.splice(0)) await act(async () => root.unmount());
    document.body.innerHTML = "";
});
afterAll(() => dom.happyDOM.abort());

test("返回全部分组不修改当前模型，跨组选择后关闭，重开定位新选中项", async () => {
    const { trigger, changes } = await mount();
    expect(menu().querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain("线路A");
    await click("全部模型分组");
    expect(menu().classList.contains("is-brand-list")).toBe(true);
    expect(changes).toEqual([]);
    await click("分组B");
    await click("线路B");
    expect(changes).toEqual(["picker-test::image-b"]);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await act(async () => trigger.click());
    expect(menu().querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain("线路B");
    await click("全部模型分组");
    await click("分组A");
    expect(changes).toHaveLength(1);
    expect(menu().querySelector('[role="option"]')?.textContent).toContain("线路A");
});

test("无有效模型从全部分组进入，Escape 关闭，键盘左箭头仍可返回", async () => {
    const { trigger, changes } = await mount("已停用模型");
    expect(menu().classList.contains("is-brand-list")).toBe(true);
    await click("分组B");
    await act(async () => menu().dispatchEvent(new dom.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }) as unknown as KeyboardEvent));
    expect(menu().classList.contains("is-brand-list")).toBe(true);
    await act(async () => menu().dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as unknown as KeyboardEvent));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    expect(changes).toEqual([]);
});

test("游客可选择公开目录模型，保留跨分组导航", async () => {
    useUserStore.setState({ user: null });
    const { trigger, changes } = await mount();
    expect(menu().textContent).not.toContain("登录后查看模型");
    await click("全部模型分组");
    await click("分组B");
    await click("线路B");
    expect(changes).toEqual(["picker-test::image-b"]);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(useAuthDialogStore.getState().open).toBe(false);
});

test("游客真实空目录仍提供登录弹窗，不跳配置页或切换模型", async () => {
    useUserStore.setState({ user: null });
    const { trigger, changes } = await mount("", { config: defaultConfig });
    expect(menu().textContent).toContain("登录后查看模型");
    expect(menu().textContent?.match(/登录后查看模型/g)).toHaveLength(1);
    expect(menu().textContent).not.toContain("检查模型配置");
    await click("登录后查看模型");
    expect(useAuthDialogStore.getState()).toMatchObject({ open: true, view: "login", next: null });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(changes).toEqual([]);
});

test("平台目录加载与失败有明确状态，重试恢复模型后可以选择", async () => {
    useConfigStore.setState({ config: defaultConfig });
    useModelCatalogStore.setState({ status: "loading" });
    const { changes } = await mount("", { live: true });
    expect(menu().textContent).toContain("正在加载模型");
    expect(button("重新加载")).toBeUndefined();
    await act(async () => useModelCatalogStore.setState({ status: "error" }));
    expect(menu().textContent).toContain("模型列表加载失败");
    await click("重新加载");
    expect(reloads).toBe(1);
    await click("分组B");
    await click("线路B");
    expect(changes).toEqual(["picker-test::image-b"]);
});

test("目录刷新失败仍能选择缓存中的模型", async () => {
    useModelCatalogStore.setState({ status: "error" });
    const { changes } = await mount();
    expect(menu().textContent).toContain("仍可选择已加载模型");
    await click("全部模型分组");
    await click("分组B");
    await click("线路B");
    expect(changes).toEqual(["picker-test::image-b"]);
    expect(reloads).toBe(0);
});

test("平台目录错误不影响纯个人配置和明确独立的预览配置", async () => {
    useUserStore.setState({ user: null });
    useModelCatalogStore.setState({ status: "error" });
    const personal = { ...config, channels: config.channels.map((item) => ({ ...item, scope: "user" as const })) };
    await mount(undefined, { config: personal });
    expect(menu().querySelector('[role="option"]')).not.toBeNull();
    expect(menu().textContent).not.toContain("加载失败");
    expect(menu().textContent).not.toContain("登录后查看模型");
    await act(async () => roots.pop()!.unmount());
    document.body.innerHTML = "";
    await mount(undefined, { catalogSource: "provided" });
    expect(menu().querySelector('[role="option"]')).not.toBeNull();
    expect(menu().textContent).not.toContain("加载失败");
});

test("真实空目录按权限显示操作，不会打开菜单就跳设置", async () => {
    const navigations: string[] = [];
    const capture = (event: Event) => {
        event.preventDefault();
        navigations.push((event as CustomEvent<{ to: string }>).detail.to);
    };
    window.addEventListener("workspace:navigate", capture);
    try {
        await mount("", { config: defaultConfig });
        expect(menu().textContent).toContain("请联系管理员");
        expect(button("配置个人渠道")).toBeUndefined();
        expect(menu().querySelector('a[href="/admin/channels"]')).toBeNull();
        expect(navigations).toEqual([]);
        await act(async () => useUserStore.setState((state) => ({ features: { ...state.features, customChannelsEnabled: true } })));
        await click("配置个人渠道");
        expect(navigations).toEqual(["/settings?section=channels"]);
    } finally {
        window.removeEventListener("workspace:navigate", capture);
    }
});

test("管理员空目录有管理入口；能力为空与筛选无匹配不称为输入不支持", async () => {
    useUserStore.setState({ user: { ...user, role: "admin" } });
    await mount("", { config: defaultConfig });
    expect(menu().textContent).toContain("暂无可用的生图模型");
    expect(menu().querySelector('a[href="/admin/channels"]')).not.toBeNull();
    await act(async () => roots.pop()!.unmount());
    document.body.innerHTML = "";
    await mount("", { modelFilter: () => false });
    expect(menu().textContent).toContain("暂无符合当前筛选条件的生图模型");
    expect(menu().textContent).not.toContain("不支持当前输入");
});

test("退出账号清空旧目录，公开目录就绪后只显示游客可用模型", async () => {
    useConfigStore.setState({ config });
    await mount(undefined, { live: true });
    expect(menu().querySelector('[role="option"]') !== null).toBe(true);
    await act(async () => {
        useUserStore.setState({ user: null });
        useConfigStore.setState({ config: defaultConfig });
        useModelCatalogStore.setState({ status: "loading" });
    });
    expect(menu().querySelector('[role="option"]') === null).toBe(true);
    expect(menu().textContent).toContain("正在加载模型");
    const publicConfig = { ...config, imageModel: "picker-test::image-b", channels: config.channels.map((item) => ({ ...item, models: ["image-b"], modelCosts: item.modelCosts?.filter((cost) => cost.model === "image-b") })) };
    await act(async () => {
        useConfigStore.setState({ config: publicConfig });
        useModelCatalogStore.setState({ status: "ready" });
    });
    expect(menu().textContent).not.toContain("线路A");
    expect(menu().textContent).not.toContain("分组A");
    await click("分组B");
    expect(menu().textContent).toContain("线路B");
});
