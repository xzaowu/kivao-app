import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { InspirationFeed } from "../../src/services/api/inspiration-feed";
import type { InspirationCatalog } from "../../src/services/inspiration-catalog";
import type { CreationInspiration } from "../../src/lib/inspirations/catalog";

const dom = new Window({ url: "http://localhost/" });
for (const key of ["document", "navigator", "HTMLElement", "HTMLMediaElement", "Element", "SVGElement", "Node", "MutationObserver"] as const) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom[key] });
Object.assign(globalThis, { window: dom, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
let desktop = true;
const mediaListeners = new Set<() => void>();
Object.defineProperty(window, "matchMedia", {
    value: () => ({
        get matches() {
            return desktop;
        },
        addEventListener: (_: string, callback: () => void) => mediaListeners.add(callback),
        removeEventListener: (_: string, callback: () => void) => mediaListeners.delete(callback),
    }),
});
const play = mock(async () => undefined);
const pause = mock(() => undefined);
const load = mock(() => undefined);
Object.defineProperties(dom.HTMLMediaElement.prototype, { play: { value: play }, pause: { value: pause }, load: { value: load } });

let feedRequest: (signal?: AbortSignal) => Promise<InspirationFeed> = async () => ({ enabled: false, entries: [], categories: {} });
mock.module("../../src/services/api/inspiration-feed", () => ({ getPublicInspirationFeed: (signal?: AbortSignal) => feedRequest(signal) }));
mock.module("../../src/services/api/request", () => ({ apiBaseURL: "/api" }));
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { loadInspirationCatalog, subscribeInspirationCatalog, invalidateInspirationCatalog } = await import("../../src/services/inspiration-catalog");
const { inspirationCoverURL } = await import("../../src/services/api/inspiration-covers");
const { InspirationExampleMedia, InspirationImage } = await import("../../src/pages/inspirations/inspiration-example-media");
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
let now = 1_000_000;
let root: ReturnType<typeof createRoot> | undefined;
let unsubscribe: (() => void) | undefined;
const fixture = (sourceId: "seedance" | "youmind" | "haohaoxue", title = sourceId): CreationInspiration => ({
    id: `${sourceId}:sample`,
    sourceId,
    title,
    description: "",
    image: "https://media.example.com/cover.jpg",
    mode: "video",
    videoUrl: "https://media.example.com/old.mp4",
    prompt: "完整提示词",
    category: "sample",
});
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const defaultFetch = mock(async (input: string | URL | Request) => {
    const path = String(input);
    if (path.endsWith("manifest.json")) return response({ sources: {} });
    const source = path.split("/").pop()!.replace(".json", "") as "seedance";
    return response({ entries: [fixture(source)] });
});
beforeEach(() => {
    desktop = true;
    play.mockClear();
    pause.mockClear();
    load.mockClear();
    defaultFetch.mockClear();
    invalidateInspirationCatalog();
    now = 1_000_000;
    Date.now = () => now;
    globalThis.fetch = defaultFetch as typeof fetch;
    feedRequest = async () => ({ enabled: false, entries: [], categories: {} });
});
afterEach(async () => {
    unsubscribe?.();
    unsubscribe = undefined;
    invalidateInspirationCatalog();
    if (root) await act(async () => root!.unmount());
    root = undefined;
    document.body.innerHTML = "";
    Date.now = originalNow;
});
afterAll(() => {
    globalThis.fetch = originalFetch;
    void dom.happyDOM.abort();
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
const flush = async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
};

test("慢来源和 feed 不阻止先显示已到达目录，最终完整合并且不改写静态缓存", async () => {
    const slow = deferred<Response>();
    const delayedFeed = deferred<InspirationFeed>();
    feedRequest = () => delayedFeed.promise;
    globalThis.fetch = mock((input: string | URL | Request) => (String(input).includes("seedance.json") ? slow.promise : defaultFetch(input))) as typeof fetch;
    const snapshots: InspirationCatalog[] = [];
    unsubscribe = subscribeInspirationCatalog((catalog) => snapshots.push(catalog));
    let complete = false;
    const final = loadInspirationCatalog().then((catalog) => {
        complete = true;
        return catalog;
    });
    await flush();
    expect(complete).toBe(false);
    expect(snapshots.at(-1)!.entries.some((entry) => entry.id === "youmind:sample")).toBe(true);
    expect(snapshots.at(-1)!.pendingSources).toContain("seedance");
    slow.resolve(response({ entries: [fixture("seedance")] }));
    delayedFeed.resolve({ enabled: true, categories: {}, entries: [{ ...fixture("seedance"), id: "seedance:sample", sourceId: "seedance", videoUrl: "https://media.example.com/new.mp4", addedAt: "2026-11-16" }] });
    const result = await final;
    expect(result.entries.filter((entry) => entry.id === "seedance:sample")).toHaveLength(1);
    expect(result.entries.find((entry) => entry.id === "seedance:sample")!.videoUrl).toEndWith("new.mp4");
    expect(result.pendingSources).toEqual([]);
    now += 5 * 60_000 + 1;
    feedRequest = async () => ({ enabled: false, categories: {}, entries: [] });
    expect((await loadInspirationCatalog()).entries.find((entry) => entry.id === "seedance:sample")!.videoUrl).toEndWith("old.mp4");
});

test("单个静态来源失败时保留已加载内容，重试不重复下载成功目录", async () => {
    let fails = true;
    const calls: string[] = [];
    globalThis.fetch = mock(async (input: string | URL | Request) => {
        const path = String(input);
        calls.push(path);
        return fails && path.includes("seedance.json") ? response({}, 503) : defaultFetch(input);
    }) as typeof fetch;
    let current!: InspirationCatalog;
    unsubscribe = subscribeInspirationCatalog((catalog) => {
        current = catalog;
    });
    await expect(loadInspirationCatalog()).rejects.toThrow("部分灵感");
    expect(current.entries.some((entry) => entry.id === "youmind:sample")).toBe(true);
    expect(current.failedSources).toEqual(["seedance"]);
    fails = false;
    const result = await loadInspirationCatalog();
    expect(result.failedSources).toEqual([]);
    expect(calls.filter((path) => path.includes("youmind.json"))).toHaveLength(1);
    expect(calls.filter((path) => path.includes("seedance.json"))).toHaveLength(2);
});

test("短期复用上新，过期刷新而不重下静态目录，刷新失败保留已成功的上新", async () => {
    const feedCalls = mock(async () => ({ enabled: true, entries: [{ ...fixture("youmind"), id: "youmind:new", sourceId: "youmind", addedAt: "2026-11-16" }], categories: {} }));
    feedRequest = feedCalls;
    await loadInspirationCatalog();
    await loadInspirationCatalog();
    expect(feedCalls).toHaveBeenCalledTimes(1);
    expect(defaultFetch).toHaveBeenCalledTimes(4);
    now += 5 * 60_000 + 1;
    feedRequest = async () => {
        throw new Error("offline");
    };
    const result = await loadInspirationCatalog();
    expect(result.entries.some((entry) => entry.id === "youmind:new")).toBe(true);
    expect(result.failedSources).toEqual(["feed"]);
    expect(defaultFetch).toHaveBeenCalledTimes(4);
});

test("管理员失效缓存后旧的延迟响应不能覆盖新目录", async () => {
    const oldFeed = deferred<InspirationFeed>();
    feedRequest = () => oldFeed.promise;
    const oldLoad = loadInspirationCatalog().catch((error: Error) => error.message);
    await flush();
    invalidateInspirationCatalog();
    feedRequest = async () => ({ enabled: false, entries: [], categories: {} });
    await loadInspirationCatalog();
    oldFeed.resolve({ enabled: true, entries: [{ ...fixture("youmind"), id: "youmind:stale", sourceId: "youmind", addedAt: "2026-11-16" }], categories: {} });
    expect(await oldLoad).toContain("已刷新");
    expect((await loadInspirationCatalog()).entries.some((entry) => entry.id === "youmind:stale")).toBe(false);
});

test("服务器缓存只用于已知目录的原封面，本地图片与个人覆盖保持原地址", () => {
    const item = fixture("seedance");
    expect(inspirationCoverURL(item, item.image)).toBe("/api/public/inspirations/covers/seedance%3Asample");
    expect(inspirationCoverURL({ ...item, image: "/local.webp" }, "/local.webp")).toBe("/local.webp");
    expect(inspirationCoverURL({ ...item, image: "https://custom.example.com/image.jpg" }, item.image)).toBe("https://custom.example.com/image.jpg");
    expect(inspirationCoverURL({ ...item, sourceId: "original" }, item.image)).toBe(item.image);
});

const videoExample = { id: "video:sample", type: "video" as const, title: "视频示例", description: "", posterUrl: "https://media.example.com/poster.jpg", mediaUrl: "https://media.example.com/video.mp4" };
async function renderMedia(preview = false, controls = false) {
    if (!root) {
        const host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
    }
    await act(async () => root!.render(<InspirationExampleMedia example={videoExample} preview={preview} controls={controls} coverURL={controls ? undefined : "/api/public/inspirations/covers/sample"} priority />));
}
async function emit(element: Element, name: string) {
    await act(async () => element.dispatchEvent(new dom.Event(name)));
}

test("卡片先显示优先封面，不提前请求视频；桌面悬停后仍等到 playing 才显示视频", async () => {
    await renderMedia();
    const video = document.querySelector("video")!;
    expect(video.getAttribute("src")).toBeNull();
    expect(video.getAttribute("preload")).toBe("none");
    expect(document.querySelector("img")!.getAttribute("loading")).toBe("eager");
    expect(play).not.toHaveBeenCalled();
    await renderMedia(true);
    expect(video.getAttribute("src")).toBe(videoExample.mediaUrl);
    expect(document.querySelector(".is-playing")).toBeNull();
    await emit(video, "playing");
    expect(document.querySelector(".is-playing")).not.toBeNull();
    await renderMedia(false);
    expect(document.querySelector(".is-playing")).toBeNull();
    const paused = pause.mock.calls.length;
    await emit(video, "playing");
    expect(pause.mock.calls.length).toBeGreaterThan(paused);
    expect(document.querySelector(".is-playing")).toBeNull();
});

test("手机不下载列表视频，桌面切换到窄屏也暂停并释放视频地址", async () => {
    desktop = false;
    await renderMedia(true);
    expect(document.querySelector("video")!.getAttribute("src")).toBeNull();
    expect(play).not.toHaveBeenCalled();
    desktop = true;
    await renderMedia(false);
    await renderMedia(true);
    expect(document.querySelector("video")!.getAttribute("src")).toBe(videoExample.mediaUrl);
    desktop = false;
    await act(async () => {
        for (const listener of mediaListeners) listener();
    });
    expect(document.querySelector("video")!.getAttribute("src")).toBeNull();
});

test("封面缓存失败仅回退原封面一次，双重失败不形成请求循环", async () => {
    await renderMedia();
    let image = document.querySelector("img")!;
    expect(image.getAttribute("src")).toStartWith("/api/public/");
    await emit(image, "error");
    image = document.querySelector("img")!;
    expect(image.getAttribute("src")).toBe(videoExample.posterUrl);
    await emit(image, "error");
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("video")!.getAttribute("src")).toBeNull();
});

test("视频失败保留封面，每次悬停最多重试一次且离开后可以再次尝试", async () => {
    await renderMedia(true);
    const video = document.querySelector("video")!;
    await emit(video, "error");
    expect(load).toHaveBeenCalledTimes(1);
    await emit(video, "error");
    expect(load).toHaveBeenCalledTimes(1);
    expect(document.querySelector("img")).not.toBeNull();
    expect(document.querySelector(".is-playing")).toBeNull();
    await renderMedia(false);
    await renderMedia(true);
    expect(load).toHaveBeenCalledTimes(2);
});

test("详情使用原视频与原封面，失败能由用户重试", async () => {
    await renderMedia(false, true);
    const video = document.querySelector("video")!;
    expect(video.getAttribute("src")).toBe(videoExample.mediaUrl);
    expect(video.getAttribute("poster")).toBe(videoExample.posterUrl);
    await emit(video, "error");
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => (document.querySelector("button") as HTMLButtonElement).click());
    expect(load).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="alert"]')).toBeNull();
});

test("更换图片来源后重置失败状态，新封面正常显示", async () => {
    await renderMedia();
    await act(async () => root!.render(<InspirationImage src="/cache/a" fallbackSrc="/original/a" />));
    await emit(document.querySelector("img")!, "error");
    await emit(document.querySelector("img")!, "error");
    await act(async () => root!.render(<InspirationImage src="/cache/b" fallbackSrc="/original/b" />));
    expect(document.querySelector("img")!.getAttribute("src")).toBe("/cache/b");
});
