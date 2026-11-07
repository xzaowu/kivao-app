import { afterAll, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MediaPreview } = await import("../../src/components/media-preview");
afterAll(() => dom.happyDOM.abort());

test("hover is opt-in, mouse-only and pauses only playback it started", async () => {
    const nativeMatchMedia = dom.matchMedia.bind(dom);
    dom.matchMedia = (query) => {
        const result = nativeMatchMedia(query);
        Object.defineProperty(result, "matches", { value: true });
        return result;
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = (hoverPreview: boolean, src = "/portrait.mp4") => act(async () => root.render(<MediaPreview src={src} kind="video" controls preserveVideoAspect hoverPreview={hoverPreview} />));
    try {
        await render(false);
        const video = host.querySelector("video")!;
        let paused = true;
        Object.defineProperty(video, "paused", { configurable: true, get: () => paused });
        const play = spyOn(video, "play").mockImplementation(async () => {
            paused = false;
        });
        const pause = spyOn(video, "pause").mockImplementation(() => {
            paused = true;
        });
        const pointer = (type: string, pointerType = "mouse") =>
            act(async () => {
                video.dispatchEvent(new dom.PointerEvent(type, { bubbles: true, pointerType }));
            });
        const metadata = (width: number, height: number) =>
            act(async () => {
                Object.defineProperty(video, "videoWidth", { configurable: true, value: width });
                Object.defineProperty(video, "videoHeight", { configurable: true, value: height });
                video.dispatchEvent(new dom.Event("loadedmetadata"));
            });
        await metadata(480, 832);
        expect(video.style.aspectRatio).toBe("480 / 832");
        await metadata(0, 0);
        expect(video.style.aspectRatio).toBe("480 / 832");
        await pointer("pointerover");
        expect(play).not.toHaveBeenCalled();
        await render(true);
        await pointer("pointerover", "touch");
        expect(play).not.toHaveBeenCalled();
        await pointer("pointerover");
        expect(play).toHaveBeenCalledTimes(1);
        expect(video.muted).toBe(true);
        await pointer("pointerout");
        expect(pause).toHaveBeenCalledTimes(1);
        expect(video.muted).toBe(false);
        await video.play();
        await pointer("pointerover");
        await pointer("pointerout");
        expect(pause).toHaveBeenCalledTimes(1);
        video.pause();
        await pointer("pointerover");
        await render(false);
        expect(paused).toBe(true);
        await render(true);
        await pointer("pointerover");
        await pointer("pointerdown");
        const pausesBeforeLeave = pause.mock.calls.length;
        await pointer("pointerout");
        expect(pause).toHaveBeenCalledTimes(pausesBeforeLeave);
        await render(false, "/landscape.mp4");
        expect(video.style.aspectRatio).toBe("");
        await metadata(1920, 1080);
        expect(video.style.aspectRatio).toBe("1920 / 1080");
        await act(async () => {
            video.dispatchEvent(new dom.Event("error"));
        });
        expect(host.querySelector("video")).toBeNull();
        expect(host.querySelector('[role="img"]')?.getAttribute("aria-label")).toContain("预览不可用");
    } finally {
        await act(async () => root.unmount());
        host.remove();
        dom.matchMedia = nativeMatchMedia;
    }
});
