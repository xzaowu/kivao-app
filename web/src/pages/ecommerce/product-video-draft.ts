import { localForageStorageForScope } from "@/lib/localforage-storage";
import { productVideoPurposes, type ProductVideoPurpose } from "./product-video-approaches";
import type { ProductVideoStory } from "./product-video-storyboard";
import type { ProductVideoPresenter, ProductVideoReference, ProductVideoShootBrief } from "@/services/api/task-center";
import { validBoards, validShootBrief } from "./product-video-board";
import type { VideoRemixPreset } from "./product-video-remix-presets";
import { isProductVideoFrame, isProductVideoPresenter, isProductVideoReference, isProductVideoVersion, validProductVideoImages, type ProductVideoVersion } from "./product-video-version";

export type ProductVideoMode = "image" | "reference" | "presenter";
export type ProductVideoStep = "materials" | "script" | "review";

export type VideoRevisionSource = {
    taskId: string;
    title: string;
    version: ProductVideoVersion;
    shotIndex: 0 | 1 | 2;
    note?: string;
    atSeconds?: number;
};

export type ProductVideoScriptDraft = {
    purpose: ProductVideoPurpose;
    candidateId?: string;
    story: ProductVideoStory | null;
    picking: boolean;
    voice: string;
};

export type ProductVideoDraft = ProductVideoScriptDraft & {
    scope: string;
    projectId?: string;
    sessionId: string;
    chosenImage: string;
    productImages?: ProductVideoVersion["productImages"];
    libraryFrame?: ProductVideoVersion["frame"];
    chosenModel: string;
    region?: string;
    language?: string;
    ratio?: string;
    facts: string;
    mode?: ProductVideoMode;
    presenterInput?: "cast" | "photo";
    presenterPhoto?: ProductVideoVersion["frame"] | null;
    step?: ProductVideoStep;
    presenter?: { delivery: ProductVideoPresenter["delivery"]; frameResourceId?: string };
    presenterStory?: ProductVideoStory | null;
    presenterVoice?: string;
    referenceScript?: ProductVideoScriptDraft;
    shootBrief?: ProductVideoShootBrief;
    targetAudience?: string;
    referenceVideo?: ProductVideoReference;
    referencePreset?: VideoRemixPreset;
    revisionSource?: VideoRevisionSource;
};

const writes = new Map<string, Promise<void>>();

function key(sessionId: string, projectId?: string) {
    return `ecommerce-video-draft-v1:${projectId ? "project:" + projectId : "session:" + sessionId}`;
}

function isPurpose(value: unknown): value is ProductVideoPurpose {
    return productVideoPurposes.some(({ id }) => id === value);
}

function validStory(story: ProductVideoStory | null | undefined) {
    return (
        story === null ||
        (story &&
            isPurpose(story.purpose) &&
            typeof story.edited === "boolean" &&
            (story.boardInputs === undefined || typeof story.boardInputs === "boolean") &&
            (story.followBrief === undefined || story.followBrief === true) &&
            Array.isArray(story.shots) &&
            story.shots.length === 3 &&
            story.shots.every((shot) => typeof shot === "string") &&
            (story.boards === undefined || validBoards(story.boards)) &&
            (story.approachId === undefined || typeof story.approachId === "string"))
    );
}

function validScript<T extends Partial<ProductVideoScriptDraft>>(script?: T | null): script is T & ProductVideoScriptDraft {
    return Boolean(script && isPurpose(script.purpose) && (script.candidateId === undefined || typeof script.candidateId === "string") && validStory(script.story) && typeof script.picking === "boolean" && typeof script.voice === "string");
}

