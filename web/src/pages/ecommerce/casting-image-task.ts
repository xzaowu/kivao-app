import { resolvedMediaConfig } from "@/lib/media-settings";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { modelCompatibilityError, type ModelRequirements } from "@/lib/model-selection";
import { parseBackendGenerationResult } from "@/services/api/generation-task";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import type { GenerationTask } from "@/services/api/task-center";
import { resolveModelChannel, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { isProductVideoFrame } from "./product-video-version";

export const portraitRequirements = { capability: "image", input: { textCount: 1, imageCount: 0, referenceImageCount: 0, videoCount: 0, audioCount: 0, characterCount: 0 } } satisfies ModelRequirements;
export const frameRequirements: ModelRequirements = { capability: "image", input: { ...portraitRequirements.input, imageCount: 2, referenceImageCount: 2 } };

export function castingModels(config: AiConfig, requirements: ModelRequirements) {
    return selectableModelsByCapability(config, "image").filter((model) => resolveModelChannel(config, model).scope === "system" && !modelCompatibilityError(config, model, requirements));
}

export function castingImageSettings(config: AiConfig, model?: string) {
    const profile = model && modelCapabilityConfigFor(config, model).image;
    if (!model || !profile) return;
    return resolvedMediaConfig(
        {
            ...config,
            model,
            imageModel: model,
            size: profile.size.values.find((size) => size === "9:16") || profile.size.values.find((size) => size === "1024x1536") || profile.size.default,
            quality: profile.quality.default,
            imageResolution: profile.resolution.default,
            imageParameters: "",
            count: "1",
            transparentBackground: "false",
            taskWorkflowProvider: "model",
        },
        "image",
    );
}

export function castingOutput(task: GenerationTask | undefined, receipt: { projectId: string; operationId: string; taskId?: string } | null, name: string) {
    if (!task || !receipt || task.type !== "canvas_image" || task.projectId !== receipt.projectId || task.clientOperationId !== receipt.operationId || (receipt.taskId && receipt.taskId !== task.id) || task.status !== "succeeded") return;
    try {
        const images = parseBackendGenerationResult(task).images;
        if (images?.length !== 1) return;
        const frame = { resourceId: resourceIdFromStorageKey(images[0].storageKey), name };
        if (isProductVideoFrame(frame)) return frame;
    } catch {
        // A preview URL without a managed original cannot be reused for generation.
    }
}
