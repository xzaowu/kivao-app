import { afterAll, afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { normalizePublicAppearance, useAppearanceStore } from "../src/stores/use-appearance-store";
import { useUserStore, type LocalUser } from "../src/stores/use-user-store";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, Node: dom.Node, IS_REACT_ACT_ENVIRONMENT: true, __APP_VERSION__: "1.7.3.3" })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AppChangelogButton } = await import("../src/components/layout/app-changelog-modal");

const originalAppearance = useAppearanceStore.getState();
const originalUser = useUserStore.getState();
afterEach(() => {
    useAppearanceStore.setState(originalAppearance);
    useUserStore.setState(originalUser);
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function render(technical = false) {
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
        await act(async () => root.render(<AppChangelogButton technical={technical} showLabel showVersion />));
        return host.innerHTML;
    } finally {
        await act(async () => root.unmount());
    }
}

function actor(role: "admin" | "user" | null, hydrated = true) {
    useUserStore.setState({ hydrated, user: role ? ({ id: "local-test", username: "local-test", displayName: "测试账号", role, status: "active" } as LocalUser) : null });
}

test("technical entry fails closed for visitors, ordinary users and unresolved sessions", async () => {
    for (const role of [null, "user"] as const) {
        actor(role);
        expect(await render(true)).toBe("");
    }
    actor("admin", false);
    expect(await render(true)).toBe("");
});

test("technical entry disappears when the mounted administrator session changes", async () => {
    actor("admin");
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
        await act(async () => root.render(<AppChangelogButton technical showLabel />));
        expect(host.textContent).toContain("技术更新记录");
        await act(async () => actor("user"));
        expect(host.innerHTML).toBe("");
        await act(async () => actor(null));
        expect(host.innerHTML).toBe("");
    } finally {
        await act(async () => root.unmount());
    }
});

test("administrator technical record uses the source version even with a custom product version", async () => {
    actor("admin");
    useAppearanceStore.setState({ appearance: normalizePublicAppearance({ updates: { enabled: true, currentVersion: "工作室公告版本", releases: [] } }) });
    const html = await render(true);
    expect(html).toContain("技术更新记录");
    expect(html).toContain("v1.7.3.3");
    expect(html).not.toContain("工作室公告版本");
});

test("product entry never exposes the internal version when announcements are disabled", async () => {
    actor("user");
    useAppearanceStore.setState({ appearance: normalizePublicAppearance({ updates: { enabled: false, currentVersion: "隐藏草稿", releases: [] } }) });
    const html = await render();
    expect(html).toContain("更新公告");
    expect(html).not.toContain("更新日志");
    expect(html).not.toContain("1.7.3.3");
    expect(html).not.toContain("隐藏草稿");
});

test("product entry preserves the published custom version for either role", async () => {
    useAppearanceStore.setState({ appearance: normalizePublicAppearance({ updates: { enabled: true, currentVersion: "KIVAO 公告", releases: [] } }) });
    for (const role of ["user", "admin"] as const) {
        actor(role);
        const html = await render();
        expect(html).toContain("KIVAO 公告");
        expect(html).not.toContain("技术更新记录");
    }
});
