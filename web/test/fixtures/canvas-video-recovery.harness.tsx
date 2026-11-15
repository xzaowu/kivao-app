import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { ComponentProps } from "react";
import type { VideoPlayer } from "../../src/components/video-player";
import type { CanvasNodeContentProps } from "../../src/components/canvas/canvas-node-content";

const dom = new Window({ url: "http://localhost/" });
for (const key of ["document", "navigator", "HTMLElement", "Element", "Node", "SVGElement", "ShadowRoot", "MutationObserver", "ResizeObserver", "IntersectionObserver"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom[key] });
}
Object.assign(globalThis, { window: dom, getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true });
type PlayerProps = ComponentProps<typeof VideoPlayer>;
let playerProps: PlayerProps | null = null;
mock.module("../../src/components/video-player", () => ({
    VideoPlayer(props: PlayerProps) {
        playerProps = props;
        return <video data-testid="player" src={props.src} data-autoplay={String(props.autoPlay)} />;
    },
}));
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const resources = await import("../../src/services/api/resources");
const files = await import("../../src/services/file-storage");
const { canvasThemes } = await import("../../src/lib/canvas-theme");
const { CanvasNodeType } = await import("../../src/types/canvas");
const { VideoNodeContent } = await import("../../src/components/canvas/canvas-node-media-content");
let root: ReturnType<typeof createRoot> | null = null;
const node: CanvasNodeContentProps["node"] = {
    id: "video",
    type: CanvasNodeType.Video,
    title: "测试视频",
    position: { x: 0, y: 0 },
    width: 320,
    height: 180,
    metadata: { storageKey: "resource:video", content: "/original.mp4", previewUrl: "/preview.png", naturalWidth: 320, naturalHeight: 180 },
};
const baseProps: CanvasNodeContentProps = {
    node,
    theme: canvasThemes.dark,
    isEditingContent: false,
    textareaRef: { current: null },
    isBatchRoot: false,
    batchCount: 1,
    batchExpanded: false,
    batchOpening: false,
    batchRecovering: false,
    onContentChange() {},
    onStopEditing() {},
    mentionReferences: [],
};

async function mount() {
    spyOn(files, "resolveVideoMediaUrl").mockResolvedValue("/original.mp4");
    spyOn(resources, "getResourceAccess").mockResolvedValue({ actualVariant: "playback", url: "/renewed.mp4" } as Awaited<ReturnType<typeof resources.getResourceAccess>>);
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const render = async (mediaActive = true, current = node) => act(async () => root!.render(<VideoNodeContent {...baseProps} node={current} mediaActive={mediaActive} />));
    await render();
    expect(playerProps?.autoPlay).toBe(true);
    return render;
}

async function recover() {
    let resolve!: (value: Awaited<ReturnType<typeof resources.refreshResource>>) => void;
    spyOn(resources, "refreshResource").mockImplementation(() => new Promise((done) => (resolve = done)));
    await act(async () => playerProps!.onError?.({} as never, {} as never));
    expect(document.querySelector('[data-testid="player"]')).toBeNull();
    await act(async () => resolve({ status: "ready", playbackStatus: "ready", provider: "local" } as Awaited<ReturnType<typeof resources.refreshResource>>));
    expect(playerProps!.src).toContain("renewed.mp4");
}

async function pause(requested: boolean) {
    await act(async () => playerProps!.onPause?.({ triggers: { hasType: (type: string) => requested && type === "media-pause-request" } } as never));
}

afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = null;
    playerProps = null;
    document.body.innerHTML = "";
    mock.restore();
});
afterAll(() => dom.happyDOM.abort());

test("用户暂停后地址恢复仍暂停，取消选择再选中恢复自动播放", async () => {
    const render = await mount();
    await pause(true);
    await recover();
    expect(playerProps!.autoPlay).toBe(false);
    await render(false);
    await render(true);
    expect(playerProps!.autoPlay).toBe(true);
});

test("故障或卸载产生的暂停不阻止原本正在播放的视频恢复", async () => {
    await mount();
    await pause(false);
    await recover();
    expect(playerProps!.autoPlay).toBe(true);
});

test("暂停后主动播放清除暂停意图，下一次地址恢复仍自动播放", async () => {
    await mount();
    await pause(true);
    await act(async () => playerProps!.onPlay?.({} as never));
    await recover();
    expect(playerProps!.autoPlay).toBe(true);
});

test("更换视频资源不继承原视频的暂停意图", async () => {
    const render = await mount();
    await pause(true);
    await render(true, { ...node, metadata: { ...node.metadata, storageKey: "resource:other" } });
    expect(playerProps!.autoPlay).toBe(true);
    await render(true);
    expect(playerProps!.autoPlay).toBe(true);
});
