import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { CreationInspiration } from "../../src/lib/inspirations/catalog";

const dom = new Window({ url: "http://localhost/" });
for (const key of ["document", "navigator", "HTMLElement", "HTMLBodyElement", "HTMLHtmlElement", "HTMLInputElement", "HTMLTextAreaElement", "Element", "SVGElement", "ShadowRoot", "Node", "MutationObserver", "ResizeObserver"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom[key] });
}
Object.assign(globalThis, {
    window: dom,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
});
const storage = new Map<string, string>();
mock.module("../../src/lib/localforage-storage", () => ({
    localForageStorageForScope: () => ({
        getItem: async (name: string) => storage.get(name) ?? null,
        setItem: async (name: string, value: string) => {
            storage.set(name, value);
        },
        removeItem: async (name: string) => {
            storage.delete(name);
        },
    }),
}));
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConfigProvider } = await import("antd");
const { useUserStore } = await import("../../src/stores/use-user-store");
const { normalizeDraft, useInspirationStore, INSPIRATION_STORE_KEY } = await import("../../src/stores/use-inspiration-store");
const { fillablePrompt, normalizeInspirationOverride, resolveInspirations } = await import("../../src/lib/inspirations/resolve");
const { InspirationEditorModal } = await import("../../src/pages/inspirations/inspiration-editor-modal");

const base: CreationInspiration = {
    id: "fixture:inspiration",
    sourceId: "original",
    title: "回归灵感",
    description: "原描述",
    image: "/fixture.webp",
    mode: "image",
    prompt: "Original prompt",
    promptZh: "原中文正文",
    category: "product",
    tags: ["原标签"],
    ratio: "16:9",
};
const clear = { description: "", promptZh: "", category: "", tags: [], ratio: "" };
let root: ReturnType<typeof createRoot> | undefined;
const resolved = () => resolveInspirations([base], useInspirationStore.getState());
beforeEach(async () => {
    await useInspirationStore.persist.rehydrate();
    useUserStore.setState({ hydrated: true, user: { id: "fixture-admin", username: "fixture", displayName: "Fixture", role: "admin", status: "active" } });
    useInspirationStore.getState().resetCustomizations();
});
afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined;
    document.body.innerHTML = "";
});
afterAll(() => dom.happyDOM.abort());

test("空值表示清空，省略或 undefined 字段表示保留", () => {
    expect(normalizeDraft({ ...base, ...clear })).toMatchObject(clear);
    expect(normalizeInspirationOverride({ description: undefined, promptZh: " ", tags: [] })).toEqual({ promptZh: "", tags: [] });
    useInspirationStore.getState().updateEntry(base.id!, { description: "新描述", promptZh: undefined });
    expect(resolved()[0]).toMatchObject({ ...base, description: "新描述" });
});

test("内置覆盖清空可选字段，中文正文清空后恢复使用原正文", () => {
    useInspirationStore.getState().updateEntry(base.id!, clear);
    expect(resolved()[0]).toEqual({ ...base, ...clear });
    expect(fillablePrompt(resolved()[0])).toBe(base.prompt);
    expect(base.promptZh).toBe("原中文正文");
});

test("自建灵感的清空结果在持久化回填及导入导出后保留", async () => {
    const store = useInspirationStore.getState();
    const id = store.createEntry(base);
    store.updateEntry(id, clear);
    store.updateEntry(base.id!, clear);
    const exported = store.exportPayload();
    const persisted = storage.get(INSPIRATION_STORE_KEY)!;
    store.resetCustomizations();
    storage.set(INSPIRATION_STORE_KEY, persisted);
    await useInspirationStore.persist.rehydrate();
    expect(useInspirationStore.getState().custom[0]).toMatchObject({ id, ...clear });
    expect(resolved()[1]).toMatchObject(clear);
    store.resetCustomizations();
    expect(store.importPayload(exported)).toEqual({ created: 1, updated: 0, skipped: 0 });
    expect(useInspirationStore.getState().custom[0]).toMatchObject({ id, ...clear });
    expect(resolved()[1]).toMatchObject(clear);
});

test("必填字段和身份不允许通过空值或导入覆盖破坏", () => {
    for (const key of ["title", "image", "prompt"] as const) expect(() => normalizeDraft({ ...base, [key]: " " })).toThrow();
    useInspirationStore.getState().updateEntry(base.id!, { title: "", image: " ", prompt: "" });
    expect(resolved()[0]).toEqual(base);
    useInspirationStore.getState().importPayload(JSON.stringify({ version: 1, custom: [], overrides: { [base.id!]: { title: "", image: "", prompt: "", description: "", id: "forged", sourceId: "forged" } } }));
    expect(resolved()[0]).toEqual({ ...base, description: "" });
});

test("普通用户仍不能修改灵感，但可以收藏", () => {
    useUserStore.setState({ user: { ...useUserStore.getState().user!, role: "user" } });
    const store = useInspirationStore.getState();
    expect(() => store.createEntry(base)).toThrow();
    expect(() => store.updateEntry(base.id!, clear)).toThrow();
    expect(() => store.removeEntry(base.id!)).toThrow();
    expect(() => store.importPayload(JSON.stringify({ version: 1, custom: [] }))).toThrow();
    store.toggleFavorite(base.id!);
    expect(useInspirationStore.getState().favorites).toEqual([base.id!]);
});

test("真实编辑器清空分类及其他可选字段后提交明确空值并显示本地范围", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    let submitted: unknown;
    await act(async () =>
        root!.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <InspirationEditorModal
                    open
                    item={base}
                    categoryOptions={[{ label: "商品", value: "product" }]}
                    onClose={() => {}}
                    onSubmit={(draft) => {
                        submitted = draft;
                        useInspirationStore.getState().updateEntry(base.id!, draft);
                    }}
                />
            </ConfigProvider>,
        ),
    );
    await act(async () => dom.happyDOM.waitUntilComplete());
    expect(document.body.textContent).toContain("仅保存在当前账号的此浏览器中");
    for (const id of ["description", "promptZh", "tags", "ratio"]) {
        const input = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
        expect(input).not.toBeNull();
        await act(async () => {
            const prototype = input.tagName === "TEXTAREA" ? dom.HTMLTextAreaElement.prototype : dom.HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, "");
            input.dispatchEvent(new dom.Event("input", { bubbles: true }));
        });
    }
    const category = document.getElementById("category")!.closest(".ant-select")!;
    const clearCategory = category.querySelector<HTMLElement>(".ant-select-clear")!;
    expect(clearCategory).not.toBeNull();
    await act(async () => clearCategory.dispatchEvent(new dom.MouseEvent("mousedown", { bubbles: true })));
    const save = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("保存到本地"))!;
    await act(async () => save.click());
    expect(submitted).toMatchObject(clear);
    expect(resolved()[0]).toEqual({ ...base, ...clear });
});
