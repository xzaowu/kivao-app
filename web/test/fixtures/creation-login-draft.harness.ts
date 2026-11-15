import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/create" });
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", { configurable: true, value: dom });
const { setActiveUserScope } = await import("../../src/lib/user-scope");
const { useUserStore } = await import("../../src/stores/use-user-store");
const { useAuthDialogStore } = await import("../../src/stores/use-auth-dialog-store");
const { takeCreationLoginDraft, watchCreationLoginDraft } = await import("../../src/pages/create/creation-login-draft");
let stop: (() => void) | undefined;
const draft = { prompt: "只交接这次登录前的文字", mode: "video" as const };
const user = (id: string) => ({ id, username: id, displayName: id, role: "user" as const, status: "active" as const });

beforeEach(() => {
    dom.location.href = "http://localhost/create";
    setActiveUserScope(null);
    useUserStore.setState({ user: null, hydrated: true });
    useAuthDialogStore.getState().closeDialog();
});
afterEach(() => {
    stop?.();
    stop = undefined;
    useUserStore.getState().setUser(null);
    useAuthDialogStore.getState().closeDialog();
});
afterAll(() => {
    dom.happyDOM.abort();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
});
function open() {
    stop = watchCreationLoginDraft(() => draft);
    useAuthDialogStore.getState().openDialog("login");
}
function completeLogin(id = "account-a") {
    useUserStore.getState().setUser(user(id));
    useUserStore.getState().setHydrated(true);
    useAuthDialogStore.getState().closeDialog();
}

test("游客登录暂时卸载页面后，只向本次账号恢复一次文字和模式", () => {
    open();
    useUserStore.getState().setHydrated(false);
    stop!();
    stop = undefined;
    completeLogin();
    expect(takeCreationLoginDraft("account-a")).toEqual(draft);
    expect(takeCreationLoginDraft("account-a")).toBeUndefined();
});
test("快速登录与页面未卸载时的账号 effect 清理不会丢失交接", () => {
    open();
    completeLogin();
    stop!();
    stop = undefined;
    expect(takeCreationLoginDraft("account-a")).toEqual(draft);
});
test("取消登录后不会在稍后的账号恢复中带入旧输入", () => {
    open();
    useAuthDialogStore.getState().closeDialog();
    completeLogin();
    expect(takeCreationLoginDraft("account-a")).toBeUndefined();
});
test("取消再编辑后重新登录，交接最新文字", () => {
    let prompt = "旧文字";
    stop = watchCreationLoginDraft(() => ({ ...draft, prompt }));
    useAuthDialogStore.getState().openDialog();
    useAuthDialogStore.getState().closeDialog();
    prompt = "更新后的文字";
    useAuthDialogStore.getState().openDialog();
    completeLogin();
    expect(takeCreationLoginDraft("account-a")?.prompt).toBe(prompt);
});
test("离开创作页或登录后跳转其它页面不留下待恢复草稿", () => {
    open();
    dom.location.href = "http://localhost/assets";
    stop!();
    stop = undefined;
    completeLogin();
    dom.location.href = "http://localhost/create";
    expect(takeCreationLoginDraft("account-a")).toBeUndefined();
});
test("有明确其它登录目的地时不交接创作草稿", () => {
    stop = watchCreationLoginDraft(() => draft);
    useAuthDialogStore.getState().openDialog("login", "/canvas");
    completeLogin();
    expect(takeCreationLoginDraft("account-a")).toBeUndefined();
});
test("再次换账号与退出会清除未领取草稿", () => {
    open();
    completeLogin();
    useUserStore.getState().setUser(user("account-b"));
    expect(takeCreationLoginDraft("account-b")).toBeUndefined();
    expect(takeCreationLoginDraft("account-a")).toBeUndefined();
});
test("其它标签页切换身份不触发草稿交接", () => {
    open();
    dom.localStorage.setItem("yingce:active-user-scope", "other-user");
    dom.dispatchEvent(new dom.StorageEvent("storage", { key: "yingce:active-user-scope", newValue: "other-user" }));
    completeLogin("other-user");
    expect(takeCreationLoginDraft("other-user")).toBeUndefined();
});
test("已有账号或空草稿不会创建登录交接", () => {
    useUserStore.getState().setUser(user("account-a"));
    open();
    useUserStore.getState().setUser(user("account-b"));
    expect(takeCreationLoginDraft("account-b")).toBeUndefined();
    stop!();
    useUserStore.getState().setUser(null);
    stop = watchCreationLoginDraft(() => ({ ...draft, prompt: "   " }));
    useAuthDialogStore.getState().openDialog();
    completeLogin();
    expect(takeCreationLoginDraft("account-a")).toBeUndefined();
});
