import { DEFAULT_VIDEO_DEPTH_CAPTURE_MAX_SECONDS, modelCapabilityConfigFor } from "@/lib/model-capabilities";
import type { ModelQuoteRequest } from "@/services/api/logical-models";
import { modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeData } from "@/types/canvas";
import type { ReferenceVideo } from "@/types/media";

export const VIDEO_DEPTH_CAPTURE_OPERATION = "depth_capture";

export function videoDepthMaxSeconds(config: AiConfig, model: string) {
    return modelCapabilityConfigFor(config, model).video?.processing?.maxSourceSeconds || DEFAULT_VIDEO_DEPTH_CAPTURE_MAX_SECONDS;
}

export function videoDepthSourceError(node: CanvasNodeData, maxSeconds: number) {
    const metadata = node.metadata;
    if (!metadata?.storageKey?.startsWith("resource:")) return "请先将源视频上传到素材库";
    const durationMs = metadata.durationMs || 0;
    if (durationMs <= 0) return "源视频时长尚未就绪，请重新上传后再试";
    if (durationMs > maxSeconds * 1000) return `源视频时长超过 ${maxSeconds} 秒上限，请先截取片段`;
    const width = metadata.naturalWidth || 0;
    const height = metadata.naturalHeight || 0;
    if (width <= 0 || height <= 0) return "源视频尺寸尚未就绪，请重新上传后再试";
    if (Math.min(width, height) > 1440 || Math.max(width, height) > 2560) return "源视频不能超过 2K（短边 1440、长边 2560）";
    return "";
}

export function videoDepthQuoteRequest(config: AiConfig, model: string, durationMs: number): ModelQuoteRequest | undefined {
    const channel = resolveModelChannel(config, model);
    if (channel.scope !== "system" || !model) return undefined;
    return {
        channelId: channel.id,
        modelKey: modelOptionName(model),
        intent: { capability: "video", operation: VIDEO_DEPTH_CAPTURE_OPERATION, inputs: { video: 1 }, options: { videoSeconds: Math.max(1, Math.ceil(durationMs / 1000)) } },
    };
}

export function videoDepthTaskInput({ config, model, source, projectId, nodeId, signal }: { config: AiConfig; model: string; source: ReferenceVideo; projectId: string; nodeId: string; signal?: AbortSignal }) {
    return {
        projectId,
        nodeId,
        mode: "video" as const,
        prompt: "深度动作捕捉",
        config: { ...config, model, videoModel: model, vquality: "", size: "", videoSeconds: String(Math.max(1, Math.ceil((source.durationMs || 0) / 1000))), taskWorkflowProvider: "model" as const },
        referenceVideos: [source],
        signal,
        metadata: { sourceNodeId: source.id, videoEditOperation: VIDEO_DEPTH_CAPTURE_OPERATION },
    };
}
