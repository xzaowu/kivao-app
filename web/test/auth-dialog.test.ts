import { afterEach, expect, test } from "bun:test";
import { safeAuthNext } from "../src/lib/auth-navigation";
import { useAuthDialogStore } from "../src/stores/use-auth-dialog-store";

afterEach(() => {
    useAuthDialogStore.getState().closeDialog();
    useAuthDialogStore.getState().saveGuestDraft(null);
});

test("认证后只允许返回站内地址", () => {
    for (const value of [undefined, null, "https://example.test/", "//example.test/", "/\\example.test/", "/\n/evil"]) expect(safeAuthNext(value)).toBe("/");
    expect(safeAuthNext("/toolbox/image?tool=demo#form")).toBe("/toolbox/image?tool=demo#form");
});

test("所有入口共享一个弹窗请求，可切换模式并关闭", () => {
    useAuthDialogStore.getState().openDialog();
    expect(useAuthDialogStore.getState().request?.mode).toBe("login");
    useAuthDialogStore.getState().openDialog("register", "/assets");
    expect(useAuthDialogStore.getState().request).toEqual({ mode: "register", nextPath: "/assets" });
    useAuthDialogStore.getState().closeDialog();
    expect(useAuthDialogStore.getState().request).toBeNull();
});

test("游客文本草稿仅在确认登录账号后绑定，不进入持久化存储", () => {
    const store = useAuthDialogStore.getState();
    store.saveGuestDraft({ path: "/toolbox/image", prompt: "游客草稿" });
    expect(useAuthDialogStore.getState().guestDraft?.userId).toBeUndefined();
    store.claimGuestDraft("confirmed-user");
    expect(useAuthDialogStore.getState().guestDraft).toEqual({ path: "/toolbox/image", prompt: "游客草稿", userId: "confirmed-user" });
    expect(store.readGuestDraft("/toolbox/image", "confirmed-user")?.prompt).toBe("游客草稿");
    expect(store.readGuestDraft("/toolbox/image", "other-user")).toBeNull();
    expect(store.readGuestDraft("/toolbox/video", "confirmed-user")).toBeNull();
    expect(store.readGuestDraft("/toolbox/image", null)).toBeNull();
    store.saveGuestDraft(null);
    expect(useAuthDialogStore.getState().guestDraft).toBeNull();
});
