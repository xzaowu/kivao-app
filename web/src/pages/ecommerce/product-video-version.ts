import type { GenerationTask, ProductVideoPresenter, ProductVideoReference, ProductVideoVersion } from "@/services/api/task-center";
import { validBoards, validShootBrief } from "./product-video-board";

export type { ProductVideoVersion } from "@/services/api/task-center";

export function productVideoInputLabel(version: ProductVideoVersion) {
    if (version.productImages) return `商品参考图 · ${version.productImages.length} 张`;
    if (version.presenter) return "已确认的人货同框图";
    if (version.boardInputs) return "提交时的商品主图 · 已使用分镜参考图";
    return version.referenceVideo ? "提交时的商品参考图" : "提交时的首帧";
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const textFits = (value: unknown, maximum: number): value is string => typeof value === "string" && Array.from(value).length <= maximum;
const nonemptyText = (value: unknown, maximum: number) => textFits(value, maximum) && value.trim().length > 0;
const validId = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 80 && !/[^a-zA-Z0-9_-]/.test(value);

export function isProductVideoPresenter(value: unknown): value is ProductVideoPresenter {
    return isRecord(value) && validId(value.frameResourceId) && (value.delivery === "recommend" || value.delivery === "demonstrate" || value.delivery === "answer");
}

export function isProductVideoFrame(value: unknown): value is ProductVideoVersion["frame"] {
    return isRecord(value) && validId(value.resourceId) && textFits(value.name, 512) && (value.source === undefined || value.source === "library" || value.source === "composite");
}

export function validProductVideoImages(value: unknown, allowEmpty = false): value is NonNullable<ProductVideoVersion["productImages"]> {
    return Array.isArray(value) && (allowEmpty || value.length > 0) && value.length <= 3 && value.every(isProductVideoFrame) && new Set(value.map((image) => image.resourceId)).size === value.length;
}

export function isProductVideoReference(value: unknown): value is ProductVideoReference {
    if (!isRecord(value) || !validId(value.resourceId) || !textFits(value.name, 512)) return false;
    const { durationMs, aspects, instruction } = value;
    return (
        typeof durationMs === "number" &&
        Number.isInteger(durationMs) &&
        durationMs > 0 &&
        durationMs <= 3_600_000 &&
        (aspects === undefined || (Array.isArray(aspects) && aspects.length > 0 && aspects.length <= 3 && new Set(aspects).size === aspects.length && aspects.every((item) => item === "rhythm" || item === "camera" || item === "framing"))) &&
        (instruction === undefined || textFits(instruction, 240))
    );
}

export function isProductVideoVersion(value: unknown): value is ProductVideoVersion {
    if (!isRecord(value) || value.schema !== 1 || !isProductVideoFrame(value.frame) || !isRecord(value.settings)) return false;
    const { frame, settings, productImages } = value;
    return (
        (productImages === undefined || (validProductVideoImages(productImages) && productImages[0].resourceId === frame.resourceId && value.referenceVideo === undefined && value.presenter === undefined)) &&
        (value.referenceVideo === undefined || isProductVideoReference(value.referenceVideo)) &&
        (value.boards === undefined || validBoards(value.boards)) &&
        (value.boardInputs === undefined ||
            (value.boardInputs === true && !value.referenceVideo && !value.presenter && validBoards(value.boards) && value.boards.some((board) => board.frame && (productImages !== undefined || board.frame.resourceId !== frame.resourceId)))) &&
        (value.shootBrief === undefined || validShootBrief(value.shootBrief)) &&
        (value.presenter === undefined || (isProductVideoPresenter(value.presenter) && value.presenter.frameResourceId === frame.resourceId && value.referenceVideo === undefined && settings.generateAudio === true && nonemptyText(value.voice, 16000))) &&
        nonemptyText(value.model, 512) &&
        (value.purpose === "showcase" || value.purpose === "lifestyle" || value.purpose === "demo") &&
        (value.approachId === undefined || validId(value.approachId)) &&
        (value.parentTaskId === undefined || validId(value.parentTaskId)) &&
        Array.isArray(value.shots) &&
        value.shots.length === 3 &&
        value.shots.every((shot) => nonemptyText(shot, 16000)) &&
        textFits(value.facts, 16000) &&
        textFits(value.voice, 16000) &&
        textFits(value.productName, 4000) &&
        textFits(value.audience, 4000) &&
        textFits(value.language, 40) &&
        (value.region === undefined || textFits(value.region, 80)) &&
        settings.seconds === 15 &&
        nonemptyText(settings.ratio, 40) &&
        nonemptyText(settings.resolution, 40) &&
        typeof settings.generateAudio === "boolean"
    );
}

export function productVideoVersionForTask(task: GenerationTask, projectId?: string) {
    if (!projectId || task.projectId !== projectId || task.type !== "canvas_video") return undefined;
    const version = task.clientContext?.ecommerceVideoVersion;
    return isProductVideoVersion(version) ? version : undefined;
}
