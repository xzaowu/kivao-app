import { useEffect, type ReactNode } from "react";
import { useLocation } from "react-router";
import { Button } from "antd";
import { useAuthDialogStore } from "@/stores/use-auth-dialog-store";

import { FullScreenLoader } from "@/components/ui/aceternity/full-screen-loader";
import { useUserStore } from "@/stores/use-user-store";

export function RequireAuth({ children, allowAnonymous = false }: { children: ReactNode; allowAnonymous?: boolean }) {
    const location = useLocation();
    const hydrated = useUserStore((state) => state.hydrated);
    const user = useUserStore((state) => state.user);
    const needsLogin = hydrated && !user && !allowAnonymous;

    useEffect(() => {
        if (needsLogin) useAuthDialogStore.getState().openDialog();
    }, [needsLogin, location.pathname, location.search]);

    if (!hydrated) return <FullScreenLoader />;
    if (needsLogin)
        return (
            <div className="grid min-h-64 place-content-center gap-4 p-6 text-center">
                <p>登录后查看此页面</p>
                <Button onClick={() => useAuthDialogStore.getState().openDialog()}>登录 / 注册</Button>
            </div>
        );
    return children;
}
