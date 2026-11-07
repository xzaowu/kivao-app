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
    MutationObserver: dom.MutationObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
    __APP_VERSION__: "test",
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { InspirationMedia, InspirationHall } = await import("../../src/pages/inspirations");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { MemoryRouter } = await import("react-router");
const { http } = await import("../../src/services/api/request");
afterAll(() => dom.happyDOM.abort());

test("metadata reload preserves portrait ratio; a new source gets its own ratio", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = (src: string) => act(async () => root.render(<InspirationMedia item={{ mediaKind: "video", mediaUrl: src }} />));
    const metadata = async (width: number, height: number) => {
        const video = host.querySelector("video")!;
        Object.defineProperty(video, "videoWidth", { configurable: true, value: width });
        Object.defineProperty(video, "videoHeight", { configurable: true, value: height });
        await act(async () => {
            video.dispatchEvent(new dom.Event("loadedmetadata"));
        });
        return video;
    };
    try {
        await render("/portrait.mp4");
        const video = await metadata(480, 832);
        expect(video.style.aspectRatio).toBe("480 / 832");
        expect(video.classList.contains("size-full")).toBe(false);
        await metadata(0, 0);
        expect(video.style.aspectRatio).toBe("480 / 832");
        await render("/landscape.mp4");
        expect(video.style.aspectRatio).toBe("");
        await metadata(1920, 1080);
        expect(video.style.aspectRatio).toBe("1920 / 1080");
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("hover defaults on even with reduced motion; touch stays still and switching off pauses", async () => {
    const nativeMatchMedia = dom.matchMedia.bind(dom);
    dom.matchMedia = (query) => {
        const result = nativeMatchMedia(query);
        Object.defineProperty(result, "matches", { value: query.includes("prefers-reduced-motion") || query.includes("any-hover") || query.includes("any-pointer") });
        return result;
    };
    const get = spyOn(http, "get").mockResolvedValue({ items: [{ id: "video", type: "prompt", title: "视频", mode: "video", category: "", prompt: "", sortOrder: 0, mediaKind: "video", mediaUrl: "/video.mp4" }] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => {
            root.render(
                <MemoryRouter>
                    <QueryClientProvider client={queryClient}>
                        <InspirationHall onUse={() => {}} />
                    </QueryClientProvider>
                </MemoryRouter>,
            );
        });
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        const video = host.querySelector("video")!;
        const card = host.querySelector(".inspiration-card-open")!;
        const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]')!;
        const play = spyOn(video, "play").mockResolvedValue();
        const pause = spyOn(video, "pause").mockImplementation(() => {});
        const hover = () =>
            act(async () => {
                card.dispatchEvent(new dom.PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
            });
        expect(toggle.getAttribute("aria-checked")).toBe("true");
        expect(play).not.toHaveBeenCalled();
        await act(async () => {
            card.dispatchEvent(new dom.PointerEvent("pointerover", { bubbles: true, pointerType: "touch" }));
        });
        expect(play).not.toHaveBeenCalled();
        await hover();
        expect(play).toHaveBeenCalledTimes(1);
        await act(async () => {
            toggle.click();
        });
        expect(toggle.getAttribute("aria-checked")).toBe("false");
        expect(pause).toHaveBeenCalled();
        await hover();
        expect(play).toHaveBeenCalledTimes(1);
    } finally {
        await act(async () => root.unmount());
        host.remove();
        queryClient.clear();
        get.mockRestore();
        dom.matchMedia = nativeMatchMedia;
    }
});
