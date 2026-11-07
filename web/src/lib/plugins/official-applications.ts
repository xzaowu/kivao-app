import { ART_CRITIQUE_PLUGIN_ID } from "@/lib/art-critique/contracts";
import { EAGLE_PLUGIN_ID } from "@/lib/plugins/builtin/eagle";
import { PROMPT_OPTIMIZER_PLUGIN_ID } from "@/lib/plugins/builtin/prompt-optimizer";
import { RUNNINGHUB_PLUGIN_ID } from "@/lib/plugins/builtin/workflows";

import { EDITOR_SHELL_PLUGIN_ID } from "./builtin/editor/editor-shell";

/**
 * 官方应用型插件清单：类型用于后台分组，启停与系统协议一样由管理员统一控制。
 *
 * 之前管理页、用户插件页和后端各自维护一份清单，管理页漏掉 AI 审美分析和剪辑
 * 工作台，导致二者被误判为系统协议并在管理页显示“已停用”。这里收敛为唯一来源。
 */
export const OFFICIAL_APPLICATION_PLUGIN_IDS = [
    RUNNINGHUB_PLUGIN_ID,
    EAGLE_PLUGIN_ID,
    PROMPT_OPTIMIZER_PLUGIN_ID,
    ART_CRITIQUE_PLUGIN_ID,
    EDITOR_SHELL_PLUGIN_ID,
    "user-feedback",
] as const;

const officialApplicationIdSet = new Set<string>(OFFICIAL_APPLICATION_PLUGIN_IDS);

/** 判断插件是否为官方应用型插件。 */
export function isOfficialApplicationPluginId(pluginId: string) {
    return officialApplicationIdSet.has(pluginId);
}
