import type { AiConfig } from "@/stores/use-config-store";
import { logicalModelIDForConfig, modelOptionName, resolveModelChannel } from "@/stores/use-config-store";
import type { EcommerceModelChoice } from "@/services/api/ecommerce";

export function ecommerceModelChoice(config: AiConfig, value: string): EcommerceModelChoice {
    const logicalModelId = logicalModelIDForConfig({ ...config, model: value });
    if (logicalModelId) return { logicalModelId };
    const channel = resolveModelChannel(config, value);
    if (!value || channel?.scope !== "system") throw new Error("请选择平台模型");
    return { channelId: channel.id, model: modelOptionName(value) };
}

export function ecommerceTaskText(task?: { resultJson?: string }) {
    if (!task?.resultJson) return "";
    try {
        const result = JSON.parse(task.resultJson);
        return typeof result.text === "string" ? result.text : "";
    } catch {
        return "";
    }
}
