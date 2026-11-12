import { isTextWire, type TextWire } from "@/lib/model-protocols";
import { captureUserScopeOperation } from "@/lib/user-scope";
import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { fetchPluginProviderCatalog } from "./plugin-catalog";

// Catalog discovery never guesses a format for an unknown plugin. System
// channels use their server-projected model contract; custom channels resolve
// the currently installed catalog without a cross-account module cache.
export async function resolveTextRequestConfig(config: AiConfig, signal?: AbortSignal) {
    const operation = captureUserScopeOperation(signal);
    const request = resolveModelRequestConfig(config, config.model || config.textModel);
    const id = request.interfaceType;
    if (request.apiFormat === "gemini") return { ...request, textWire: "gemini" as const };
    let wire: TextWire | undefined;
    if (request.channelId && isTextWire(request.textWire)) {
        wire = request.textWire;
    } else if (!id || id === "chat-completion") {
        wire = "chat-completion";
    } else if (id === "openai-response") {
        wire = "responses";
    } else if (id === "claude-api") {
        wire = "claude-api";
    } else if (!request.channelId) {
        const definitions = await fetchPluginProviderCatalog("user.custom-channel", "text", operation.signal);
        operation.assertCurrent();
        const definition = definitions.find((item) => item.value === id);
        if (definition?.requiresSecretKey && !request.secretKey?.trim()) throw new Error("当前协议需要填写 Secret Key");
        wire = definition?.textWire;
    }
    operation.assertCurrent();
    if (!isTextWire(wire)) throw new Error("当前文本协议不可用或不支持此调用方式，请刷新模型配置或联系管理员");
    return { ...request, textWire: wire, apiFormat: wire === "claude-api" ? "claude" as const : "openai" as const };
}
