import { afterAll, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { Dispatch, SetStateAction } from "react";
import type { CanvasConnection, CanvasNodeData } from "../../src/types/canvas";
import type { GenerationTask } from "../../src/services/api/task-center";

const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    localStorage: dom.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
// FFmpeg's Vite URL imports are unrelated to the remote depth task.
mock.module("../../src/lib/canvas/canvas-video-merge", () => ({
    runFFmpegTask() {
        throw new Error("not used");
    },
    mergeVideos() {
        throw new Error("not used");
    },
    loadFFmpeg() {
        throw new Error("not used");
    },
}));
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { CanvasNodeType } = await import("../../src/types/canvas");
const { createModelChannel, defaultConfig, useConfigStore } = await import("../../src/stores/use-config-store");
const { useUserStore } = await import("../../src/stores/use-user-store");
const { defaultModelCapabilityConfig, VOLCENGINE_MEDIAKIT_VIDEO_DEPTH_PROTOCOL } = await import("../../src/lib/model-capabilities");
const quotes = await import("../../src/services/api/logical-models");
const generation = await import("../../src/lib/canvas/canvas-project-generation");
const tasks = await import("../../src/services/api/task-center");
const { CanvasVideoDepthPanel } = await import("../../src/components/canvas/canvas-video-depth-panel");
const { useCanvasMediaTools } = await import("../../src/pages/canvas/use-canvas-media-tools");
const { useCanvasGenerationRetry } = await import("../../src/pages/canvas/use-canvas-generation-retry");
const { useCanvasGenerationExecutor } = await import("../../src/pages/canvas/use-canvas-generation-executor");
afterAll(() => {
    mock.restore();
    dom.happyDOM.abort();
});

const model = "depth::standard";
const config = {
    ...defaultConfig,
    channels: [
        createModelChannel({
            id: "depth",
            scope: "system",
            models: ["standard", "second"],
            modelCosts: ["standard", "second"].map((model) => ({
                model,
                displayName: model,
                capability: "video",
                protocol: VOLCENGINE_MEDIAKIT_VIDEO_DEPTH_PROTOCOL,
                capabilityConfig: defaultModelCapabilityConfig(VOLCENGINE_MEDIAKIT_VIDEO_DEPTH_PROTOCOL),
                billingMode: "per_second",
                unitPriceMicrocredits: 100,
            })),
        }),
    ],
};
const source: CanvasNodeData = {
    id: "source",
    type: CanvasNodeType.Video,
    title: "原片",
    position: { x: 0, y: 0 },
    width: 300,
    height: 200,
    metadata: { storageKey: "resource:source", content: "/source.mp4", durationMs: 18_625, naturalWidth: 1080, naturalHeight: 1920 },
};
const quote = { logicalModelId: "", billingMode: "per_second" as const, quantity: 19, amountMicrocredits: 1900, estimated: true };
const noop = () => {};

test("报价未就绪或失败禁止提交，切换模型使旧报价失效，连续点击只提交一次", async () => {
    useUserStore.setState((s) => ({ features: { ...s.features, creditsEnabled: true } }));
    const pending: Array<{ resolve: (value: { quote: typeof quote }) => void; reject: (error: Error) => void }> = [];
    const price = spyOn(quotes, "quoteModel").mockImplementation(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
    const confirm = mock();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    function Panel({ available }: { available: typeof config }) {
        const [model, setModel] = useState("");
        return <CanvasVideoDepthPanel source={source} config={available} savedModel={model} onModelChange={setModel} onClose={noop} onConfirm={confirm} />;
    }
    const render = (key: string, available = config) =>
        act(async () =>
            root.render(
                <App>
                    <Panel key={key} available={available} />
                </App>,
            ),
        );
    const button = () => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.replaceAll(" ", "").includes("开始捕捉"))!;
    try {
        await render("first");
        expect(button().disabled).toBe(true);
        await act(async () => pending[0].resolve({ quote }));
        expect(button().disabled).toBe(false);
        const second = document.querySelector<HTMLButtonElement>('[role="radio"][aria-label="second"]') || Array.from(document.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((b) => b.textContent === "second")!;
        await act(async () => second.click());
        expect(button().disabled).toBe(true);
        await act(async () => pending[1].reject(new Error("stub quote failure")));
        expect(button().disabled).toBe(true);
        expect(document.body.textContent).toContain("积分报价暂不可用");
        await render("fresh");
        await act(async () => pending[2].resolve({ quote }));
        await act(async () => {
            button().click();
            button().click();
        });
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(confirm).toHaveBeenCalledWith(model);
        await render("none", { ...config, channels: [] });
        expect(button().disabled).toBe(true);
        expect(document.body.textContent).toContain("暂无可用的深度动作捕捉模型");
    } finally {
        await act(async () => root.unmount());
        host.remove();
        price.mockRestore();
    }
});

test("点击工具仅创建草稿和连线，开始才提交且不重复建节点；失败仍按深度操作重试", async () => {
    useUserStore.setState((s) => ({ features: { ...s.features, customChannelsEnabled: true } }));
    useConfigStore.setState({ config });
    const nodesRef = { current: [structuredClone(source)] };
    const connectionsRef = { current: [] as CanvasConnection[] };
    const update =
        <T,>(ref: { current: T }): Dispatch<SetStateAction<T>> =>
        (value) => {
            ref.current = typeof value === "function" ? (value as (current: T) => T)(ref.current) : value;
        };
    const setNodes = update(nodesRef);
    const bind = mock((id: string, task: GenerationTask) => setNodes((current) => current.map((n) => (n.id === id ? { ...n, metadata: { ...n.metadata, taskId: task.id } } : n))));
    const consumed = mock(async (id: string) => setNodes((current) => current.map((n) => (n.id === id ? { ...n, metadata: { ...n.metadata, status: "success", storageKey: "resource:depth-result" } } : n))));
    const finish = mock();
    const openPanel = mock();
    let fail = true;
    const run = spyOn(generation, "runCanvasGenerationTaskToConsumer").mockImplementation(async (input, consumer) => {
        const task = { id: fail ? "failed-task" : "retry-task", status: fail ? "failed" : "succeeded" } as GenerationTask;
        consumer.bindTask(task);
        if (fail) throw new Error("stub upstream failure");
        await consumer.consumeTask(task);
        return task;
    });
    const query = spyOn(tasks, "queryGenerationTask").mockResolvedValue({ id: "failed-task", status: "failed" } as GenerationTask);
    const retryContext = spyOn(generation, "createGenerationRetryContext").mockResolvedValue({ retryOf: "failed-task", attemptGroupId: "group" });
    let tools!: ReturnType<typeof useCanvasMediaTools>, retry!: ReturnType<typeof useCanvasGenerationRetry>, generate!: ReturnType<typeof useCanvasGenerationExecutor>;
    const shared = { projectId: "canvas", nodesRef, connectionsRef, setNodes, setRunningNodeId: noop, startGenerationRequest: () => new AbortController(), finishGenerationRequest: finish, bindGenerationTask: bind, applyGenerationTaskResult: consumed };
    function Probe() {
        tools = useCanvasMediaTools({
            ...shared,
            selectedNodeIdsRef: { current: new Set() },
            setConnections: update(connectionsRef),
            setSelectedNodeIds: noop,
            setSelectedConnectionId: noop,
            setDialogNodeId: noop,
            setContextMenu: noop,
            setHoveredNodeId: noop,
            setToolbarNodeId: noop,
            startUploadStatus: mock(),
        });
        retry = useCanvasGenerationRetry({ ...shared, addedSkills: [], assets: [] });
        generate = useCanvasGenerationExecutor({ ...shared, addedSkills: [], assets: [], setConnections: update(connectionsRef), setSelectedNodeIds: noop, setSelectedConnectionId: noop, setDialogNodeId: openPanel });
        return null;
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () =>
            root.render(
                <App>
                    <Probe />
                </App>,
            ),
        );
        await act(async () => tools.createVideoDepthNode(source));
        expect(nodesRef.current[0]).toEqual(source);
        expect(nodesRef.current).toHaveLength(2);
        expect(run).not.toHaveBeenCalled();
        expect(nodesRef.current[1].metadata?.status).toBe("idle");
        const count = nodesRef.current.length;
        await act(async () => tools.processVideoNode(source, { operation: "depth", params: { model } }, "deleted-draft"));
        expect(nodesRef.current).toHaveLength(count);
        expect(run).not.toHaveBeenCalled();
        const childId = nodesRef.current[1].id;
        await act(async () => generate(childId, "video", "不得变成普通视频生成"));
        expect(openPanel).toHaveBeenCalledWith(childId);
        expect(run).not.toHaveBeenCalled();
        await act(async () => {
            await Promise.all([tools.processVideoNode(source, { operation: "depth", params: { model } }, childId), tools.processVideoNode(source, { operation: "depth", params: { model } }, childId)]);
        });
        expect(run).toHaveBeenCalledTimes(1);
        expect(nodesRef.current).toHaveLength(2);
        expect(connectionsRef.current).toHaveLength(1);
        const child = nodesRef.current[1];
        expect(child.metadata?.videoDepth).toEqual({ sourceNodeId: source.id, model });
        expect(child.metadata?.status).toBe("error");
        expect(child.metadata?.videoEnhance).toBeUndefined();
        expect(connectionsRef.current[0]).toMatchObject({ fromNodeId: source.id, toNodeId: child.id });
        expect(run.mock.calls[0][0].metadata?.videoEditOperation).toBe("depth");
        // An older saved draft retries through the canonical depth contract.
        const legacyChild = { ...child, metadata: { ...child.metadata, videoDepth: undefined, videoDepthCapture: child.metadata?.videoDepth } };
        fail = false;
        await act(async () => retry(legacyChild));
        expect(run).toHaveBeenCalledTimes(2);
        expect(run.mock.calls[1][0]).toMatchObject({ nodeId: child.id, retryOf: "failed-task", metadata: { videoEditOperation: "depth", sourceNodeId: source.id } });
        expect(nodesRef.current[1].metadata?.status).toBe("success");
        expect(consumed).toHaveBeenCalledTimes(1);
        expect(finish).toHaveBeenCalledTimes(2);
        query.mockResolvedValue({ id: "retry-task", status: "succeeded" } as GenerationTask);
        await act(async () => retry({ ...nodesRef.current[1], metadata: { ...nodesRef.current[1].metadata, status: "error" } }));
        expect(run).toHaveBeenCalledTimes(2);
        expect(consumed).toHaveBeenCalledTimes(2);
        expect(retryContext).toHaveBeenCalledTimes(1);
        query.mockRejectedValue(new Error("task status unknown"));
        await act(async () => retry(child));
        expect(run).toHaveBeenCalledTimes(2);
        query.mockResolvedValue({ id: "failed-task", status: "failed" } as GenerationTask);
        nodesRef.current = nodesRef.current.slice(1);
        await act(async () => retry(child));
        expect(run).toHaveBeenCalledTimes(2);
    } finally {
        await act(async () => root.unmount());
        host.remove();
        run.mockRestore();
        query.mockRestore();
        retryContext.mockRestore();
    }
});
