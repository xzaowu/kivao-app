import { afterAll, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { GenerationTask } from "../../src/services/api/task-center";

const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { WorkbenchImageResults } = await import("../../src/pages/workbench/workbench-image-results");
const { useUserStore } = await import("../../src/stores/use-user-store");
const { http, apiClient } = await import("../../src/services/api/request");
apiClient.defaults.adapter = async () => {
    throw new Error("Real network is forbidden in the result fixture");
};
const get = spyOn(http, "get");
afterAll(() => {
    get.mockRestore();
    dom.happyDOM.abort();
});

const summary = (id: string): GenerationTask => ({ id, type: "canvas_image", status: "succeeded", prompt: "Test", attempts: 0, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:01Z", previewKind: "image", previewUrl: `/${id}-preview.png` });
const result = (id: string) => ({ ...summary(id), resultJson: JSON.stringify({ images: [{ url: `/${id}-1.png` }, { url: `/${id}-2.png` }] }) });
const owner = (id: string) => useUserStore.setState({ user: { id, username: id, displayName: id, role: "user", status: "active" } });

test("成功摘要只读一次详情；普通轮询不丢多图、不重取，完整详情无需读取", async () => {
    owner("A");
    get.mockClear();
    get.mockResolvedValue(result("task-A") as never);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<WorkbenchImageResults task={summary("task-A")} src="/preview.png" />));
        expect(get).toHaveBeenCalledTimes(1);
        expect(get.mock.calls[0][0]).toBe("/tasks/task-A");
        expect(host.querySelectorAll(".workbench-result-images img")).toHaveLength(2);
        await act(async () => root.render(<WorkbenchImageResults task={{ ...summary("task-A") }} src="/preview.png" />));
        expect(get).toHaveBeenCalledTimes(1);
        expect(host.querySelectorAll(".workbench-result-images img")).toHaveLength(2);
        await act(async () => root.render(<WorkbenchImageResults task={result("complete")} src="/complete.png" />));
        expect(get).toHaveBeenCalledTimes(1);
        expect(host.querySelectorAll(".workbench-result-images img")).toHaveLength(2);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("切任务与切账号取消旧读取，迟到结果不覆盖新画面", async () => {
    owner("A");
    get.mockClear();
    const pending: Array<{ complete: (task: GenerationTask) => void; signal: AbortSignal }> = [];
    get.mockImplementation(async (_path, options) => new Promise((resolve) => pending.push({ complete: resolve as never, signal: options!.signal! })) as never);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<WorkbenchImageResults task={summary("old-task")} src="/old-preview.png" />));
        expect(pending).toHaveLength(1);
        await act(async () => {
            owner("B");
            root.render(<WorkbenchImageResults task={summary("new-task")} src="/new-preview.png" />);
        });
        expect(pending[0].signal.aborted).toBe(true);
        expect(pending).toHaveLength(2);
        await act(async () => pending[0].complete(result("old-task")));
        expect(host.querySelector('img[src="/old-task-1.png"]')).toBeNull();
        await act(async () => pending[1].complete(result("new-task")));
        expect(host.querySelector('img[src="/new-task-2.png"]')).not.toBeNull();
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
    expect(pending[1].signal.aborted).toBe(true);
});

test("详情读取失败保留首图，只能显式重读，不创建生成任务", async () => {
    owner("A");
    get.mockClear();
    get.mockRejectedValue(new Error("Read unavailable"));
    const post = spyOn(http, "post").mockRejectedValue(new Error("Generation forbidden"));
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<WorkbenchImageResults task={summary("retry-task")} src="/preview.png" />));
        expect(get).toHaveBeenCalledTimes(1);
        expect(host.querySelector('img[src="/retry-task-preview.png"]')).not.toBeNull();
        const retry = host.querySelector<HTMLButtonElement>("button")!;
        expect(retry?.textContent).toContain("重新加载图片");
        get.mockResolvedValue(result("retry-task") as never);
        await act(async () => retry.click());
        expect(get).toHaveBeenCalledTimes(2);
        expect(host.querySelectorAll(".workbench-result-images img")).toHaveLength(2);
        expect(post).not.toHaveBeenCalled();
    } finally {
        await act(async () => root.unmount());
        host.remove();
        post.mockRestore();
    }
});
