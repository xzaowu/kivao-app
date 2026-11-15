import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import "@/lib/plugins/builtin";
import { listRegisteredManifests } from "@/lib/plugins/plugin-registry";

import { createModelChannel, useConfigStore } from "@/stores/use-config-store";
import { navigateToSettings } from "@/lib/settings-navigation";
import { initializeClientDiagnostics, setDiagnosticUserScope } from "@/services/diagnostics/client-diagnostics";
import { fetchPluginRuntimeState } from "@/services/api/plugins";
import { usePluginStore } from "@/stores/use-plugin-store";
import { useUserStore } from "@/stores/use-user-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { t } = useTranslation();
    const config = useConfigStore((state) => state.config);
    const userId = useUserStore((state) => state.user?.id || "");
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const setRuntimeStatuses = usePluginStore((state) => state.setRuntimeStatuses);
    const setPluginStates = usePluginStore((state) => state.setPluginStates);
    const pluginStoreHydrated = usePluginStore((state) => state.hydrated);
    const runtime = useQuery({
        queryKey: ["plugin-runtime", userId],
        queryFn: fetchPluginRuntimeState,
        enabled: Boolean(userId && pluginStoreHydrated),
        refetchInterval: 30_000,
        refetchOnWindowFocus: "always",
        staleTime: 0,
        retry: 1,
    });

    useEffect(
        () => () => {
            usePluginStore.getState().setRuntimeStatuses({});
            usePluginStore.getState().setPluginStates({});
        },
        [],
    );

    useEffect(() => {
        if (!userId || !pluginStoreHydrated) return;
        if (runtime.isError) {
            setRuntimeStatuses({});
            setPluginStates({});
        } else if (runtime.data) {
            setRuntimeStatuses(runtime.data.statuses);
            setPluginStates(runtime.data.states);
            // Users no longer visit the plugin center to create local settings.
            // Register metadata without granting activation or changing saved config.
            for (const manifest of listRegisteredManifests()) usePluginStore.getState().ensurePlugin(manifest);
        }
    }, [pluginStoreHydrated, runtime.data, runtime.isError, setPluginStates, setRuntimeStatuses, userId]);

    useEffect(() => {
        initializeClientDiagnostics();
    }, []);

    useEffect(() => {
        setDiagnosticUserScope(userId);
    }, [userId]);

    useEffect(() => {
        const interactiveSelector = 'button, [role="button"], a, [class*="card"], [class*="Card"]';
        const blurPointerFocus = (event: PointerEvent) => {
            if (event.pointerType === "mouse" && event.button !== 0) return;
            const target = event.target instanceof Element ? event.target.closest<HTMLElement>(interactiveSelector) : null;
            if (!target || target.hasAttribute("disabled") || target.getAttribute("aria-disabled") === "true") return;
            // 浏览器可能把鼠标点击误判为 :focus-visible；下一帧只清掉这次指针点击产生的焦点。
            window.requestAnimationFrame(() => {
                if (document.activeElement === target) target.blur();
            });
        };
        document.addEventListener("pointerdown", blurPointerFocus, true);
        return () => document.removeEventListener("pointerdown", blurPointerFocus, true);
    }, []);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const ignoredApiKey = searchParams.has("apiKey") || searchParams.has("apikey");
        if (!baseUrl && !ignoredApiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const firstChannel = config.channels[0];
        updateConfig(
            "channels",
            firstChannel
                ? config.channels.map((channel, index) =>
                      index === 0
                          ? {
                                ...channel,
                                ...(baseUrl ? { baseUrl } : {}),
                            }
                          : channel,
                  )
                : [createModelChannel({ id: "default", name: t("account.layout.clientInit.defaultChannel"), baseUrl: baseUrl || undefined })],
        );
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        navigateToSettings({ section: "channels" });
        if (ignoredApiKey) message.warning(t("account.layout.clientInit.apiKeyIgnored"));
        else message.success(t("account.layout.clientInit.baseUrlImported"));
    }, [config.channels, message, t, updateConfig]);

    return <>{children}</>;
}
