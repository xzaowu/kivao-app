export type AuthDialogMode = "login" | "register" | "forgot-password";

export type AuthFormProps = {
    nextPath?: string;
    onSuccess?: () => void;
    onBusyChange?: (busy: boolean) => void;
};

export function safeAuthNext(value: string | null | undefined): string {
    if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return "/";
    return value;
}