function parse(raw: string | null, scope: string, sessionId: string, projectId?: string): ProductVideoDraft | null {
    if (!raw) return null;
    const draft: (Partial<ProductVideoDraft> & { remixEnabled?: boolean }) | null = JSON.parse(raw);
    if (
        !draft ||
        typeof draft.facts !== "string" ||
        typeof draft.chosenModel !== "string" ||
        typeof draft.chosenImage !== "string" ||
        (draft.region !== undefined && (typeof draft.region !== "string" || Array.from(draft.region).length > 80)) ||
        (draft.language !== undefined && (typeof draft.language !== "string" || Array.from(draft.language).length > 40)) ||
        (draft.ratio !== undefined && (typeof draft.ratio !== "string" || !draft.ratio.trim() || draft.ratio.length > 40)) ||
        (draft.libraryFrame !== undefined && !isProductVideoFrame(draft.libraryFrame)) ||
        (draft.presenterPhoto != null && !isProductVideoFrame(draft.presenterPhoto)) ||
        (draft.productImages !== undefined && !validProductVideoImages(draft.productImages, true)) ||
        (draft.remixEnabled !== undefined && typeof draft.remixEnabled !== "boolean") ||
        (draft.mode !== undefined && !["image", "reference", "presenter"].includes(draft.mode)) ||
        (draft.presenterInput !== undefined && draft.presenterInput !== "cast" && draft.presenterInput !== "photo") ||
        (draft.step !== undefined && !["materials", "script", "review"].includes(draft.step)) ||
        (draft.presenter !== undefined && (!draft.presenter || !["recommend", "demonstrate", "answer"].includes(draft.presenter.delivery) || (draft.presenter.frameResourceId !== undefined && !isProductVideoPresenter(draft.presenter)))) ||
        (draft.presenterStory !== undefined && !validStory(draft.presenterStory)) ||
        (draft.presenterVoice !== undefined && typeof draft.presenterVoice !== "string") ||
        (draft.shootBrief !== undefined && !validShootBrief(draft.shootBrief)) ||
        (draft.targetAudience !== undefined && (typeof draft.targetAudience !== "string" || Array.from(draft.targetAudience).length > 4000)) ||
        (draft.referenceVideo !== undefined && !isProductVideoReference(draft.referenceVideo)) ||
        (draft.referencePreset !== undefined && draft.referencePreset !== "close" && draft.referencePreset !== "adapt")
    )
        throw new Error("视频草稿格式异常");
    const source = draft.revisionSource;
    if (
        source !== undefined &&
        (!source ||
            typeof source.taskId !== "string" ||
            !source.taskId.trim() ||
            typeof source.title !== "string" ||
            ![0, 1, 2].includes(source.shotIndex) ||
            !isProductVideoVersion(source.version) ||
            (source.note !== undefined && typeof source.note !== "string") ||
            (source.atSeconds !== undefined && (!Number.isFinite(source.atSeconds) || source.atSeconds < 0)))
    )
        throw new Error("改稿来源格式异常");
    if (!validScript(draft) || (draft.referenceScript !== undefined && !validScript(draft.referenceScript))) throw new Error("分镜草稿格式异常");
    if (draft.scope !== scope || draft.projectId !== projectId || (!projectId && draft.sessionId !== sessionId)) throw new Error("视频草稿与当前项目不一致");
    return {
        scope,
        projectId,
        sessionId,
        chosenImage: draft.chosenImage,
        productImages: draft.productImages,
        libraryFrame: draft.libraryFrame,
        chosenModel: draft.chosenModel,
        region: draft.region,
        language: draft.language,
        ratio: draft.ratio,
        facts: draft.facts,
        purpose: draft.purpose,
        candidateId: draft.candidateId,
        story: draft.story,
        picking: draft.picking,
        voice: draft.voice,
        mode: draft.mode ?? (draft.remixEnabled ? "reference" : "image"),
        presenterInput: draft.presenterInput,
        presenterPhoto: draft.presenterPhoto,
        step: draft.step,
        presenter: draft.presenter,
        presenterStory: draft.presenterStory,
        presenterVoice: draft.presenterVoice,
        referenceScript: draft.referenceScript,
        shootBrief: draft.shootBrief,
        targetAudience: draft.targetAudience,
        referenceVideo: draft.referenceVideo,
        referencePreset: draft.referencePreset,
        revisionSource: source,
    };
}

// Keep this small draft independent of the image workspace checkpoint. Project history can reopen it
// with a fresh session ID; pending saves in this tab must finish before a later read of the same account.
function enqueue(scope: string, save: () => Promise<void>): Promise<void> {
    const operation = (writes.get(scope) || Promise.resolve()).catch(() => undefined).then(save);
    writes.set(scope, operation);
    return operation.finally(() => {
        if (writes.get(scope) === operation) writes.delete(scope);
    });
}

export async function readProductVideoDraft(scope: string, sessionId: string, projectId?: string): Promise<ProductVideoDraft | null> {
    await writes.get(scope)?.catch(() => undefined);
    const store = localForageStorageForScope(scope);
    const saved = parse(await store.getItem(key(sessionId, projectId)), scope, sessionId, projectId);
    return saved || (projectId ? parse(await store.getItem(key(sessionId)), scope, sessionId) : null);
}

export function writeProductVideoDraft(draft: ProductVideoDraft): Promise<void> {
    const serialized = JSON.stringify(draft);
    return enqueue(draft.scope, async () => {
        const store = localForageStorageForScope(draft.scope);
        await store.setItem(key(draft.sessionId, draft.projectId), serialized);
        if (draft.projectId) await store.removeItem(key(draft.sessionId));
    });
}

// The first project save can happen in the image workspace while the video editor is unmounted.
export function promoteProductVideoDraft(scope: string, sessionId: string, projectId: string): Promise<void> {
    return enqueue(scope, async () => {
        const store = localForageStorageForScope(scope);
        const pending = parse(await store.getItem(key(sessionId)), scope, sessionId);
        if (!pending) return;
        const projectKey = key(sessionId, projectId);
        if (!parse(await store.getItem(projectKey), scope, sessionId, projectId)) {
            await store.setItem(projectKey, JSON.stringify({ ...pending, projectId }));
        }
        await store.removeItem(key(sessionId));
    });
}
