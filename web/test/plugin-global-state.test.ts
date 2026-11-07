import { afterEach, expect, test } from "bun:test";
import { isPluginEffectivelyEnabled, usePluginStore } from "../src/stores/use-plugin-store";
import { PLUGIN_API_VERSION } from "../src/lib/plugins/plugin-types";
import type { PluginState } from "../src/services/api/plugins";

afterEach(() => usePluginStore.setState({ installations: [], pluginStates: {}, runtimeStatuses: {} }));

test("后台状态覆盖个人启停，保留个人配置；未知或获取失败时不启用", () => {
    const store = usePluginStore.getState();
    store.ensurePlugin({ id: "global-test", name: "Test", version: "1.0.0", apiVersion: PLUGIN_API_VERSION, description: "", author: "Test", surfaces: ["hybrid"], permissions: [], trusted: true, contributes: { usageObservers: ["test"] } });
    store.updateConfig("global-test", { example: "retained" });
    store.setEnabled("global-test", true);
    expect(isPluginEffectivelyEnabled("global-test")).toBe(false);
    const state: PluginState = { pluginId: "global-test", platformAvailable: true, effectiveEnabled: true, userEnabled: false, userConfigured: false, canToggle: false, canConfigure: false };
    store.setPluginStates({ "global-test": state });
    expect(isPluginEffectivelyEnabled("global-test")).toBe(true);
    store.setEnabled("global-test", false);
    expect(isPluginEffectivelyEnabled("global-test")).toBe(true);
    store.setPluginStates({ "global-test": { ...state, platformAvailable: false, effectiveEnabled: false } });
    expect(isPluginEffectivelyEnabled("global-test")).toBe(false);
    expect(usePluginStore.getState().installations[0].enabled).toBe(false);
    expect(usePluginStore.getState().installations[0].config).toEqual({ example: "retained" });
    store.setPluginStates({ "global-test": state });
    store.setPluginStates({});
    expect(isPluginEffectivelyEnabled("global-test")).toBe(false);
    expect(usePluginStore.getState().installations[0].enabled).toBe(false);
});

test("重复刷新相同开关不会重新建立素材来源配置", () => {
    const store = usePluginStore.getState();
    store.ensurePlugin({ id: "unchanged", name: "Test", version: "1.0.0", apiVersion: PLUGIN_API_VERSION, description: "", author: "Test", surfaces: ["hybrid"], permissions: [], contributes: { usageObservers: ["test"] } });
    store.setPluginStates({});
    const installations = usePluginStore.getState().installations;
    store.setPluginStates({});
    expect(usePluginStore.getState().installations).toBe(installations);
});
