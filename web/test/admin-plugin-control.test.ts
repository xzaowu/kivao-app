import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { isPluginEffectivelyEnabled, usePluginStore } from "../src/stores/use-plugin-store";
import type { PluginState } from "../src/services/api/plugins";

const originalState = usePluginStore.getState();
let stateSpy: ReturnType<typeof spyOn> | undefined;
afterEach(() => stateSpy?.mockRestore());

function givenState(effectiveEnabled?: boolean, runtimeStatus?: string) {
    const pluginId = "prompt-optimizer";
    stateSpy = spyOn(usePluginStore, "getState").mockReturnValue({
        ...originalState,
        installations: [{ manifest: { id: pluginId }, enabled: true }] as never,
        pluginStates: effectiveEnabled === undefined ? {} : { [pluginId]: { pluginId, effectiveEnabled, canToggle: false } as PluginState },
        runtimeStatuses: runtimeStatus ? { [pluginId]: runtimeStatus } : {},
    });
    return pluginId;
}

describe("管理员统一启停插件", () => {
    test("个人历史启用记录不能在缺少服务端状态时启用插件", () => {
        expect(isPluginEffectivelyEnabled(givenState())).toBe(false);
    });

    test("管理员停用优先于运行时与个人历史启用状态", () => {
        expect(isPluginEffectivelyEnabled(givenState(false, "enabled"))).toBe(false);
    });

    test("管理员开放后不要求用户再次启用", () => {
        expect(isPluginEffectivelyEnabled(givenState(true))).toBe(true);
    });

    test("仅有服务端运行时状态的模型协议继续可用", () => {
        expect(isPluginEffectivelyEnabled(givenState(undefined, "enabled"))).toBe(true);
    });
});
