import { create } from "zustand";
import type { AuthDialogMode } from "@/lib/auth-navigation";

type AuthDialogStore = {
    request: { mode: AuthDialogMode; nextPath?: string } | null;
    openDialog: (mode?: AuthDialogMode, nextPath?: string) => void;
    closeDialog: () => void;
    guestDraft: { path: string; prompt: string; userPrompt?: string; userId?: string } | null;
    saveGuestDraft: (draft: NonNullable<AuthDialogStore["guestDraft"]> | null) => void;
    claimGuestDraft: (userId: string) => void;
    readGuestDraft: (path: string, userId: string | null | undefined) => AuthDialogStore["guestDraft"];
};

export const useAuthDialogStore = create<AuthDialogStore>((set, get) => ({
    request: null,
    openDialog: (mode = "login", nextPath) => set({ request: { mode, nextPath } }),
    closeDialog: () => set({ request: null }),
    guestDraft: null,
    saveGuestDraft: (guestDraft) => set({ guestDraft }),
    claimGuestDraft: (userId) => {
        const draft = get().guestDraft;
        if (draft) set({ guestDraft: { ...draft, userId } });
    },
    readGuestDraft: (path, userId) => {
        const draft = get().guestDraft;
        return userId && draft?.userId === userId && draft.path === path ? draft : null;
    },
}));
