import { isUserSessionInvalidated, subscribeUserSessionInvalidation } from "@/lib/user-scope";
import { useAuthDialogStore } from "@/stores/use-auth-dialog-store";
import { useUserStore } from "@/stores/use-user-store";
import type { CreationMode } from "./creation-types";

type LoginDraft = { prompt: string; mode: CreationMode };
type PendingDraft = { draft: LoginDraft; path: string; userId?: string; dispose: () => void };
let pending: PendingDraft | undefined;

function currentPath() {
    return window.location.pathname + window.location.search;
}

function discardDraft() {
    const previous = pending;
    pending = undefined;
    previous?.dispose();
}

function prepareDraft(draft: LoginDraft) {
    discardDraft();
    if (useUserStore.getState().user || !draft.prompt.trim() || isUserSessionInvalidated()) return;
    const handoff: PendingDraft = { draft: { ...draft }, path: currentPath(), dispose: () => {} };
    pending = handoff;
    const stopUser = useUserStore.subscribe((state, previous) => {
        if (state.user?.id === previous.user?.id) return;
        // 只绑定游客这一次登录的账号；再次换号或退出都不能带走草稿。
        if (handoff.userId || previous.user || !state.user || state.user.status !== "active") discardDraft();
        else handoff.userId = state.user.id;
    });
    const stopDialog = useAuthDialogStore.subscribe((state) => {
        if (!state.open && !handoff.userId) discardDraft();
    });
    const stopInvalidation = subscribeUserSessionInvalidation(discardDraft);
    handoff.dispose = () => {
        stopUser();
        stopDialog();
        stopInvalidation();
    };
}

/** 登录会暂时卸载页面，交接仅存在内存；关闭登录、离开页面或外部账号切换都会取消。 */
export function watchCreationLoginDraft(readDraft: () => LoginDraft) {
    const capture = () => {
        const { open, next } = useAuthDialogStore.getState();
        if (open && (!next || next === currentPath()) && !useUserStore.getState().user) prepareDraft(readDraft());
    };
    const stop = useAuthDialogStore.subscribe(capture);
    capture();
    return () => {
        stop();
        const { hydrated } = useUserStore.getState();
        if (isUserSessionInvalidated() || (pending && pending.path !== currentPath()) || (!pending?.userId && (hydrated || !useAuthDialogStore.getState().open))) discardDraft();
    };
}

export function takeCreationLoginDraft(userId: string) {
    const draft = pending;
    if (!draft) return undefined;
    discardDraft();
    if (draft.userId !== userId || useUserStore.getState().user?.id !== userId || draft.path !== currentPath() || isUserSessionInvalidated()) return undefined;
    return draft.draft;
}
