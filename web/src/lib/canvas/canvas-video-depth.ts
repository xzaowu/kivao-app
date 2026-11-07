import { DEFAULT_VIDEO_DEPTH_CAPTURE_MAX_SECONDS, modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";
import type { ModelQuoteRequest } from "@/services/api/logical-models";
import type { ReferenceVideo } from "@/types/media";
import type { CanvasNodeData } from "@/types/canvas";

export const VIDEO_DEPTH_CAPTURE_OPERATION = "depth_capture";

export function videoDepthSourceError(node: Pick<CanvasNodeData, "metadata">, maxSeconds: number) {
    const m = node.metadata;
    if (!m?.storageKey?.startsWith("resource:")) return "源视频需先上传并保存到资源库";
    if (!m.durationMs || m.durationMs <= 0) return "源视频时长尚未就绪";
    if (m.durationMs > maxSeconds * 1000) return `源视频超过 ${maxSeconds} 秒，请先截取片段`;
    if (!m.naturalWidth || !m.naturalHeight) return "源视频尺寸尚未就绪";
    if (Math.min(m.naturalWidth, m.naturalHeight) > 1440 || Math.max(m.naturalWidth, m.naturalHeight) > 2560) return "源视频不能超过 2K（短边 1440、长边 2560）";
    return "";
}

export function videoDepthMaxSeconds(config: AiConfig, model: string) {
    return modelCapabilityConfigFor(config, model).video?.processing?.maxSourceSeconds || DEFAULT_VIDEO_DEPTH_CAPTURE_MAX_SECONDS;
}

export function videoDepthQuoteRequest(config: AiConfig, model: string, durationMs: number): ModelQuoteRequest | undefined {
    const channel = resolveModelChannel(config, model);
    if (!model || channel.scope !== "system") return undefined;
    return { channelId: channel.id, modelKey: modelOptionName(model), intent: { capability: "video", operation: VIDEO_DEPTH_CAPTURE_OPERATION, inputs: { video: 1 }, options: { videoSeconds: Math.ceil(durationMs / 1000) } } };
}

export function videoDepthTaskInput({ config, model, source, projectId, nodeId, signal }: { config: AiConfig; model: string; source: ReferenceVideo; projectId: string; nodeId: string; signal?: AbortSignal }) {
    return {
        nodeId,
        projectId,
        mode: "video" as const,
        prompt: "深度动作捕捉",
        config: { ...config, model, videoModel: model, vquality: "", size: "", videoSeconds: String(Math.ceil((source.durationMs || 0) / 1000)), taskWorkflowProvider: "model" as const },
        referenceVideos: [source],
        signal,
        metadata: { sourceNodeId: source.id, videoEditOperation: VIDEO_DEPTH_CAPTURE_OPERATION },
    };
}
