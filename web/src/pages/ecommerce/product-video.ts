import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { videoReferenceSegmentError } from "@/lib/canvas/canvas-video-regeneration";
import { modelCompatibilityError, type ModelRequirements } from "@/lib/model-selection";
import { creationVideoConfig } from "@/pages/create/creation-generation-config";
import type { EcommerceDraft } from "@/services/api/ecommerce";
import { labelOf, languages } from "./catalog";
import type { ProductVideoPresenter, ProductVideoReference, ProductVideoShootBrief } from "@/services/api/task-center";
import { productVideoReferenceFocus, videoRemixInstruction } from "./product-video-remix-presets";
export { defaultReferenceAspects, productVideoReferenceAspects, productVideoReferenceFocus } from "./product-video-remix-presets";
import { shotDirection, type ProductVideoBoards, type ProductVideoBoardShot } from "./product-video-board";
import type { SalesVideoVoiceMode } from "./product-video-approaches";
import { resolveModelChannel, resolveModelRequestConfig, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";

export const productVideoRequirements: ModelRequirements = {
    capability: "video",
    videoOperation: "image_to_video",
    videoSeconds: "15",
    input: { textCount: 1, imageCount: 1, referenceImageCount: 0, videoCount: 0, audioCount: 0, characterCount: 0 },
};

type ProductVideoImage = NonNullable<ProductVideoBoardShot["frame"]>;

export function productVideoShotImages(product?: ProductVideoImage | readonly ProductVideoImage[], boards?: ProductVideoBoards): ProductVideoImage[] {
    if (!product) return [];
    const productImages = "resourceId" in product ? [product] : product;
    if (!productImages.length) return [];
    const images = productImages.filter((image, i) => productImages.findIndex((view) => view.resourceId === image.resourceId) === i);
    for (const { frame } of boards ?? []) {
        if (frame && !images.some((image) => image.resourceId === frame.resourceId)) images.push(frame);
    }
    return images;
}

export function productVideoRequirementsFor(referenceVideo?: Pick<ProductVideoReference, "durationMs">, imageCount = 1, requireAudio = false, salesReferences = false): ModelRequirements {
    const options = requireAudio ? { options: { videoGenerateAudio: true } } : {};
    if (!referenceVideo && !salesReferences && imageCount <= 1) return { ...productVideoRequirements, ...options };
    const referenceImages = referenceVideo ? 1 : Math.max(1, imageCount);
    return {
        capability: "video",
        videoSeconds: "15",
        videoOperation: "reference_to_video",
        ...options,
        input: { textCount: 1, imageCount: referenceImages, referenceImageCount: referenceImages, videoCount: referenceVideo ? 1 : 0, audioCount: 0, characterCount: 0, ...(referenceVideo && { videoDurationsMs: [referenceVideo.durationMs] }) },
    };
}

export function productVideoModels(config: AiConfig, referenceVideo?: Pick<ProductVideoReference, "durationMs">, imageCount = 1, requireAudio = false, salesReferences = false) {
    const requirements = productVideoRequirementsFor(referenceVideo, imageCount, requireAudio, salesReferences);
    return selectableModelsByCapability(config, "video").filter((model) => {
        const profile = modelCapabilityConfigFor(config, model).video;
        return (
            profile &&
            profile.durationSupported !== false &&
            (!requireAudio || profile.generateAudio.supported) &&
            (referenceVideo ? profile.remixReferences === true && (!requireAudio || profile.remixGenerateAudio === true) : requirements.videoOperation !== "reference_to_video" || profile.numberedImageReferences === true) &&
            profile.references.minImages <= requirements.input!.imageCount &&
            resolveModelChannel(config, model).scope === "system" &&
            !modelCompatibilityError(config, model, requirements) &&
            (!referenceVideo?.durationMs || !videoReferenceSegmentError({ ...config, model }, referenceVideo.durationMs))
        );
    });
}

export function productVideoRatio(config: AiConfig, model: string | undefined, requested?: string, presenter = false) {
    const profile = model ? modelCapabilityConfigFor(config, model).video : undefined;
    if (!profile) return { options: [], value: "", unavailable: "" };
    // 空规格表示任务不发送 size；历史版本也以 auto 记录这个状态。
    const protocol = presenter && model ? resolveModelRequestConfig(config, model).interfaceType : "";
    const adaptiveOnly = protocol === "volcengine-ark-seedance-25" || protocol === "minimax-video";
    const options = !profile.ratios.length ? ["auto"] : adaptiveOnly ? profile.ratios.filter((ratio) => ratio === "adaptive") : profile.ratios;
    const preferred = options.includes("9:16") ? "9:16" : options.includes(profile.defaultRatio) ? profile.defaultRatio : options[0];
    if (requested && !options.includes(requested)) return { options, value: "", unavailable: requested };
    return { options, value: requested || preferred, unavailable: "" };
}

export function productVideoConfig(config: AiConfig, model: string, hasVoiceover: boolean, previous?: { ratio?: string; resolution?: string }, presenter = false) {
    const profile = modelCapabilityConfigFor(config, model).video!;
    const ratio = productVideoRatio(config, model, previous?.ratio, presenter);
    if (ratio.unavailable) throw new Error("当前视频模型不支持所选画幅，请重新选择。");
    return creationVideoConfig({ ...config, taskWorkflowProvider: "model", videoGenerateAudio: hasVoiceover && profile.generateAudio.supported ? "true" : "false" }, model, {
        seconds: "15",
        ratio: ratio.value,
        videoQuality: previous?.resolution || profile.defaultResolution,
    });
}

export function productVideoPresenterModels(config: AiConfig) {
    return productVideoModels(config, undefined, 1, true).filter((model) => modelCapabilityConfigFor(config, model).video?.presenterFirstFrameAudio === true);
}

export const productVideoBeats = [
    { time: "0–3 秒", title: "开场", durationSeconds: 3 },
    { time: "3–9 秒", title: "细节", durationSeconds: 6 },
    { time: "9–15 秒", title: "收尾", durationSeconds: 6 },
] as const;

export function productShotScript(shots: string[], boards?: ProductVideoBoards, referenceImages?: readonly ProductVideoImage[], productImageCount = 0) {
    return productVideoBeats
        .map(({ time, title }, i) => {
            const shot = boards?.[i];
            const direction = [shotDirection(shot)];
            if (referenceImages?.length && (productImageCount || referenceImages.length > 1)) {
                const id = shot?.frame?.resourceId ?? (productImageCount ? undefined : referenceImages[0].resourceId);
                const index = referenceImages.findIndex((image) => image.resourceId === id);
                if (index >= 0) direction.unshift(`参考图${index + 1}`);
            }
            const instructions = direction.filter(Boolean).join(" · ");
            return `${time}｜${title}：${instructions ? `【${instructions}】` : ""}${shots[i]?.trim() || ""}`;
        })
        .join("\n");
}

// The existing product-understanding stage returns one visibleDescription string.
export function productClaimSuggestions(text: string) {
    const value = JSON.parse(
        text
            .trim()
            .replace(/^\x60\x60\x60(?:json)?\s*/i, "")
            .replace(/\s*\x60\x60\x60$/, ""),
    );
    const description: unknown = value?.visibleDescription;
    if (typeof description !== "string") throw new Error("识图结果格式不完整");
    return [
        ...new Set(
            description
                .split(/[\n。；;]+/)
                .map((line) =>
                    line
                        .trim()
                        .replace(/^(?:[-•]\s*|\d+[、.)]\s*)/, "")
                        .trim(),
                )
                .filter(Boolean),
        ),
    ].slice(0, 5);
}

