import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { ComponentProps } from "react";
import type { CreationComposer } from "../../src/pages/create/creation-workspace";
import type { AssetLibraryPickerModal } from "../../src/components/assets/asset-library-picker-modal";

const dom = new Window({ url: "http://localhost/create" });
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, SVGElement: dom.SVGElement, ShadowRoot: dom.ShadowRoot, MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver, getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true, __APP_VERSION__: "test" })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter, useLocation } = await import("react-router");
const { App } = await import("antd");
const { useUserStore } = await import("../../src/stores/use-user-store");
const { useAuthDialogStore } = await import("../../src/stores/use-auth-dialog-store");
const { useCanvasStore } = await import("../../src/stores/canvas/use-canvas-store");
const { useAssetStore } = await import("../../src/stores/use-asset-store");
const { setActiveUserScope } = await import("../../src/lib/user-scope");
const { RequireAuth } = await import("../../src/components/auth/require-auth");
const { http } = await import("../../src/services/api/request");
const sync = await import("../../src/services/user-data-sync");
const conversations = await import("../../src/services/creation-conversation-store");
const get = spyOn(http, "get").mockResolvedValue({});
const post = spyOn(http, "post").mockRejectedValue(new Error("Unexpected write"));
const load = spyOn(conversations, "loadCreationConversations").mockResolvedValue([]);
const save = spyOn(conversations, "saveCreationConversations").mockResolvedValue(undefined);
const loadAssets = spyOn(sync, "loadAssetsForUse").mockResolvedValue(undefined);
const createCanvas = spyOn(sync, "createCanvasProjectWithRemoteSync").mockResolvedValue({ id: "new-canvas" });
const ready = spyOn(sync, "hasRemoteUserDataSyncSession").mockReturnValue(true);
const uploadResult = { url: "/test.png", storageKey: "resource:test-image", width: 12, height: 12, bytes: 24, mimeType: "image/png" };
const upload = mock(async () => uploadResult);
const externalUpload = mock(async () => []);
mock.module("../../src/pages/create/creation-runtime", () => ({ uploadImage: upload, uploadMediaFile: upload }));
mock.module("../../src/hooks/use-external-asset-sources", () => ({ useExternalAssetSources: () => ({ items: [], folders: [], categoryLabels: {}, uploadExternalFiles: externalUpload }) }));
let composer: ComponentProps<typeof CreationComposer>;
let picker: ComponentProps<typeof AssetLibraryPickerModal> | undefined;
mock.module("../../src/pages/create/creation-workspace", () => ({
    creationAssetCategoryLabels: {},
    CreationComposer: (props: typeof composer) => { composer = props; return <div data-composer>{props.prompt}</div>; },
    CreationEmptySuggest: () => null,
    CreationHistoryDrawer: () => null,
    CreationMessageView: () => null,
    CreationModeTabs: () => null,
    CreationWorkspaceToolbar: () => null,
}));
mock.module("../../src/components/assets/asset-library-picker-modal", () => ({ AssetLibraryPickerModal: (props: NonNullable<typeof picker>) => { picker = props; return <div data-picker />; } }));
mock.module("../../src/pages/create/creation-recent-canvases", () => ({ CreationRecentCanvases: () => null }));
mock.module("../../src/pages/inspirations", () => ({ default: () => null }));
const { default: CreatePage } = await import("../../src/pages/create");
const { CreationAgentEntry } = await import("../../src/pages/create/creation-agent-entry");
const user = (id: string) => ({ id, username: id, role: "user", status: "active" } as NonNullable<ReturnType<typeof useUserStore.getState>["user"]>);
const file = new File(["test"], "test.png", { type: "image/png" });
const files = [file] as unknown as FileList;
let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;
function Location() { const location = useLocation(); return <output data-location>{location.pathname + location.search}</output>; }
async function render(id?: string, agent = false) {
    useUserStore.setState({ user: id ? user(id) : null, hydrated: true });
    setActiveUserScope(id);
    useCanvasStore.setState({ hydrated: false, projects: [] });
    useAssetStore.setState({ assets: [], hydrated: true });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root!.render(<MemoryRouter initialEntries={["/create?draft=local"]}><App><RequireAuth allowAnonymous>{agent ? <CreationAgentEntry /> : <CreatePage />}</RequireAuth><Location /></App></MemoryRouter>));
}
async function changeSession(id?: string) {
    await act(async () => useUserStore.setState({ hydrated: false }));
    setActiveUserScope(id);
    useAssetStore.setState({ assets: [], hydrated: true });
    await act(async () => useUserStore.setState({ user: id ? user(id) : null, hydrated: true }));
}
afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined; host?.remove(); picker = undefined;
    useAuthDialogStore.setState({ request: null, guestDraft: null });
    upload.mockReset(); upload.mockImplementation(async () => uploadResult);
    externalUpload.mockClear(); post.mockClear(); createCanvas.mockClear(); loadAssets.mockClear(); get.mockClear();
});
afterAll(() => { for (const spy of [get, post, load, save, loadAssets, createCanvas, ready]) spy.mockRestore(); dom.happyDOM.abort(); });

