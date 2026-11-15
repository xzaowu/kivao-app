import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { SetStateAction } from "react";
import { captureUserSession, type UserSessionSnapshot } from "@/lib/user-scope";
import { canvasNodeMentionToken, replaceCanvasMentionToken } from "@/lib/canvas/canvas-resource-references";
import { useUserStore } from "@/stores/use-user-store";
import type { WorkbenchKind, WorkbenchPromptPreset, WorkbenchTool } from "@/services/api/workbench";
import type { WorkbenchReference } from "./workbench-composer";

export type WorkbenchDraft = {
    prompt: string;
    tool: WorkbenchTool | null;
    preset: WorkbenchPromptPreset | null;
    references: WorkbenchReference[];
    settingsReady: boolean;
    ratio: string;
    quality: string;
    imageResolution: string;
    count: number;
    seconds: string;
    videoQuality: string;
};

export function withoutRemovedWorkbenchMentions(prompt: string, removed: WorkbenchReference[]) {
    return removed.reduce((value, reference) => replaceCanvasMentionToken(value, canvasNodeMentionToken(reference.id), ""), prompt);
}

export function hasMissingWorkbenchMentions(prompt: string, references: WorkbenchReference[]) {
    const ids = new Set(references.map((item) => item.id));
    return [...prompt.matchAll(/@\[node:([^\]]+)\]/gu)].some((match) => !ids.has(match[1]));
}

function initialDraft(kind: WorkbenchKind): WorkbenchDraft {
    return { prompt: "", tool: null, preset: null, references: [], settingsReady: false, ratio: kind === "image" ? "1:1" : "16:9", quality: "auto", imageResolution: "auto", count: 1, seconds: "6", videoQuality: "720" };
}

function createDraft(kind: WorkbenchKind, session: UserSessionSnapshot) {
    const store = createStore<WorkbenchDraft>(() => initialDraft(kind));
    const setField = <K extends keyof WorkbenchDraft>(key: K, value: SetStateAction<WorkbenchDraft[K]>) => {
        if (session.signal.aborted) return;
        const current = captureUserSession(true);
        if (current.version !== session.version || current.scope !== session.scope || current.signal.aborted) return;
        store.setState((draft) => ({ [key]: typeof value === "function" ? (value as (previous: WorkbenchDraft[K]) => WorkbenchDraft[K])(draft[key]) : value }) as Pick<WorkbenchDraft, K>);
    };
    return { store, setField };
}

// 仅保留当前标签页的两份草稿，不写浏览器持久存储。上传回调与重新打开的页面共享同一对象。
let activeSession: UserSessionSnapshot | undefined;
const drafts = new Map<WorkbenchKind, ReturnType<typeof createDraft>>();
export function getWorkbenchDraft(kind: WorkbenchKind) {
    const session = captureUserSession(true);
    if (!activeSession || activeSession.version !== session.version || activeSession.scope !== session.scope) {
        drafts.clear();
        activeSession = session;
        session.signal.addEventListener(
            "abort",
            () => {
                for (const { store } of drafts.values()) {
                    for (const reference of store.getState().references) if (reference.previewUrl.startsWith("blob:")) URL.revokeObjectURL(reference.previewUrl);
                }
                drafts.clear();
            },
            { once: true },
        );
    }
    let draft = drafts.get(kind);
    if (!draft) {
        draft = createDraft(kind, session);
        drafts.set(kind, draft);
    }
    return draft;
}

export function useWorkbenchDraft(kind: WorkbenchKind) {
    useUserStore((state) => state.user?.id);
    const entry = getWorkbenchDraft(kind);
    return { draft: useStore(entry.store), ...entry };
}
