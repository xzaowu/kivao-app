import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { ReactNode } from "react";
import type { VideoAsset } from "../../src/stores/use-asset-store";

const dom = new Window({ url: "http://localhost/" });
Object.assign(globalThis, { window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
let scope = "user-a";
let resolveImage: (key: string, fallback?: string) => Promise<string>;
let prepareImage: (url: string, signal: AbortSignal) => Promise<void>;
const prepared: string[] = [];
const signals: AbortSignal[] = [];
const accessCalls: string[] = [];
mock.module("@/lib/user-scope", () => ({ getActiveUserScope: () => scope }));
mock.module("@/services/api/resources", () => ({
    resourceIdFromStorageKey: (key?: string) => (key?.startsWith("resource:") ? key.slice(9) : ""),
    resolveResourceAccessURL: (url: string) => url,
    getResourceAccess: async (key: string, _purpose: string, variant: string) => {
        accessCalls.push(`${key}:${variant}`);
        return { url: `https://assets.invalid/${key}/${variant}` };
    },
}));
mock.module("@/services/image-storage", () => ({ resolveImageUrl: (key: string, fallback?: string) => resolveImage(key, fallback) }));
mock.module("@/services/canvas-image-loader", () => ({
    prepareCanvasImage: (url: string, signal: AbortSignal) => {
        prepared.push(url);
        signals.push(signal);
        return prepareImage(url, signal);
    },
}));
const { CachedResourceImage } = await import("../../src/components/cached-resource-image");
const { AssetMediaPreview } = await import("../../src/components/asset-media-preview");

class ViewportObserver {
    static instances: ViewportObserver[] = [];
    disconnected = false;
    constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {
        ViewportObserver.instances.push(this);
    }
    observe() {}
    disconnect() {
        this.disconnected = true;
    }
    enter() {
        this.callback([{ isIntersecting: true }]);
    }
}
const roots: ReturnType<typeof createRoot>[] = [];
beforeEach(() => {
    scope = "user-a";
    prepared.length = signals.length = accessCalls.length = ViewportObserver.instances.length = 0;
    resolveImage = async (_key, fallback) => fallback || "blob:resolved";
    prepareImage = async () => {};
    Object.assign(globalThis, { IntersectionObserver: ViewportObserver });
});
afterEach(async () => {
    for (const root of roots.splice(0)) await act(async () => root.unmount());
    document.body.innerHTML = "";
});
afterAll(() => dom.happyDOM.abort());

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((accept, fail) => {
        resolve = accept;
        reject = fail;
    });
    return { promise, resolve, reject };
}
async function mount(node: ReactNode) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(node));
    return {
        host,
        async update(next: ReactNode) {
            await act(async () => root.render(next));
        },
        async unmount() {
            roots.splice(roots.indexOf(root), 1);
            await act(async () => root.unmount());
        },
    };
}
const video = (id: string, coverUrl = ""): VideoAsset => ({
    id,
    kind: "video",
    title: id,
    category: "material",
    tags: [],
    coverUrl,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    data: { url: `https://assets.invalid/${id}.mp4`, width: 1080, height: 1920, bytes: 1, mimeType: "video/mp4" },
});

test("解析地址加载失败后使用真正成功的 src 回退地址", async () => {
    resolveImage = async () => "blob:expired";
    prepareImage = async (url) => {
        if (url === "blob:expired") throw new Error("expired");
    };
    const f = await mount(<CachedResourceImage storageKey="image:a" src="https://assets.invalid/fallback.jpg" alt="图片" />);
    expect(prepared).toEqual(["blob:expired", "https://assets.invalid/fallback.jpg"]);
    expect(f.host.querySelector("img")?.getAttribute("src")).toBe("https://assets.invalid/fallback.jpg");
});

test("原地址和回退地址均失败显示既有失败占位", async () => {
    resolveImage = async () => "blob:expired";
    prepareImage = async () => {
        throw new Error("unavailable");
    };
    const f = await mount(<CachedResourceImage storageKey="image:a" src="fallback.jpg" alt="图片" fallback={<span>加载失败</span>} />);
    expect(f.host.textContent).toBe("加载失败");
});

test("切换图片取消旧加载，迟到失败不额外请求回退或覆盖新图片", async () => {
    const old = deferred<void>();
    resolveImage = async (key) => (key === "image:a" ? "blob:old" : "blob:new");
    prepareImage = async (url) => (url === "blob:old" ? old.promise : undefined);
    const f = await mount(<CachedResourceImage storageKey="image:a" src="old-fallback.jpg" alt="图片" />);
    const oldSignal = signals[0];
    await f.update(<CachedResourceImage storageKey="image:b" src="new-fallback.jpg" alt="图片" />);
    expect(oldSignal.aborted).toBe(true);
    await act(async () => old.reject(new Error("cancelled")));
    expect(prepared).toEqual(["blob:old", "blob:new"]);
    expect(f.host.querySelector("img")?.getAttribute("src")).toBe("blob:new");
});