test("游客打开素材库和替换素材只弹登录，取消后保留输入", async () => {
    await render();
    await act(async () => composer.setPrompt("未登录时写的草稿"));
    for (const operation of [() => composer.onOpenLibrary(), () => composer.onReplaceReferenceFiles("missing", [file]), () => composer.onReplaceAttachment("missing", { id: "other", kind: "image" } as never)]) {
        await act(async () => operation());
        expect(useAuthDialogStore.getState().request?.mode).toBe("login");
        expect(host.querySelector("[data-picker]")).toBeNull();
        expect(host.querySelector("[data-location]")?.textContent).toBe("/create?draft=local");
        await act(async () => useAuthDialogStore.getState().closeDialog());
        expect(composer.prompt).toBe("未登录时写的草稿");
    }
    expect(upload).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
});

test("登录只恢复本人当前页的文本，不自动上传或创建任务；再换账号不带草稿", async () => {
    await render();
    await act(async () => composer.setPrompt("游客草稿"));
    await act(async () => composer.onOpenLibrary());
    useAuthDialogStore.getState().claimGuestDraft("account-a");
    await changeSession("account-a");
    expect(composer.prompt).toBe("游客草稿"); expect(picker).toBeUndefined();
    expect(upload).not.toHaveBeenCalled(); expect(createCanvas).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
    await changeSession();
    expect(composer.prompt).toBe("");
    await changeSession("account-b");
    expect(composer.prompt).toBe(""); expect(composer.attachments).toEqual([]);
});

test("素材弹窗打开后退出登录，旧上传、选择和外部上传回调也要求登录", async () => {
    await render("account-a");
    await act(async () => composer.onOpenLibrary());
    const oldPicker = picker!; expect(oldPicker).toBeDefined();
    await changeSession();
    for (const operation of [() => oldPicker.upload!.onUpload(files), () => oldPicker.onConfirm(["test"]), () => oldPicker.upload!.external!.onUpload(files)]) {
        await act(async () => { await operation(); });
        expect(useAuthDialogStore.getState().request?.mode).toBe("login");
        useAuthDialogStore.getState().closeDialog();
    }
    await changeSession("account-b");
    await act(async () => {
        expect(await oldPicker.upload!.onUpload(files)).toEqual([]);
        await oldPicker.onConfirm(["test"]);
        expect(await oldPicker.upload!.external!.onUpload(files)).toEqual([]);
    });
    expect(composer.attachments).toEqual([]);
    expect(upload).not.toHaveBeenCalled(); expect(externalUpload).not.toHaveBeenCalled(); expect(loadAssets).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
});

test("登录用户主动上传仍可入库；延迟上传返回不能写进新账号，包括重新登录原账号", async () => {
    await render("account-a");
    await act(async () => composer.onOpenLibrary());
    let ids: string[] = [];
    await act(async () => { ids = await picker!.upload!.onUpload(files); });
    expect(ids).toHaveLength(1); expect(useAssetStore.getState().assets).toHaveLength(1);
    let finish!: (value: typeof uploadResult) => void;
    upload.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let pending!: Promise<string[]>;
    await act(async () => { pending = picker!.upload!.onUpload(files); });
    expect(finish).toBeDefined();
    await changeSession("account-b"); await changeSession("account-a");
    await act(async () => { finish(uploadResult); expect(await pending).toEqual([]); });
    expect(useAssetStore.getState().assets).toEqual([]); expect(composer.attachments).toEqual([]);
});

test("游客两个 Agent 按钮都留在原页弹登录，不受画布恢复状态阻挡", async () => {
    await render(undefined, true);
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>(".creation-agent-actions button"));
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
        expect(button.disabled).toBe(false);
        await act(async () => button.click());
        expect(useAuthDialogStore.getState().request?.mode).toBe("login");
        expect(host.querySelector("[data-location]")?.textContent).toBe("/create?draft=local");
        expect(host.querySelector("[role=alert]")).toBeNull();
        useAuthDialogStore.getState().closeDialog();
    }
    expect(createCanvas).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
});

test("已登录 Agent 仍先创建同步画布，成功后导航", async () => {
    await render("account-a", true);
    await act(async () => useCanvasStore.setState({ hydrated: true }));
    await act(async () => host.querySelector<HTMLButtonElement>(".creation-agent-actions button")!.click());
    expect(createCanvas).toHaveBeenCalledTimes(1);
    expect(host.querySelector("[data-location]")?.textContent).toBe("/canvas/new-canvas?agent=1");
    expect(useAuthDialogStore.getState().request).toBeNull(); expect(post).not.toHaveBeenCalled();
});