export const productVideoPresenterDeliveries = { recommend: "直接推荐", demonstrate: "边用边讲", answer: "回答疑问" } as const;
const presenterDirections: Record<ProductVideoPresenter["delivery"], string> = {
    recommend: "先向观众说明商品适合谁，再用商品细节解释推荐理由。",
    demonstrate: "边使用商品边讲解，让动作和对应台词同时发生。",
    answer: "先说出一个购买疑问，再用镜头中的商品细节回答。",
};

export function productVideoPrompt(
    draft: Pick<EcommerceDraft, "productName" | "audience" | "language"> & Partial<Pick<EcommerceDraft, "region">>,
    facts: string,
    shots: string,
    voiceover: string,
    referenceVideo?: ProductVideoReference,
    presenter?: ProductVideoPresenter,
    brief?: ProductVideoShootBrief,
    compositeFrame = false,
    referenceImageCount = 1,
    salesVoiceMode?: SalesVideoVoiceMode,
    productImageCount = 0,
) {
    let productSource = "以首帧中的同一件商品为准。";
    if (referenceVideo) productSource = "以商品参考图中的商品为主体。";
    else if (!presenter && productImageCount > 0) {
        const labels = Array.from({ length: productImageCount }, (_, i) => `参考图${i + 1}`).join("、");
        productSource = `${labels}提供同一件商品的外观、材质与细节。综合这些商品参考图保持商品一致性，开场按分镜重新构图，自由安排场景、人物和机位。`;
    } else if (!presenter && referenceImageCount > 1) productSource = "参考图1是商品主图。以该图为商品外观依据，按照各镜标注的参考图安排镜头。";
    const salesMode = !presenter && !referenceVideo ? salesVoiceMode : undefined;
    const spokenCopy = voiceover.trim();
    const remixInstruction = referenceVideo && videoRemixInstruction(referenceVideo)?.trim();
    let voiceDirection = spokenCopy ? `口播文案（${draft.language || "zh-CN"}）：${spokenCopy}` : "无需口播。";
    if (salesMode === "host" || salesMode === "voiceover") {
        const speaker = salesMode === "host" ? "出镜者面向观众自然口播，保持同一人物的声音、口型和手上演示同步；对话分清说话人。" : "由画外音讲解，把镜头留给商品和使用动作；画面中的人不用对口型。";
        voiceDirection = [speaker, spokenCopy ? `按以下台词说，原文已是成片语言时保留措辞，否则忠实翻译：${spokenCopy}` : "用成片语言生成听得见的两三句简短人声。先说一个挑选问题，再用镜头里看得到的细节给出选购建议，给演示留出停顿。"].join("\n");
    }
    if (salesMode === "silent") voiceDirection = "全片无口播、无旁白，用手势、实际动作和商品细节讲清挑选依据。";
    return [
        `${referenceVideo ? "用商品图和参考视频重拍一条 15 秒短片。" : presenter ? "拍摄一条 15 秒真人出镜的商品口播短片。" : "拍摄一条 15 秒商品带货短片。"}${draft.productName.trim() ? `商品：${draft.productName.trim()}。` : ""}`,
        salesMode && "从买家关心的问题开始，用商品实物说明一个购买理由，再给出适合什么需要的选择建议。用日常交流的语气，不虚构亲测经历、推荐人资质、稀缺库存或竞品结论。",
        `${productSource}全片保持外形、颜色、包装与品牌文字一致。不得添加未确认的价格、促销、规格或功效。`,
        referenceVideo &&
            `原片时长 ${referenceVideo.durationMs / 1000} 秒。仅借鉴参考视频的${productVideoReferenceFocus(referenceVideo)}。按照下方三镜从参考片选择对应段落，调整到成片时长。使用本商品和当前分镜重新拍摄，不沿用参考片中的人物身份、商品、品牌、文案或声音。`,
        remixInstruction && `参考片借鉴要求：${remixInstruction}`,
        referenceVideo && compositeFrame && "出镜模特采用商品参考图中的人物，保持其面貌、服装和与商品的相对尺度。",
        presenter &&
            `从已确认的人货同框首帧自然接续，保持人物面貌、服装、声音和手中商品一致。${presenterDirections[presenter.delivery]}全片只由这位人物逐字说完下方台词一次，保留原文和顺序，不翻译、不增补、不另配旁白。开口时嘴部清晰可见，切商品细节时延续同一条人声，回到人物时口型和声音同步。按台词的停顿调整镜头与动作。`,
        draft.audience.trim() && `受众：${draft.audience.trim()}`,
        draft.region?.trim() && `投放市场：${draft.region.trim()}。`,
        `成片语言：${labelOf(languages, draft.language || "zh-CN")}。${presenter ? "口播以商家确认的台词原文为准，画面文字使用成片语言" : "口播及需要出现的画面文案使用成片语言"}，保留包装和商标原文。`,
        brief?.scene && `拍摄场景：${brief.scene}`,
        brief?.closing && `收尾要向观众传达：${brief.closing}`,
        facts.trim() && `已核对的商品卖点：${facts.trim()}`,
        shots.trim(),
        voiceDirection,
    ]
        .filter(Boolean)
        .join("\n");
}