test("DOM 图片失败重试在卸载或切换账号后不会回调和加载旧地址", async () => {
    for (const action of ["unmount", "scope"] as const) {
        const pending = deferred<string>();
        let calls = 0;
        let errors = 0;
        resolveImage = async () => (++calls === 1 ? "blob:first" : pending.promise);
        const f = await mount(<CachedResourceImage storageKey="image:a" alt="图片" onError={() => errors++} />);
        await act(async () => f.host.querySelector("img")!.dispatchEvent(new dom.Event("error") as unknown as Event));
        if (action === "unmount") await f.unmount();
        else scope = "user-b";
        const before = prepared.length;
        await act(async () => pending.resolve("blob:retry"));
        expect(prepared).toHaveLength(before);
        expect(errors).toBe(0);
        scope = "user-a";
    }
});

test("远程图片切换后等待新可见性，旧观察器回调失效", async () => {
    const f = await mount(<CachedResourceImage storageKey="resource:a" alt="图片" />);
    const oldObserver = ViewportObserver.instances[0];
    await f.update(<CachedResourceImage storageKey="resource:b" alt="图片" />);
    expect(oldObserver.disconnected).toBe(true);
    await act(async () => oldObserver.enter());
    expect(accessCalls).toEqual([]);
    await act(async () => ViewportObserver.instances.at(-1)!.enter());
    expect(accessCalls).toEqual(["resource:b:original"]);
    expect(f.host.querySelector("img")?.getAttribute("src")).toContain("resource:b");
});

test("有视频封面时只加载封面，失败才回退视频首帧", async () => {
    let loaded = 0;
    const f = await mount(<AssetMediaPreview asset={video("poster", "https://assets.invalid/poster.jpg")} alt="视频" onLoad={() => loaded++} />);
    expect(f.host.querySelector("video")).toBeNull();
    expect(f.host.querySelector("img")?.getAttribute("loading")).toBe("lazy");
    expect(ViewportObserver.instances).toHaveLength(0);
    await act(async () => f.host.querySelector("img")!.dispatchEvent(new dom.Event("load") as unknown as Event));
    expect(loaded).toBe(1);
    await act(async () => f.host.querySelector("img")!.dispatchEvent(new dom.Event("error") as unknown as Event));
    expect(f.host.querySelector("video")?.getAttribute("src")).toBeNull();
    await act(async () => ViewportObserver.instances.at(-1)!.enter());
    expect(f.host.querySelector("video")?.getAttribute("src")).toBe(video("poster").data.url);
});

test("无封面视频接近视口后加载并解码首帧，保留原始比例", async () => {
    let loaded = 0;
    const f = await mount(<AssetMediaPreview asset={video("no-poster")} alt="视频" onLoad={() => loaded++} />);
    const element = f.host.querySelector("video")!;
    expect(element.getAttribute("src")).toBeNull();
    expect(element.getAttribute("preload")).toBe("none");
    expect([element.getAttribute("width"), element.getAttribute("height")]).toEqual(["1080", "1920"]);
    await act(async () => ViewportObserver.instances.at(-1)!.enter());
    expect(element.getAttribute("preload")).toBe("metadata");
    Object.defineProperty(element, "duration", { configurable: true, value: 5 });
    await act(async () => element.dispatchEvent(new dom.Event("loadedmetadata") as unknown as Event));
    expect(element.currentTime).toBe(0.001);
    await act(async () => element.dispatchEvent(new dom.Event("loadeddata") as unknown as Event));
    expect(loaded).toBe(1);
    expect(element.autoplay).toBe(false);
});

test("视频地址切换重建观察器，卸载和旧回调不会触发新素材加载", async () => {
    const f = await mount(<AssetMediaPreview asset={video("first")} alt="视频" />);
    const observer = ViewportObserver.instances[0];
    await act(async () => observer.enter());
    await f.update(<AssetMediaPreview asset={video("second")} alt="视频" />);
    expect(observer.disconnected).toBe(true);
    await act(async () => observer.enter());
    expect(f.host.querySelector("video")?.getAttribute("src")).toBeNull();
    const next = ViewportObserver.instances.at(-1)!;
    await f.unmount();
    expect(next.disconnected).toBe(true);
    await act(async () => next.enter());
    expect(f.host.querySelector("video")).toBeNull();
});

test("不支持 IntersectionObserver 的浏览器仍可加载视频首帧", async () => {
    Reflect.deleteProperty(globalThis, "IntersectionObserver");
    const f = await mount(<AssetMediaPreview asset={video("fallback")} alt="视频" />);
    expect(f.host.querySelector("video")?.getAttribute("src")).toBe(video("fallback").data.url);
});
