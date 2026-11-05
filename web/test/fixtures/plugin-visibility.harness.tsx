import { afterAll, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { BackendPlugin } from "../../src/services/api/plugins";

const dom = new Window({ url: "http://localhost/plugins" });
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
const { http } = await import("../../src/services/api/request");
const { default: PluginsPage } = await import("../../src/pages/plugins");
const { useUserStore, defaultFeatureAvailability } = await import("../../src/stores/use-user-store");
const { usePluginStore } = await import("../../src/stores/use-plugin-store");
const get = spyOn(http, "get");
const put = spyOn(http, "put").mockResolvedValue({});

afterAll(() => {
    get.mockRestore();
    put.mockRestore();
    dom.happyDOM.abort();
});

function plugin(id: string, kind: "application" | "protocol", capability?: "text" | "image"): BackendPlugin {
    return {
        manifest: {
            id,
            name: id,
            version: "1.0.0",
            apiVersion: "yingce.plugin/v1",
            description: "本地插件列表夹具",
            author: "local",
            permissions: [],
            contributes: capability ? { providers: [{ id: id + "-provider", name: id, capabilities: [capability] }] } : { workflows: [{ id: id + "-workflow", name: id }] },
        },
        source: kind === "application" ? "uploaded" : "system",
        fileName: "",
        package: "",
        sha256: "",
        installedAt: "",
        updatedAt: "",
        status: "enabled",
        management: { origin: "uploaded", kind, activationScope: kind === "application" ? "user" : "system", configurationScope: "none" },
    } as BackendPlugin;
}

async function render(role: "user" | "admin", enabled: boolean, plugins = [plugin("local-application", "application"), plugin("local-system-protocol", "protocol", "text")]) {
    useUserStore.setState({ user: { id: "local-user", username: "local", role } as never, hydrated: true, features: { ...defaultFeatureAvailability, systemPluginsVisibleToUsers: enabled } });
    usePluginStore.setState({ installations: [], hydrated: true, pluginStates: {}, runtimeStatuses: {} });
    get.mockClear();
    put.mockClear();
    get.mockImplementation(async (path) => {
        expect(path).toBe("/plugins");
        return { plugins, states: {} } as never;
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
        root.render(
            <MemoryRouter>
                <App>
                    <PluginsPage />
                </App>
            </MemoryRouter>,
        ),
    );
    return {
        host,
        close: async () => {
            expect(put).not.toHaveBeenCalled();
            await act(async () => root.unmount());
            host.remove();
        },
    };
}

function category(host: HTMLElement, label: string) {
    return Array.from(host.querySelectorAll<HTMLButtonElement>(".plugins-sidebar-item")).find((button) => button.querySelector(".plugins-sidebar-item-label")?.textContent?.trim() === label);
}

async function search(host: HTMLElement, value: string) {
    const input = host.querySelector<HTMLInputElement>('input[placeholder="搜索插件名称、描述或作者"]')!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new dom.Event("input", { bubbles: true }));
    });
}

test("ordinary user with hidden system plugins sees applications first without empty protocol groups", async () => {
    const page = await render("user", false);
    try {
        expect(page.host.querySelectorAll(".plugin-section").length).toBe(1);
        expect(page.host.querySelector(".plugin-section")?.id).toBe("plugin-section-other");
        expect(category(page.host, "文本协议")).toBeUndefined();
        expect(category(page.host, "支付协议")).toBeUndefined();
        expect(page.host.textContent).toContain("local-application");
        expect(page.host.textContent).not.toContain("local-system-protocol");
        const cards = page.host.querySelectorAll(".plugin-card").length;
        expect(Number(category(page.host, "全部插件")!.lastElementChild?.textContent)).toBe(cards);
        expect(Number(category(page.host, "应用插件")!.lastElementChild?.textContent)).toBe(cards);
    } finally {
        await page.close();
    }
});

for (const [role, enabled] of [
    ["user", true],
    ["admin", false],
] as const) {
    test(`${role}, system visibility=${enabled} retains all original sections and selected-category filtering`, async () => {
        const page = await render(role, enabled);
        try {
            expect(page.host.querySelectorAll(".plugin-section").length).toBe(6);
            expect(page.host.textContent).toContain("local-system-protocol");
            await act(async () => category(page.host, "文本协议")!.click());
            expect(page.host.querySelectorAll(".plugin-section").length).toBe(1);
            expect(page.host.querySelector(".plugin-section")?.id).toBe("plugin-section-text");
        } finally {
            await page.close();
        }
    });
}

test("backend application classification also contributes to category counts and survives search", async () => {
    const page = await render("user", false, [plugin("local-image-application", "application", "image"), plugin("local-system-protocol", "protocol", "text")]);
    try {
        expect(category(page.host, "图片协议")).toBeDefined();
        expect(category(page.host, "图片协议")!.lastElementChild?.textContent).toBe("1");
        expect(page.host.querySelector("#plugin-section-image")?.textContent).toContain("local-image-application");
        const navBefore = page.host.querySelector(".plugins-sidebar-nav")!.textContent;
        await search(page.host, "not-a-real-plugin-name");
        expect(page.host.querySelectorAll(".plugin-card").length).toBe(0);
        expect(page.host.textContent).toContain("没有匹配的插件");
        expect(page.host.querySelector(".plugins-sidebar-nav")!.textContent).toBe(navBefore);
        await search(page.host, "local-image-application");
        expect(page.host.querySelectorAll(".plugin-section").length).toBe(1);
        expect(page.host.querySelector(".plugin-section")?.id).toBe("plugin-section-image");
        expect(page.host.querySelector(".plugins-sidebar-nav")!.textContent).toBe(navBefore);
    } finally {
        await page.close();
    }
});

test("turning system visibility off resets a now-hidden selected category to all", async () => {
    const page = await render("user", true);
    try {
        await act(async () => category(page.host, "文本协议")!.click());
        expect(page.host.querySelector(".plugin-section")?.id).toBe("plugin-section-text");
        await act(async () => useUserStore.getState().setFeatures({ ...defaultFeatureAvailability, systemPluginsVisibleToUsers: false }));
        expect(category(page.host, "文本协议")).toBeUndefined();
        expect(category(page.host, "全部插件")!.getAttribute("aria-current")).toBe("page");
        expect(page.host.querySelector(".plugin-section")?.id).toBe("plugin-section-other");
        expect(page.host.textContent).toContain("local-application");
    } finally {
        await page.close();
    }
});
