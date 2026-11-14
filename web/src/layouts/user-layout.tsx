import { lazy, Suspense, useLayoutEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router";
import { ConfigProvider } from "antd";

import { AppWorkspaceShell } from "@/components/layout/app-top-nav";
import { useAgentPanelDock } from "@/components/canvas/use-agent-panel-dock";
import { cn } from "@/lib/utils";
import { isSpatialWorkbenchPath } from "@/lib/workspace-routes";
import { getWorkspaceAntThemeConfig } from "@/lib/app-theme";
import { useGlobalAgentStore } from "@/stores/use-global-agent-store";
import { useUserStore } from "@/stores/use-user-store";
import "@/styles/workspace-product.css";
import "@/styles/workspace-menus.css";

const workspaceTheme = getWorkspaceAntThemeConfig();
const inheritedAgentTheme = { inherit: true };
// 平台唯一的 Agent 面板按需加载，不拖慢首屏；画布编辑器只发布画布上下文，不再自己渲染面板。
const GlobalAgentPanel = lazy(() => import("@/components/canvas/canvas-cloud-agent-panel").then((module) => ({ default: module.CanvasCloudAgentPanel })));

export default function UserLayout({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const adminWorkspace = pathname === "/admin" || pathname.startsWith("/admin/");
    const spatialWorkbench = isSpatialWorkbenchPath(pathname);
    const canvasEditor = /^\/canvas\/[^/]+(?:\/|$)/.test(pathname);
    const productWorkspace = !adminWorkspace && !canvasEditor;
    const userId = useUserStore((state) => state.user?.id);
    // Agent 停靠在画布右侧时，工作区让出同样的宽度，画布、顶栏和角落控件都不被遮挡。
    const agentDock = useAgentPanelDock();
    const agentDocked = Boolean(userId) && canvasEditor && agentDock.active;
    const creationWorkspace = pathname === "/" || pathname === "/create";
    const wasCanvasEditorRef = useRef(canvasEditor);
    // 从画布编辑器回到创作首页时收起 Agent：画布里停靠在右侧的面板到首页会变成浮窗，挡住首页。
    // 只收起面板，对话和运行照常继续；在绘制前收起，首页不会先闪出浮窗。
    useLayoutEffect(() => {
        const leftCanvasEditor = wasCanvasEditorRef.current && !canvasEditor;
        wasCanvasEditorRef.current = canvasEditor;
        if (leftCanvasEditor && creationWorkspace) useGlobalAgentStore.getState().closeAgent();
    }, [canvasEditor, creationWorkspace]);

    useLayoutEffect(() => {
        // Ant Design 浮层挂载在 body，必须用路由级标记隔离用户工作台与画布编辑器、运营后台。
        document.body.classList.toggle("app-user-overlays", !adminWorkspace);
        document.body.classList.toggle("app-spatial-overlays", spatialWorkbench);
        document.body.classList.toggle("app-product-overlays", productWorkspace);
        return () => {
            document.body.classList.remove("app-user-overlays");
            document.body.classList.remove("app-spatial-overlays");
            document.body.classList.remove("app-product-overlays");
        };
    }, [adminWorkspace, spatialWorkbench, productWorkspace]);

    const controlOverrides = {
        select: productWorkspace ? { classNames: { popup: { root: "workspace-quiet-popup" } } } : undefined,
        dropdown: productWorkspace ? { classNames: { root: "workspace-quiet-popup" } } : undefined,
        popover: productWorkspace ? { classNames: { root: "workspace-quiet-popup" } } : undefined,
    };
    // 助手独立于页面主题包装。ConfigProvider 的 theme 从对象变为 undefined 会更换内部
    // Provider 层级并重新挂载子树；助手自己的 theme 始终为对象，跨页保留同一个实例。
    const globalAgent = userId ? (
        <ConfigProvider theme={productWorkspace ? workspaceTheme : inheritedAgentTheme} {...controlOverrides}>
            <Suspense fallback={null}>
                <GlobalAgentPanel key={userId} />
            </Suspense>
        </ConfigProvider>
    ) : null;

    return (
        <>
            {adminWorkspace ? (
                children
            ) : (
                <ConfigProvider theme={productWorkspace ? workspaceTheme : undefined} {...controlOverrides}>
                    <div
                        className={cn("app-user-workspace h-dvh overflow-hidden text-foreground", spatialWorkbench && "app-spatial-workspace", productWorkspace && "app-product-workspace")}
                        style={agentDocked ? { paddingRight: agentDock.width } : undefined}
                        data-agent-docked={agentDocked || undefined}
                    >
                        <AppWorkspaceShell>{children}</AppWorkspaceShell>
                    </div>
                </ConfigProvider>
            )}
            {globalAgent}
        </>
    );
}
