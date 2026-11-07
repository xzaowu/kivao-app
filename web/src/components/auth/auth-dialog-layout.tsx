import { lazy, Suspense, useEffect, useLayoutEffect, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate, useSearchParams } from "react-router";
import { Skeleton } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { safeAuthNext, type AuthDialogMode } from "@/lib/auth-navigation";
import { useAuthDialogStore } from "@/stores/use-auth-dialog-store";
import { useUserStore } from "@/stores/use-user-store";

const LoginForm = lazy(() => import("@/pages/auth/login"));
const RegisterForm = lazy(() => import("@/pages/auth/register"));
const RecoveryForm = lazy(() => import("@/pages/auth/forgot-password"));

export function AuthDialogEntry({ mode }: { mode: AuthDialogMode }) {
    const [params] = useSearchParams();
    const search = new URLSearchParams({ auth: mode, auth_next: safeAuthNext(params.get("next")) });
    for (const key of ["ref", "oauth_error"]) {
        const value = params.get(key);
        if (value) search.set(key, value);
    }
    return <Navigate to={`/?${search}`} replace />;
}

export function AuthDialogLayout() {
    const location = useLocation();
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const request = useAuthDialogStore((state) => state.request);
    const openDialog = useAuthDialogStore((state) => state.openDialog);
    const closeDialog = useAuthDialogStore((state) => state.closeDialog);
    const user = useUserStore((state) => state.user);
    const hydrated = useUserStore((state) => state.hydrated);
    const [busy, setBusy] = useState(false);
    const currentPath = location.pathname + location.search + location.hash;
    const next = safeAuthNext(request?.nextPath ?? currentPath);

    useLayoutEffect(() => {
        closeDialog();
        setBusy(false);
    }, [location.pathname, closeDialog]);

    // 书签、推广链接及 OAuth 错误仍可使用原地址，进入工作台后以弹窗承接。
    useEffect(() => {
        const mode = params.get("auth");
        if (!hydrated || (mode !== "login" && mode !== "register" && mode !== "forgot-password")) return;
        const target = safeAuthNext(params.get("auth_next"));
        const clean = new URLSearchParams(params);
        clean.delete("auth");
        clean.delete("auth_next");
        if (user && mode !== "forgot-password") {
            void navigate(target, { replace: true });
        } else {
            void navigate({ pathname: location.pathname, search: clean.toString(), hash: location.hash }, { replace: true });
            openDialog(mode, target);
        }
    }, [hydrated, user, params, location.pathname, location.hash, navigate, openDialog]);

    const complete = () => {
        closeDialog();
        setBusy(false);
        if (request?.nextPath && next !== currentPath) void navigate(next, { replace: true });
    };
    const mode = request?.mode;
    const changeMode = (value: AuthDialogMode) => {
        if (!busy) openDialog(value, request?.nextPath);
    };

    return (
        <>
            <Outlet />
            <AppModal
                open={Boolean(request)}
                title={mode === "forgot-password" ? "找回密码" : "登录 / 注册"}
                footer={null}
                centered
                width="min(520px, calc(100vw - 24px))"
                closable={!busy}
                keyboard={!busy}
                mask={{ closable: !busy }}
                onCancel={() => {
                    if (!busy) closeDialog();
                }}
                styles={{ body: { maxHeight: "calc(100dvh - 160px)", overflowY: "auto" } }}
            >
                {request ? (
                    <div className="space-y-5">
                        {mode !== "forgot-password" ? (
                            <SegmentedControl
                                block
                                ariaLabel="登录或注册"
                                value={mode}
                                disabled={busy}
                                options={[
                                    { value: "login", label: "登录" },
                                    { value: "register", label: "注册" },
                                ]}
                                onChange={(value) => changeMode(value as AuthDialogMode)}
                            />
                        ) : null}
                        <Suspense fallback={<Skeleton active paragraph={{ rows: 5 }} />}>
                            {mode === "login" ? (
                                <LoginForm nextPath={next} onSuccess={complete} onBusyChange={setBusy} onForgotPassword={() => changeMode("forgot-password")} />
                            ) : mode === "register" ? (
                                <RegisterForm nextPath={next} onSuccess={complete} onBusyChange={setBusy} />
                            ) : (
                                <RecoveryForm
                                    nextPath={next}
                                    onSuccess={() => {
                                        setBusy(false);
                                        openDialog("login", request.nextPath);
                                    }}
                                    onBackLogin={() => changeMode("login")}
                                    onBusyChange={setBusy}
                                />
                            )}
                        </Suspense>
                    </div>
                ) : null}
            </AppModal>
        </>
    );
}
