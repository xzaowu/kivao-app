import type { CanvasNodeData } from "@/types/canvas";
import { updateCanvasNode, updateCanvasNodes } from "./canvas-node-timestamps";

type StateUpdate<T> = T | ((current: T) => T);

/** 编辑命令同步提交到 ref；React 只接收快照，不执行含副作用、可被重放的 updater。 */
export function createCanvasStateWriter<T>(
    ref: { current: T },
    publish: (snapshot: T) => void,
    normalize: (before: T, after: T) => T = (_, after) => after,
) {
    return (update: StateUpdate<T>) => {
        const before = ref.current;
        const after = normalize(before, typeof update === "function" ? (update as (current: T) => T)(before) : update);
        // 兼容先提交 ref 再发布快照的调用方；相同引用不代表 React 已收到它。
        ref.current = after;
        publish(after);
    };
}

export function createCanvasNodeContentUpdates(ref: { current: CanvasNodeData[] }, publish: (snapshot: CanvasNodeData[]) => void) {
    // 单节点更新已处理时间戳，和画布命令共用最新 ref，无需再次扫描全图。
    const write = createCanvasStateWriter(ref, publish);
    const pending = new Map<string, (node: CanvasNodeData) => CanvasNodeData>();
    let timer: ReturnType<typeof setTimeout> | undefined;

    return {
        updateNode(nodeId: string, update: (node: CanvasNodeData) => CanvasNodeData) {
            write((current) => updateCanvasNode(current, nodeId, update));
        },
        updateMediaNode(nodeId: string, update: (node: CanvasNodeData) => CanvasNodeData) {
            const previous = pending.get(nodeId);
            pending.set(nodeId, previous ? (node) => update(previous(node)) : update);
            timer ??= setTimeout(() => {
                const updates = new Map(pending);
                pending.clear();
                timer = undefined;
                write((current) => updateCanvasNodes(current, updates));
            }, 120);
        },
        cancelPendingMediaUpdates() {
            clearTimeout(timer);
            timer = undefined;
            pending.clear();
        },
    };
}
