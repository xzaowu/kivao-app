import type { ProductVideoReference, ProductVideoReferenceAspect } from "@/services/api/task-center";
import type { EcommerceDraft } from "@/services/api/ecommerce";
import type { ProductVideoStory } from "./product-video-storyboard";

export const productVideoReferenceAspects = [
    { key: "rhythm", title: "镜头节奏" },
    { key: "camera", title: "运镜" },
    { key: "framing", title: "构图" },
] as const;
export const defaultReferenceAspects: ProductVideoReferenceAspect[] = ["rhythm", "camera"];

export function productVideoReferenceFocus(reference: ProductVideoReference) {
    const selected = reference.aspects ?? defaultReferenceAspects;
    return productVideoReferenceAspects
        .filter(({ key }) => selected.includes(key))
        .map(({ title }) => title)
        .join("、");
}

export const videoRemixPresets = {
    close: {
        title: "贴近原片",
        aspects: ["rhythm", "camera", "framing"],
        instruction: "对照参考片的景别、机位和切镜节奏，用自己的商品重拍。",
    },
    adapt: {
        title: "灵活改编",
        aspects: ["rhythm"],
        instruction: "沿用参考片的快慢节奏，围绕自己的商品重新安排场景、动作和构图。",
    },
} satisfies Record<string, { title: string; aspects: ProductVideoReferenceAspect[]; instruction: string }>;
export type VideoRemixPreset = keyof typeof videoRemixPresets;

export function matchVideoRemixPreset(reference?: ProductVideoReference): VideoRemixPreset | undefined {
    const selected = reference?.aspects;
    if (!selected) return undefined;
    return (["close", "adapt"] as const).find((id) => {
        const aspects: ProductVideoReferenceAspect[] = videoRemixPresets[id].aspects;
        return aspects.length === selected.length && aspects.every((aspect) => selected.includes(aspect));
    });
}

function splitRemixInstruction(reference: ProductVideoReference) {
    const text = reference.instruction ?? "";
    const preset = Object.values(videoRemixPresets).find(({ instruction }) => text === instruction || text.startsWith(instruction + "\n"));
    return { preset, note: preset ? text.slice(preset.instruction.length).replace(/^\n/, "") : text };
}

export function videoRemixInstruction(reference: ProductVideoReference) {
    const { preset, note } = splitRemixInstruction(reference);
    const selected = matchVideoRemixPreset(reference);
    return preset && (!selected || videoRemixPresets[selected] !== preset) ? note : reference.instruction;
}

export function setVideoRemixAspects(reference: ProductVideoReference, aspects: ProductVideoReferenceAspect[]): ProductVideoReference {
    if (!aspects.length) return reference;
    const next = { ...reference, aspects };
    return { ...next, instruction: videoRemixInstruction(next) };
}

export function applyVideoRemixPreset(reference: ProductVideoReference, preset: VideoRemixPreset): ProductVideoReference {
    const { aspects, instruction } = videoRemixPresets[preset];
    // Only replace the leading suggestion we supplied. Never truncate a user's note to fit the suggestion.
    const { note: handwritten } = splitRemixInstruction(reference);
    const combined = handwritten ? instruction + "\n" + handwritten : instruction;
    return { ...reference, aspects: [...aspects], instruction: Array.from(combined).length <= 240 ? combined : handwritten };
}

export function buildVideoRemixStory(reference: ProductVideoReference, draft: Pick<EcommerceDraft, "productName" | "scene">, facts: string, closing = ""): ProductVideoStory {
    const aspects = reference.aspects ?? defaultReferenceAspects;
    const product = draft.productName.trim() || "自己的商品";
    const firstFact = facts
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
    const detail = firstFact ? (Array.from(firstFact).length <= 80 ? `用一个可见细节交代「${firstFact}」` : "用一个可见细节交代已确认的卖点") : "拍清商品图中可见的一处细节";
    // These windows are viewing cues for the three output beats, not measured cuts in the source.
    const seconds = (fraction: number) => Math.round(reference.durationMs * fraction) / 1000;
    const window = (label: string, from: number, to: number) => (reference.durationMs >= 1000 ? `对照参考片${label}（${seconds(from)}–${seconds(to)} 秒）` : `对照参考片${label}`);
    return {
        purpose: "showcase",
        approachId: "reference-remix",
        edited: false,
        shots: [
            `${window("开头", 0, 0.2)}，让${product}成为主体。${aspects.includes("framing") ? "参照主体在画面中的位置和景别安排入画。" : "围绕自己的商品重新安排开场构图。"}${draft.scene.trim() ? `场景采用「${draft.scene.trim()}」。` : ""}`,
            `${window("中段", 0.2, 0.6)}，${aspects.includes("camera") ? "参照原片机位的移动方向或固定机位，" : "选适合本商品的机位，"}${detail}。`,
            `${window("结尾", 0.6, 1)}，${aspects.includes("rhythm") ? "参照原片切换和停留的节奏完成收束。" : "用适合本商品的节奏收束。"}${closing.trim() ? `落实收尾要求「${closing.trim()}」。` : "让观众最后看清刚刚展示的商品。"}`,
        ],
    };
}
