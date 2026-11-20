import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Select } from "antd";
import { Check, ChevronDown, Expand, Film, FolderOpen, ImagePlus, Mic, UserRound } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type RefObject } from "react";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { SegmentedControl } from "@/components/ui/base/segmented-control/segmented-control";
import { AppModal } from "@/components/ui/product/app-modal";
import { createClientUUID } from "@/lib/client-id";
import { assertCurrentUserSession, captureUserSession } from "@/lib/user-scope";
import { WorkbenchAssetPicker, type PickedWorkbenchAsset } from "@/pages/workbench/workbench-asset-picker";
import { referenceVideoQuoteBreakdown, systemModelQuoteRequest } from "@/lib/model-pricing";
import { modelPromptLengthError } from "@/lib/model-selection";
import { formatVideoResolutionLabel } from "@/lib/video-generation-options";
import type { EcommerceDraft } from "@/services/api/ecommerce";
import { prepareBackendGenerationTask } from "@/services/api/generation-task";
import { quoteModel, type LogicalModelQuote } from "@/services/api/logical-models";
import { refreshResource, resourceStorageKey } from "@/services/api/resources";
import { ApiError } from "@/services/api/request";
import { createGenerationTask, listGenerationTasks, queryGenerationTask, type GenerationTask, type ProductVideoPresenter, type ProductVideoReference, type ProductVideoShootBrief } from "@/services/api/task-center";
import { modelDisplayName, type AiConfig } from "@/stores/use-config-store";
import { productShotScript, productVideoBeats, productVideoConfig, productVideoModels, productVideoPresenterModels, productVideoPrompt, productVideoRatio, productVideoRequirementsFor, productVideoShotImages } from "./product-video";
import { ProductVideoSalesGallery } from "./product-video-sales-gallery";
import { ProductVideoMarket } from "./product-video-market";
import { ProductVideoRatioField } from "./product-video-ratio-field";
import { applyVideoRemixPreset, buildVideoRemixStory, matchVideoRemixPreset, type VideoRemixPreset } from "./product-video-remix-presets";
import { productSalesVideoApproaches, salesVideoStyle, salesVideoVoiceLabels, type ProductVideoApproach, type ProductVideoPurpose } from "./product-video-approaches";
import { ProductVideoClaims } from "./product-video-claims";
import { ProductVideoShootBriefEditor } from "./product-video-shoot-brief";
import { sameBoards } from "./product-video-board";
import { ProductFactsPanel, type SaveProductFacts } from "./product-facts-panel";
import { readProductVideoDraft, writeProductVideoDraft, type ProductVideoDraft, type ProductVideoMode, type ProductVideoScriptDraft, type VideoRevisionSource } from "./product-video-draft";
import { ProductVideoPrepGuide } from "./product-video-examples";
import { isProductVideoFrame, isProductVideoVersion, productVideoVersionForTask, type ProductVideoVersion } from "./product-video-version";
import { ProductVideoWorkCard } from "./product-video-works";
import { ProductVideoComparison } from "./product-video-comparison";
import { useProductVideoSubmission } from "./product-video-submission";
import { ProductVideoPlanning } from "./product-video-planning-panel";
import type { ScriptTarget } from "./use-product-video-planning-task";
import { ProductVideoReferencePanel } from "./product-video-reference-panel";
import { ProductVideoFrameComposer } from "./product-video-frame-composer";
import { ProductVideoProductImages } from "./product-video-product-images";
import { defaultPresenterStory, ProductVideoPresenterDelivery } from "./product-video-presenter";
import { ProductVideoStoryboard, type ProductVideoStory } from "./product-video-storyboard";
import "./product-video.css";
import "./product-video-materials.css";
import "./product-video-presenter-layout.css";

type Props = {
    scope: string;
    sessionId: string;
    visionModel: string;
    visionIssue: string;
    planningModel?: string;
    planningIssue?: string;
    projectId?: string;
    config: AiConfig;
    draft: EcommerceDraft;
    images: { resourceId: string; name: string }[];
    initialImage?: string;
    uploading: boolean;
    projectBusy?: boolean;
    factsBusy?: boolean;
    savedFacts?: string[];
    onSaveFacts?: SaveProductFacts;
    onUpload: (file: File) => Promise<string | undefined>;
    ensureProject: () => Promise<string>;
    view: "create" | "works";
    onViewChange: (view: "create" | "works") => void;
    onLockChange: (locked: boolean) => void;
    editCache: RefObject<ProductVideoDraft | null>;
};

export type { ProductVideoDraft } from "./product-video-draft";

const imageOnly = ["image"] as const;

function frameAvailability(scope: string, id?: string) {
    return {
        queryKey: ["ecommerce-video-frame", scope, id],
        queryFn: async () => {
            if (!id) return false;
            const resource = await refreshResource(id);
            return resource.id === id && resource.userId === scope && resource.kind === "image" && resource.status === "ready" && resource.mimeType.startsWith("image/");
        },
        retry: false,
    };
}

export function ProductVideoWorkspace(props: Props) {
    return <ProductVideoDraftLoader key={JSON.stringify([props.scope, props.sessionId])} {...props} />;
}

function ProductVideoDraftLoader(props: Props) {
    const [{ scope, sessionId, projectId }] = useState(() => ({ scope: props.scope, sessionId: props.sessionId, projectId: props.projectId }));
    const [loaded, setLoaded] = useState<{ draft: ProductVideoDraft | null } | null>(() => {
        const cached = props.editCache.current;
        return cached?.scope === scope && cached.sessionId === sessionId && cached.projectId === projectId ? { draft: cached } : null;
    });
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        if (loaded) return;
        let active = true;
        void readProductVideoDraft(scope, sessionId, projectId).then(
            (draft) => {
                if (active) setLoaded({ draft });
            },
            () => {
                if (active) setFailed(true);
            },
        );
        return () => {
            active = false;
        };
    }, [scope, sessionId, projectId, loaded, attempt]);
    if (loaded) return <ProductVideoEditor {...props} saved={loaded.draft} />;

    return (
        <section className="ec-studio-panel ec-video" aria-label="商品视频">
            {failed ? (
                <p role="alert">
                    本机视频草稿读取失败。{" "}
                    <Button
                        size="small"
                        onClick={() => {
                            setFailed(false);
                            setAttempt((value) => value + 1);
                        }}
                    >
                        重新读取
                    </Button>
                </p>
            ) : (
                <p role="status">正在读取本机视频草稿…</p>
            )}
        </section>
    );
}

function initialVideoScript(saved?: ProductVideoScriptDraft | null): ProductVideoScriptDraft {
    return { purpose: saved?.purpose ?? "showcase", candidateId: saved?.candidateId ?? saved?.story?.approachId ?? "", story: saved?.story ?? null, picking: saved?.picking ?? !saved?.story, voice: saved?.voice ?? "" };
}

function ProductVideoEditor({
    scope,
    sessionId,
    visionModel,
    visionIssue,
    planningModel,
    planningIssue,
    projectId,
    config,
    draft,
    images,
    initialImage,
    uploading,
    projectBusy,
    factsBusy,
    savedFacts,
    onSaveFacts,
    onUpload,
    ensureProject,
    view,
    onViewChange,
    onLockChange,
    editCache,
    saved,
}: Props & { saved: ProductVideoDraft | null }) {
    const queryClient = useQueryClient();
    const [chosenImage, setChosenImage] = useState(initialImage || saved?.chosenImage || images[0]?.resourceId || "");
    const [libraryFrame, setLibraryFrame] = useState(saved?.libraryFrame);
    const [selectedProductImages, setProductImages] = useState<ProductVideoVersion["productImages"]>(() => {
        const handoff = initialImage && images.find((item) => item.resourceId === initialImage);
        if (handoff && !saved?.productImages?.some((image) => image.resourceId === handoff.resourceId)) return [handoff, ...(saved?.productImages ?? [])].slice(0, 3);
        if (saved?.productImages !== undefined) return saved.productImages;
        if (saved?.mode === "image" && saved.chosenImage) {
            const previous = saved.libraryFrame?.resourceId === saved.chosenImage ? saved.libraryFrame : images.find((image) => image.resourceId === saved.chosenImage);
            return [previous ?? { resourceId: saved.chosenImage, name: "已选商品图" }];
        }
        return images[0] ? [images[0]] : undefined;
    });
    const productImages = selectedProductImages ?? images.slice(0, 1);
    const [productImagesBusy, setProductImagesBusy] = useState(false);
    const [framePickerOpen, setFramePickerOpen] = useState(false);
    const [enlargedFrame, setEnlargedFrame] = useState<ProductVideoDraft["libraryFrame"]>();
    const enlargeTrigger = useRef<HTMLButtonElement>(null);
    const [composingFrame, setComposingFrame] = useState(false);
    const materialsPanel = useRef<HTMLDivElement>(null);
    const [chosenModel, setChosenModel] = useState(saved?.chosenModel || config.videoModel);
    const [selectedRegion, setRegion] = useState(saved?.region);
    const [selectedLanguage, setLanguage] = useState(saved?.language);
    const [selectedRatio, setRatio] = useState(saved?.ratio);
    const [facts, setFacts] = useState(saved?.facts ?? draft.claims ?? "");
    const [targetAudience, setTargetAudience] = useState(saved?.targetAudience);
    const [shootBrief, setShootBrief] = useState<ProductVideoShootBrief | undefined>(saved?.shootBrief);
    const legacyReference = saved?.mode === "reference" && !saved.referenceScript;
    const [salesScript, setSalesScript] = useState(() => {
        const script = initialVideoScript(legacyReference ? null : saved);
        if (saved?.mode === "presenter" && saved.presenterVoice === undefined) script.voice = "";
        return script;
    });
    const [referenceScript, setReferenceScript] = useState(() => initialVideoScript(legacyReference ? saved : saved?.referenceScript));
    const [presenterVoice, setPresenterVoice] = useState(saved?.presenterVoice ?? (saved?.mode === "presenter" ? saved.voice : ""));
    const [showMaterials, setShowMaterials] = useState(false);
    const [planningShortcut, setPlanningShortcut] = useState<ScriptTarget | null>(null);
    const [mode, setMode] = useState<ProductVideoMode>(saved?.mode ?? "image");
    const salesMode = mode === "image";
    const [salesScriptOpen, setSalesScriptOpen] = useState(Boolean(saved?.revisionSource && saved?.mode === "image"));
    const [remixScriptOpen, setRemixScriptOpen] = useState(Boolean(saved?.mode === "reference" && (saved.revisionSource || referenceScript.story?.edited)));
    const [resetRemix, setResetRemix] = useState(false);
    const [pendingSalesPreset, setPendingSalesPreset] = useState<{ purpose: ProductVideoPurpose; approach: ProductVideoApproach } | null>(null);
    const keepSalesScript = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (pendingSalesPreset) keepSalesScript.current?.focus();
    }, [pendingSalesPreset]);
    const [presenterInput, setPresenterInput] = useState<"cast" | "photo">(saved?.presenterInput ?? "photo");
    const [presenterScriptOpen, setPresenterScriptOpen] = useState(Boolean(saved?.mode === "presenter" && (saved.step === "script" || saved.revisionSource || saved.presenterStory?.edited)));
    const [presenterPhoto, setPresenterPhoto] = useState<ProductVideoVersion["frame"] | undefined>(() => {
        if (saved?.presenterPhoto !== undefined) return saved.presenterPhoto ?? undefined;
        const id = saved?.presenter?.frameResourceId || (saved?.mode === "presenter" && saved.presenterInput !== "cast" ? saved.chosenImage : undefined);
        if (!id) return undefined;
        if (saved?.libraryFrame?.resourceId === id) return { ...saved.libraryFrame, source: saved.libraryFrame.source ?? "library" };
        return images.find((image) => image.resourceId === id) ?? { resourceId: id, name: "已选同框图" };
    });
    const stageGrid = useRef<HTMLDivElement>(null);
    const [delivery, setDelivery] = useState<ProductVideoPresenter["delivery"]>(saved?.presenter?.delivery ?? "recommend");
    const [confirmedFrame, setConfirmedFrame] = useState(saved?.presenter?.frameResourceId);
    const [previewedFrame, setPreviewedFrame] = useState("");
    const [presenterStory, setPresenterStory] = useState<ProductVideoStory | null>(saved?.presenterStory ?? null);
    const presenterMode = mode === "presenter";
    const castingPresenter = presenterMode && presenterInput === "cast";
    const remixEnabled = mode === "reference";
    const { purpose, candidateId = "", story: basicStory } = remixEnabled ? referenceScript : salesScript;
    const setScript = remixEnabled ? setReferenceScript : setSalesScript;
    const voice = presenterMode ? presenterVoice : (remixEnabled ? referenceScript : salesScript).voice;
    function setVoice(value: string) {
        if (presenterMode) setPresenterVoice(value);
        else setScript((previous) => ({ ...previous, voice: value }));
        setReview(null);
    }
    function setStory(story: ProductVideoStory) {
        if (presenterMode) setPresenterStory(story);
        else setScript((previous) => ({ ...previous, story }));
    }
    const [referenceVideo, setReferenceVideo] = useState<ProductVideoReference | undefined>(saved?.referenceVideo);
    const [referencePreset, setReferencePreset] = useState<VideoRemixPreset | undefined>(saved?.referencePreset);
    const [readingReference, setReadingReference] = useState(false);
    const [revisionSource, setSource] = useState(saved?.revisionSource);
    const sourceMode = revisionSource?.version.presenter ? "presenter" : revisionSource?.version.referenceVideo ? "reference" : "image";
    const source = mode === sourceMode ? revisionSource : undefined;
    const [replaceWith, setReplaceWith] = useState<VideoRevisionSource | null>(null);
    const [olderWorks, setOlderWorks] = useState<GenerationTask[]>([]);
    const [loadingSource, setLoadingSource] = useState(false);
    const focusSource = useRef("");
    const [checking, setChecking] = useState(false);
    const [unmatched, setUnmatched] = useState(false);
    const submission = useProductVideoSubmission(scope, projectId);
    const [submittingAnalysis, setSubmittingAnalysis] = useState(false);
    const [submittingPlan, setSubmittingPlan] = useState(false);
    const [saveFailed, setSaveFailed] = useState(false);
    const [saveAttempt, setSaveAttempt] = useState(0);
    const lastSnapshot = useRef<string | undefined>(undefined);
    useEffect(() => {
        const next = {
            scope,
            projectId,
            sessionId,
            chosenImage,
            libraryFrame,
            productImages: selectedProductImages,
            chosenModel,
            region: selectedRegion,
            language: selectedLanguage,
            ratio: selectedRatio,
            referencePreset,
            facts,
            ...salesScript,
            referenceScript,
            presenterVoice,
            targetAudience,
            shootBrief,
            mode,
            presenterInput,
            presenterPhoto: presenterPhoto ?? null,
            presenter: { delivery, frameResourceId: confirmedFrame },
            presenterStory,
            referenceVideo,
            revisionSource,
        };
        editCache.current = next;
        const signature = JSON.stringify(next);
        const previous = lastSnapshot.current;
        lastSnapshot.current = signature;
        if (previous === signature || (previous === undefined && !saved && !initialImage && !saveAttempt)) return;
        let active = true;
        void writeProductVideoDraft(next).then(
            () => {
                if (active) setSaveFailed(false);
            },
            () => {
                if (active) setSaveFailed(true);
            },
        );
        return () => {
            active = false;
        };
    }, [
        editCache,
        scope,
        projectId,
        sessionId,
        chosenImage,
        libraryFrame,
        selectedProductImages,
        chosenModel,
        selectedRegion,
        selectedLanguage,
        selectedRatio,
        referencePreset,
        facts,
        salesScript,
        referenceScript,
        presenterVoice,
        targetAudience,
        shootBrief,
        mode,
        presenterInput,
        presenterPhoto,
        delivery,
        confirmedFrame,
        presenterStory,
        referenceVideo,
        revisionSource,
        initialImage,
        saved,
        saveAttempt,
    ]);
    const [review, setReview] = useState<{ key: string; quote: LogicalModelQuote } | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [receipt, setReceipt] = useState<GenerationTask | null>(null);
    const lock = useRef(false);
    const fileInput = useRef<HTMLInputElement>(null);
    const lifetime = useRef<AbortController | null>(null);
    useEffect(() => {
        const controller = new AbortController();
        lifetime.current = controller;
        return () => controller.abort();
    }, []);

    const originalScene = source ? source.version.shootBrief?.scene || "" : draft.scene;
    const scene =
        shootBrief?.scene ??
        Array.from(originalScene || "")
            .slice(0, 240)
            .join("");
    const closing = shootBrief?.closing || "";
    const shooting: ProductVideoShootBrief | undefined = scene.trim() || closing.trim() ? { ...(scene.trim() && { scene: scene.trim() }), ...(closing.trim() && { closing: closing.trim() }) } : undefined;
    const brief = {
        ...draft,
        scene,
        audience: targetAudience ?? source?.version.audience ?? draft.audience,
        productName: source?.version.productName ?? draft.productName,
        language: (selectedLanguage ?? source?.version.language ?? draft.language) || "zh-CN",
        region: selectedRegion ?? (source ? source.version.region || "" : draft.region || ""),
    };
    const salesApproaches = salesMode && (!basicStory || (basicStory.followBrief && !basicStory.edited && salesVideoStyle(basicStory.approachId))) ? productSalesVideoApproaches(basicStory?.purpose ?? purpose, brief, facts, closing) : undefined;
    const salesPreset = salesApproaches?.find((item) => item.id === (basicStory?.approachId || candidateId)) ?? salesApproaches?.[0];
    const reference = remixEnabled ? referenceVideo : undefined;
    const automaticRemix = reference ? buildVideoRemixStory(reference, brief, facts, closing) : null;
    const story: ProductVideoStory | null = presenterMode
        ? (presenterStory ?? defaultPresenterStory(delivery))
        : remixEnabled
          ? (referenceScript.story ?? automaticRemix)
          : salesPreset
            ? { purpose: basicStory?.purpose ?? purpose, approachId: salesPreset.id, shots: salesPreset.shots, edited: false, followBrief: true }
            : basicStory;
    function applySalesPreset(nextPurpose: ProductVideoPurpose, approach: ProductVideoApproach) {
        const nextStory: ProductVideoStory = { purpose: nextPurpose, approachId: approach.id, shots: [...approach.shots], edited: false, followBrief: true };
        setSalesScript((previous) => ({ ...previous, purpose: nextPurpose, candidateId: approach.id, story: nextStory, picking: false }));
        setPendingSalesPreset(null);
        setReview(null);
        setError("");
    }
    function chooseSalesPreset(nextPurpose: ProductVideoPurpose, approach: ProductVideoApproach) {
        if (locked || (story?.approachId === approach.id && !pendingSalesPreset)) return;
        if (story?.edited) setPendingSalesPreset({ purpose: nextPurpose, approach });
        else applySalesPreset(nextPurpose, approach);
    }
    function resolveSalesPreset(replace: boolean) {
        if (!pendingSalesPreset) return;
        if (replace) applySalesPreset(pendingSalesPreset.purpose, pendingSalesPreset.approach);
        else setPendingSalesPreset(null);
        requestAnimationFrame(() => {
            const gallery = stageGrid.current?.querySelector(".ec-sales-gallery");
            (gallery?.querySelector<HTMLInputElement>("input:checked") || gallery?.querySelector<HTMLInputElement>("input"))?.focus();
        });
    }
    const activeLibraryFrame = presenterMode ? (presenterPhoto?.source ? presenterPhoto : undefined) : libraryFrame?.resourceId === chosenImage ? libraryFrame : undefined;
    const fromLibrary = !salesMode && Boolean(activeLibraryFrame);
    const useBoardImages = salesMode && Boolean(story?.boardInputs && story.boards?.some((shot) => shot.frame));
    const frame = salesMode
        ? productImages[0]
        : presenterMode
          ? (activeLibraryFrame ?? images.find((image) => image.resourceId === presenterPhoto?.resourceId))
          : (activeLibraryFrame ?? images.find((image) => image.resourceId === chosenImage) ?? (source || chosenImage ? undefined : images[0]));
    const presenter = presenterMode && !castingPresenter && frame && frame.resourceId === confirmedFrame ? { frameResourceId: frame.resourceId, delivery } : undefined;
    const checkedFrameID = !castingPresenter && (presenterMode || fromLibrary || reference) ? frame?.resourceId : undefined;
    const frameStatus = useQuery({
        ...frameAvailability(scope, checkedFrameID),
        enabled: Boolean(checkedFrameID) && view === "create",
        staleTime: 15_000,
        refetchOnMount: "always",
    });
    const referenceStatus = useQuery({
        queryKey: ["ecommerce-video-input", scope, mode, reference?.resourceId, reference?.durationMs],
        enabled: Boolean(reference) && view === "create",
        retry: false,
        queryFn: async () => {
            if (!reference) return false;
            const resource = await refreshResource(reference.resourceId);
            return resource.id === reference.resourceId && resource.userId === scope && resource.status === "ready" && resource.kind === "video" && resource.durationMs === reference.durationMs;
        },
    });
    const inputImages = productVideoShotImages(salesMode ? productImages : frame, useBoardImages ? story?.boards : undefined);
    const productImageCount = salesMode ? productImages.length : 0;
    const usesReferences = salesMode || Boolean(reference);
    const frameLabel = presenterMode ? "人货同框图" : "商品参考图";
    const salesVoiceMode = salesMode ? salesVideoStyle(story?.approachId)?.voiceMode : undefined;
    const salesNeedsAudio = salesVoiceMode === "host" || salesVoiceMode === "voiceover";
    const outputVoice = salesVoiceMode === "silent" ? "" : voice;
    const needsAudio = presenterMode || salesNeedsAudio || (remixEnabled && Boolean(outputVoice.trim()));
    const models = presenterMode ? productVideoPresenterModels(config) : remixEnabled && !reference ? [] : productVideoModels(config, reference, inputImages.length, needsAudio, salesMode);
    const model = models.includes(chosenModel) ? chosenModel : source ? undefined : models[0];
    const historical = source?.version.settings;
    const ratio = productVideoRatio(config, model, selectedRatio ?? historical?.ratio, presenterMode);
    const settings =
        model && !ratio.unavailable
            ? productVideoConfig(config, model, presenterMode || salesNeedsAudio || Boolean(outputVoice.trim()), { ratio: ratio.value, resolution: model === source?.version.model ? historical?.resolution : undefined }, presenterMode)
            : undefined;
    const requirements = productVideoRequirementsFor(reference, inputImages.length, needsAudio, salesMode);
    const quoteRequest = model && settings && systemModelQuoteRequest(settings, model, "video", requirements);
    const prompt = story
        ? productVideoPrompt(
              brief,
              facts,
              productShotScript(story.shots, story.boards, inputImages, productImageCount),
              outputVoice,
              reference,
              presenter,
              shooting,
              fromLibrary && activeLibraryFrame?.source === "composite",
              inputImages.length,
              salesVoiceMode,
              productImageCount,
          )
        : "";
    const key = JSON.stringify([inputImages.map((image) => image.resourceId), mode, reference, presenter, model, prompt, quoteRequest, story?.boards]);
    const quote = review?.key === key ? review.quote : null;
    function unavailableReason() {
        if (castingPresenter) return "先合成并选用同框图，或使用已有同框图";
        if (!frame) {
            if (presenterMode) return "请选择人物和商品同时入镜的照片";
            if (salesMode) return "请添加 1–3 张商品参考图";
            if (source) return remixEnabled ? "原商品参考图已不在项目中，请重新选择或上传商品图" : "原首帧已不在项目中，请重新选择或上传商品图";
            return `请添加或选择${frameLabel}`;
        }
        if (remixEnabled && !reference) return "请添加一段参考视频";
        if (checkedFrameID && frameStatus.isFetching) return `正在核对${frameLabel}…`;
        if (checkedFrameID && (frameStatus.isError || !frameStatus.data)) return `${frameLabel}当前不可用，请重新核对或更换图片`;
        if (reference && referenceStatus.isFetching) return "正在核对参考视频…";
        if (reference && (referenceStatus.isError || !referenceStatus.data)) return "参考视频当前不可用，请重新核对或更换视频";
        if (presenterMode && !presenter) return "请先确认人物和商品的同框图";
        if (presenterMode && !voice.trim()) return "请填写出镜人物要说的台词";
        if (!story) return "请准备分镜脚本";
        if (!model) {
            if (source && models.length) return "原视频模型已不可用，请在生成设置中选择模型";
            if (presenterMode) return "需要支持首帧和 15 秒有声输出的视频模型";
            if (remixEnabled && needsAudio) return "没有兼容所选素材的有声复刻模型。可清空旁白生成无声视频，或选择支持同步音频的模型。";
            if (salesNeedsAudio) return "当前没有同时支持所选商品图和 15 秒有声输出的视频模型。可改选无口播的「使用演示」或「选购对照」。";
            if (salesMode) return `当前没有支持 ${inputImages.length} 张商品参考图和 15 秒输出的模型。${inputImages.length > 1 ? "可减少参考图后再试。" : "请配置支持参考图生成的视频模型。"}`;
            return remixEnabled ? "没有模型能同时接收这张商品图和该时长的参考视频，并输出 15 秒短片" : "需要支持单张商品图和 15 秒输出的系统视频模型";
        }
        if (story.shots.some((shot) => !shot.trim())) return "请填写三段分镜";
        if (ratio.unavailable) return "请按当前视频模型重新选择可用比例";
        return modelPromptLengthError(config, model, "video", prompt) || (!quoteRequest ? "当前规格无法报价" : "");
    }
    const reason = pendingSalesPreset && salesMode ? "请先选择保留或替换当前分镜" : remixEnabled && resetRemix ? "请先选择保留当前分镜或恢复自动分镜" : unavailableReason();
    const quoteBreakdown = reference && quote ? referenceVideoQuoteBreakdown(quote.referenceVideo) : "";
    const quotedCost = quote && [`${quote.estimated ? "预估" : "报价"} ${quote.amountMicrocredits / 1_000_000} 积分`, quoteBreakdown || "1 条视频", quote.billingMode === "token" ? "按实际用量结算" : ""].filter(Boolean).join(" · ");
    const otherWorkBusy = Boolean(projectBusy || busy || uploading || submittingAnalysis || submittingPlan || readingReference || productImagesBusy);
    const locked = otherWorkBusy || composingFrame;
    useEffect(() => {
        onLockChange(busy || submittingAnalysis || submittingPlan || readingReference || framePickerOpen || composingFrame || productImagesBusy);
        return () => onLockChange(false);
    }, [onLockChange, busy, submittingAnalysis, submittingPlan, readingReference, framePickerOpen, composingFrame, productImagesBusy]);

    const history = useQuery({
        queryKey: ["ecommerce-product-videos", scope, projectId],
        enabled: Boolean(projectId) && view === "works",
        queryFn: async ({ signal }) => (await listGenerationTasks(100, { projectId }, undefined, signal)).filter((item) => item.type === "canvas_video"),
        refetchOnMount: "always",
        refetchInterval: (query) => (query.state.data?.some((item) => item.status === "queued" || item.status === "running") ? 2000 : false),
    });
    const recent = history.data || [];
    const listed = receipt && !recent.some((item) => item.id === receipt.id) ? [receipt, ...recent] : recent;
    const videos = [...listed, ...olderWorks.filter((old) => !listed.some((item) => item.id === old.id))].filter((task) => task.projectId === projectId && task.type === "canvas_video");
    const worksById = new Map(videos.map((item) => [item.id, item]));

    useEffect(() => {
        if (!focusSource.current || view !== "works") return;
        document.getElementById(`ec-video-work-${focusSource.current}`)?.focus();
        focusSource.current = "";
    }, [olderWorks, view]);

    async function openSource(id: string) {
        if (!projectId || loadingSource) return;
        const signal = lifetime.current!.signal;
        setError("");
        setLoadingSource(true);
        try {
            const found = await queryGenerationTask(id, { signal });
            signal.throwIfAborted();
            if (found.id !== id || !productVideoVersionForTask(found, projectId)) throw new Error();
            focusSource.current = id;
            setOlderWorks((items) => [...items.filter((item) => item.id !== id), found]);
        } catch {
            if (!signal.aborted) setError("暂时无法读取这条来源作品，请刷新后再试。");
        } finally {
            if (!signal.aborted) setLoadingSource(false);
        }
    }

    function applyWorkScript(next: VideoRevisionSource) {
        const version = next.version;
        setSource(next);
        setPresenterScriptOpen(Boolean(version.presenter));
        setSalesScriptOpen(!version.presenter && !version.referenceVideo);
        setRemixScriptOpen(Boolean(version.referenceVideo));
        setResetRemix(false);
        setPendingSalesPreset(null);
        const nextStory = { purpose: version.purpose, approachId: version.approachId, shots: [...version.shots], boards: version.boards, boardInputs: version.boardInputs, edited: true };
        if (version.presenter) {
            setPresenterStory(nextStory);
            setPresenterVoice(version.voice);
        } else {
            const selectScript = version.referenceVideo ? setReferenceScript : setSalesScript;
            selectScript({ purpose: version.purpose, candidateId: version.approachId, story: nextStory, picking: false, voice: version.voice });
        }
        setFacts(version.facts);
        setShootBrief(version.shootBrief);
        setTargetAudience(version.audience);
        setRegion(version.region || "");
        setLanguage(version.language || "zh-CN");
        setRatio(version.settings.ratio);
        setReferencePreset(version.referenceVideo && matchVideoRemixPreset(version.referenceVideo));
        setMode(version.presenter ? "presenter" : version.referenceVideo ? "reference" : "image");
        if (version.presenter) {
            setPresenterInput("photo");
            setPresenterPhoto(version.frame);
            setDelivery(version.presenter.delivery);
            setConfirmedFrame(version.presenter.frameResourceId);
        }
        if (version.referenceVideo) setReferenceVideo(version.referenceVideo);
        if (!version.presenter && !version.referenceVideo) setProductImages(version.productImages ?? [version.frame]);
        else if (version.referenceVideo) {
            setLibraryFrame(version.frame.source ? version.frame : undefined);
            setChosenImage(version.frame.resourceId);
        }
        setChosenModel(version.model);
        setReview(null);
        setReplaceWith(null);
        setError("");
        onViewChange("create");
    }

    function derive(task: GenerationTask, shotIndex: 0 | 1 | 2, note?: string, atSeconds?: number) {
        if (locked || !projectId) return;
        const version = productVideoVersionForTask(task, projectId);
        if (!version) return;
        const next = { taskId: task.id, title: task.clientContext?.assetTitle || "商品视频", version, shotIndex, note, atSeconds };
        const sameDraft =
            story?.purpose === version.purpose &&
            story.approachId === version.approachId &&
            story.shots.every((shot, i) => shot === version.shots[i]) &&
            sameBoards(story.boards, version.boards) &&
            useBoardImages === Boolean(version.boardInputs) &&
            (!salesMode || JSON.stringify(productImages.map((image) => image.resourceId)) === JSON.stringify((version.productImages ?? [version.frame]).map((image) => image.resourceId))) &&
            (shooting?.scene || "") === (version.shootBrief?.scene || "") &&
            (shooting?.closing || "") === (version.shootBrief?.closing || "") &&
            brief.audience === version.audience &&
            brief.region.trim() === (version.region || "") &&
            brief.language === (version.language || "zh-CN") &&
            ratio.value === version.settings.ratio &&
            facts === version.facts &&
            outputVoice === version.voice &&
            remixEnabled === Boolean(version.referenceVideo) &&
            presenterMode === Boolean(version.presenter) &&
            presenter?.frameResourceId === version.presenter?.frameResourceId &&
            presenter?.delivery === version.presenter?.delivery &&
            JSON.stringify(reference) === JSON.stringify(version.referenceVideo) &&
            frame?.resourceId === version.frame.resourceId &&
            model === version.model;
        const hasDraft = Boolean(
            basicStory ||
            presenterStory ||
            shootBrief ||
            targetAudience !== undefined ||
            selectedRegion !== undefined ||
            selectedLanguage !== undefined ||
            selectedRatio !== undefined ||
            referencePreset !== undefined ||
            confirmedFrame ||
            (version.presenter && (presenterPhoto || presenterVoice.trim() || delivery !== "recommend")) ||
            remixEnabled ||
            referenceVideo ||
            voice.trim() ||
            facts !== (draft.claims || "") ||
            (chosenImage && chosenImage !== images[0]?.resourceId) ||
            (salesMode && (productImages.length > 1 || productImages[0]?.resourceId !== images[0]?.resourceId)) ||
            chosenModel !== config.videoModel ||
            candidateId ||
            purpose !== "showcase" ||
            source,
        );
        if (hasDraft && (!sameDraft || (source?.note && (next.note !== source.note || task.id !== source.taskId)))) setReplaceWith(next);
        else applyWorkScript(next);
    }

    async function checkSubmission() {
        if (!submission.pending || !projectId || checking) return;
        const signal = lifetime.current!.signal;
        setChecking(true);
        setError("");
        try {
            const tasks = await listGenerationTasks(100, { projectId }, undefined, signal);
            signal.throwIfAborted();
            const match = tasks.find((item) => item.type === "canvas_video" && item.projectId === projectId && item.clientOperationId === submission.pending);
            if (match) {
                submission.finish(projectId, submission.pending);
                setReceipt(match);
                setUnmatched(false);
                onViewChange("works");
                void queryClient.invalidateQueries({ queryKey: ["ecommerce-product-videos", scope, projectId] });
            } else {
                setUnmatched(true);
                setError("近期任务里尚未找到这次提交。可以稍后再查，或在任务中心核对。");
            }
        } catch {
            if (!signal.aborted) setError("暂时无法核对视频任务，请稍后再试。");
        } finally {
            if (!signal.aborted) setChecking(false);
        }
    }

    async function reviewOrSubmit() {
        if (lock.current || locked || submission.pending || reason || !quoteRequest || !settings || !frame || !story || !model) return;
        const signal = lifetime.current!.signal;
        let sent: { id: string; operationId: string } | undefined;
        lock.current = true;
        setBusy(true);
        setError("");
        try {
            const version: ProductVideoVersion = {
                schema: 1,
                frame: salesMode ? productImages[0] : { resourceId: frame.resourceId, name: frame.name, ...(fromLibrary && { source: activeLibraryFrame?.source ?? ("library" as const) }) },
                ...(salesMode && { productImages }),
                referenceVideo: reference,
                presenter,
                model,
                facts,
                purpose: story.purpose,
                approachId: story.approachId,
                shots: [...story.shots],
                ...(story.boards && { boards: story.boards }),
                ...(useBoardImages && { boardInputs: true }),
                ...(shooting && { shootBrief: shooting }),
                voice: outputVoice,
                productName: brief.productName,
                audience: brief.audience,
                language: brief.language,
                ...(brief.region.trim() && { region: brief.region.trim() }),
                settings: { seconds: 15, ratio: settings.size || "auto", resolution: settings.vquality || "auto", generateAudio: settings.videoGenerateAudio === "true" },
                parentTaskId: source?.taskId,
            };
            if (!isProductVideoVersion(version)) throw new Error("当前分镜或商品素材无法保存到作品，请检查素材和文案后重试。");
            if (salesMode) {
                const available = await Promise.all(inputImages.map((image) => queryClient.fetchQuery({ ...frameAvailability(scope, image.resourceId), staleTime: 0 })));
                signal.throwIfAborted();
                const missing = available.indexOf(false);
                if (missing >= 0) {
                    setReview(null);
                    throw new Error(`参考图 ${missing + 1}「${inputImages[missing].name}」当前不可用，请更换图片后重新报价。`);
                }
            }
            if (!salesMode && (checkedFrameID || reference)) {
                const [imageCheck, videoCheck] = await Promise.all([checkedFrameID ? frameStatus.refetch() : undefined, reference ? referenceStatus.refetch() : undefined]);
                signal.throwIfAborted();
                if ((imageCheck && (imageCheck.isError || !imageCheck.data)) || (videoCheck && (videoCheck.isError || !videoCheck.data))) {
                    setReview(null);
                    throw new Error(imageCheck && (imageCheck.isError || !imageCheck.data) ? `${frameLabel}当前不可用，请重新选择。` : "参考视频已失效或时长有变化，请重新选择。");
                }
            }
            const fresh = (await quoteModel(quoteRequest, signal)).quote;
            signal.throwIfAborted();
            if (!Number.isSafeInteger(fresh.amountMicrocredits) || fresh.amountMicrocredits < 0) throw new Error("模型报价无效，请重新获取");
            if (!quote || fresh.amountMicrocredits !== quote.amountMicrocredits || fresh.billingMode !== quote.billingMode || fresh.estimated !== quote.estimated || (reference && referenceVideoQuoteBreakdown(fresh.referenceVideo) !== quoteBreakdown)) {
                setReview({ key, quote: fresh });
                if (quote) setError("报价已更新，请核对后确认。");
                return;
            }
            const id = await ensureProject();
            signal.throwIfAborted();
            const operationId = createClientUUID();
            const input = await prepareBackendGenerationTask({
                projectId: id,
                mode: "video",
                prompt,
                config: settings,
                signal,
                clientOperationId: operationId,
                referenceImages: inputImages.map((image) => ({ id: image.resourceId, name: image.name, type: "image/*", dataUrl: "", role: usesReferences ? "reference" : "first_frame", storageKey: resourceStorageKey(image.resourceId) })),
                ...(reference && { referenceVideos: [{ id: reference.resourceId, name: reference.name, type: "video/*", url: "", durationMs: reference.durationMs, role: "reference" as const, storageKey: resourceStorageKey(reference.resourceId) }] }),
                metadata: {
                    source: "ecommerce-agent",
                    ecommerceProjectId: id,
                    stage: "product-video",
                    assetTitle: `${brief.productName.trim() || "商品"} · ${source ? "改版短片" : presenter ? "人物口播" : reference ? "参考复刻短片" : "带货短片"}`,
                    ecommerceVideoVersion: version,
                    videoEditOperation: requirements.videoOperation,
                    ...(!usesReferences && { videoStartFrameNodeId: frame.resourceId }),
                    ecommerceVideoQuote: { billingMode: fresh.billingMode, amountMicrocredits: fresh.amountMicrocredits },
                },
            });
            signal.throwIfAborted();
            submission.start(id, operationId);
            sent = { id, operationId };
            const task = await createGenerationTask(input);
            if (signal.aborted) return;
            if (!task.id || (task.projectId && task.projectId !== id) || (task.clientOperationId && task.clientOperationId !== operationId)) throw new Error("缺少匹配的视频任务回执");
            submission.finish(id, operationId);
            setUnmatched(false);
            setReceipt(task);
            setReview(null);
            onViewChange("works");
            void queryClient.invalidateQueries({ queryKey: ["ecommerce-product-videos", scope, id] });
        } catch (cause) {
            if (signal.aborted) return;
            if (!sent) setReview(null);
            if (sent && (!(cause instanceof ApiError) || !cause.status || [408, 409].includes(cause.status) || cause.status >= 500)) {
                setReview(null);
                onViewChange("works");
            } else {
                if (sent) {
                    submission.finish(sent.id, sent.operationId);
                    setReview(null);
                }
                setError(cause instanceof Error ? cause.message : "操作失败，请重试");
            }
        } finally {
            lock.current = false;
            if (!signal.aborted) setBusy(false);
        }
    }

    function chooseFrame(id: string, libraryImage?: ProductVideoDraft["libraryFrame"]) {
        setReview(null);
        if (presenterMode) {
            if (frame?.resourceId !== id) {
                setConfirmedFrame(undefined);
                setPreviewedFrame("");
            }
            setPresenterPhoto(libraryImage ? { ...libraryImage, source: libraryImage.source ?? "library" } : (images.find((image) => image.resourceId === id) ?? { resourceId: id, name: "已选同框图" }));
            return;
        }
        setLibraryFrame(libraryImage);
        setChosenImage(id);
    }
    async function pickLibraryFrame([asset]: PickedWorkbenchAsset[]) {
        const session = captureUserSession();
        const signal = lifetime.current?.signal;
        const candidate = asset && { resourceId: asset.resourceId, name: asset.name };
        if (!signal || signal.aborted || session.scope !== scope || scope === "guest") throw new Error("创作会话已切换，请重新选择。");
        if (asset?.kind !== "image" || !isProductVideoFrame(candidate) || !(await queryClient.fetchQuery({ ...frameAvailability(scope, candidate.resourceId), staleTime: 0 }))) throw new Error("这张素材图片尚未就绪或无法访问，请选择其他图片。");
        signal.throwIfAborted();
        assertCurrentUserSession(session);
        chooseFrame(candidate.resourceId, candidate);
        setShowMaterials(true);
        setError("");
    }
    const compactFrame = presenterMode && frame && Boolean(presenter);
    const marketFields = (
        <ProductVideoMarket
            key={source?.taskId || "draft"}
            region={brief.region}
            language={brief.language}
            ratioSummary={ratio.unavailable ? "请重选比例" : ratio.value === "auto" ? "自动比例" : ratio.value === "adaptive" ? "自适应" : ratio.value}
            disabled={locked}
            onRegion={setRegion}
            onLanguage={setLanguage}
        >
            <ProductVideoRatioField selection={ratio} disabled={locked} onChange={setRatio} emptyLabel={remixEnabled && !reference ? "添加参考视频后显示" : !models.length ? "暂无兼容视频模型" : undefined} />
        </ProductVideoMarket>
    );
    const longPresenterVoice = presenterMode && (brief.language.startsWith("zh") ? (voice.match(/\p{Script=Han}/gu)?.length ?? 0) > 60 : brief.language === "en" && voice.trim().split(/\s+/u).length > 40);
    const voiceEditor = (
        <div className="ec-video-brief">
            <label className="ec-video-voice-label" htmlFor="ec-video-voice">
                <Mic size={15} aria-hidden />
                {presenterMode ? "人物台词" : remixEnabled ? "复刻旁白" : salesVoiceMode === "voiceover" ? "解说文案" : "口播文案"} <small>{presenterMode ? "必填" : "选填"}</small>
            </label>
            <Input.TextArea
                id="ec-video-voice"
                name="voice"
                required={presenterMode}
                aria-describedby={longPresenterVoice ? "ec-video-voice-length" : undefined}
                disabled={locked}
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                rows={presenterMode ? 3 : 2}
                placeholder={
                    presenterMode ? "写下人物在这 15 秒内要说的话。可以先说适合谁，再用一个商品细节说明原因。" : remixEnabled ? "想让观众听到什么？填写旁白后，可选择支持有声复刻的模型。" : "可以写下想说的话；留空会按成片语言，结合商品和卖点生成台词。"
                }
            />
            {longPresenterVoice && <small id="ec-video-voice-length">台词较长，建议先试读 15 秒，给展示商品留一点停顿。</small>}
            <div>
                <Button size="small" disabled={locked || !story} onClick={() => setPlanningShortcut("voice")}>
                    {presenterMode || (salesMode && salesVoiceMode === "host") ? "AI 起草台词" : "AI 起草旁白"}
                </Button>
            </div>
        </div>
    );

    const modeChooser = (
        <div className="ec-film-methods">
            <SegmentedControl<ProductVideoMode>
                ariaLabel="商品视频创作方式"
                value={mode}
                options={[
                    { value: "image", label: "带货视频" },
                    { value: "reference", label: "视频复刻" },
                    { value: "presenter", label: "人物口播" },
                ]}
                onChange={(value) => {
                    setMode(value);
                    setPendingSalesPreset(null);
                    setResetRemix(false);
                    setReview(null);
                    setError("");
                }}
                disabled={locked}
            />
        </div>
    );
    const imagePicker = (
        <div className="ec-film-material-source">
            {frame && compactFrame && (
                <button type="button" className="ec-video-mobile-frame" aria-controls="ec-video-materials" aria-expanded={showMaterials} onClick={() => setShowMaterials(!showMaterials)}>
                    <CachedResourceImage storageKey={resourceStorageKey(frame.resourceId)} variant="thumbnail" alt="" />
                    <span className="ec-video-frame-name">
                        <small>{presenterMode ? "已确认人货同框图" : "已选商品参考图"}</small>
                        <strong>{frame.name}</strong>
                    </span>
                    {showMaterials ? "收起" : "查看或更换"} <ChevronDown size={14} aria-hidden />
                </button>
            )}
            <div ref={materialsPanel} tabIndex={-1} id="ec-video-materials" className={compactFrame && !showMaterials ? "ec-video-materials is-compact" : "ec-video-materials"}>
                <div className="ec-video-row ec-video-source-heading">
                    <h2>{presenterMode ? "人货同框图" : "商品参考图"}</h2>
                    <div className="ec-video-frame-actions">
                        {frame && (
                            <Button size="small" type="text" icon={<ImagePlus size={15} aria-hidden />} disabled={locked} onClick={() => fileInput.current?.click()}>
                                {uploading ? "上传中…" : presenterMode ? "添加同框图" : "添加商品图"}
                            </Button>
                        )}
                        <Button htmlType="button" size="small" icon={<FolderOpen size={15} aria-hidden />} disabled={locked} aria-haspopup="dialog" aria-label={`从素材库选择${frameLabel}`} onClick={() => setFramePickerOpen(true)}>
                            从素材库选择
                        </Button>
                    </div>
                    <WorkbenchAssetPicker open={framePickerOpen} accept={imageOnly} maxCount={1} slotName={frameLabel} syncedOnly onPick={pickLibraryFrame} onClose={() => setFramePickerOpen(false)} />
                    <input
                        ref={fileInput}
                        hidden
                        type="file"
                        accept="image/*"
                        aria-label={`上传${frameLabel}`}
                        onChange={async (event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            if (!file) return;
                            try {
                                setError("");
                                const id = await onUpload(file);
                                if (id) chooseFrame(id);
                            } catch (cause) {
                                setError(cause instanceof Error ? cause.message : "商品图上传失败");
                            }
                        }}
                    />
                </div>
                <div className={frame ? "ec-video-frame ec-video-frame-ready" : "ec-video-frame ec-video-frame-empty"}>
                    {frame ? (
                        <>
                            <CachedResourceImage
                                key={frame.resourceId}
                                storageKey={resourceStorageKey(frame.resourceId)}
                                alt={frame.name}
                                eager={presenterMode && !presenter}
                                onLoad={() => setPreviewedFrame(frame.resourceId)}
                                onError={() => setPreviewedFrame("")}
                                loadingFallback={null}
                                fallback={<small>商品图预览暂不可用</small>}
                            />
                            <span className="ec-video-selected-caption">
                                {(!presenterMode || presenter) && <Check size={13} aria-hidden />}
                                {presenterMode ? (presenter ? "已确认首帧" : "待核对首帧") : frameLabel}
                                <span>{frame.name}</span>
                            </span>
                            <button type="button" className="ec-video-enlarge" aria-label={`放大查看${frameLabel}`} aria-haspopup="dialog" ref={enlargeTrigger} onClick={() => setEnlargedFrame(frame)}>
                                <Expand size={16} aria-hidden />
                            </button>
                        </>
                    ) : (
                        <button type="button" aria-label={presenterMode ? "选择人物与商品同框的照片" : `上传${frameLabel}`} disabled={locked} onClick={() => fileInput.current?.click()}>
                            <span className="ec-video-sample-photo" aria-hidden="true">
                                {presenterMode ? (
                                    <UserRound className="ec-presenter-empty-icon" aria-hidden />
                                ) : (
                                    <>
                                        <img src="/commerce/video-approaches/orbit.webp" alt="" width={480} height={300} />
                                        <span>示例图</span>
                                    </>
                                )}
                            </span>
                            <span className="ec-video-upload-copy">
                                <strong>{uploading ? "上传中…" : presenterMode ? "上传人货同框图" : "上传商品图"}</strong>
                                <span>{presenterMode ? "选择一张同时拍到出镜人物和商品的照片。" : "选择主体清晰的照片，成片展示这件商品。"}</span>
                                <span className="ec-video-upload-action">
                                    <ImagePlus size={15} aria-hidden />
                                    选择图片
                                </span>
                            </span>
                        </button>
                    )}
                </div>
                {images.length > 1 || ((!frame || fromLibrary) && images.length > 0) ? (
                    <>
                        <small>
                            从项目的 {images.length} 张图片中选择{frameLabel}
                        </small>
                        <div className="ec-video-thumbs" role="group" aria-label={`选择${frameLabel}`}>
                            {images.map((image) => (
                                <button type="button" key={image.resourceId} aria-label={image.name} aria-pressed={image.resourceId === frame?.resourceId} disabled={locked} onClick={() => chooseFrame(image.resourceId)}>
                                    <CachedResourceImage storageKey={resourceStorageKey(image.resourceId)} variant="thumbnail" alt="" />
                                </button>
                            ))}
                        </div>
                    </>
                ) : null}
            </div>
        </div>
    );
    const imageStatus = checkedFrameID && !frameStatus.isFetching && (frameStatus.isError || frameStatus.data === false) && (
        <div role="status">
            {frameLabel}当前不可用。
            <Button size="small" onClick={() => void frameStatus.refetch()}>
                重新核对图片
            </Button>
        </div>
    );
    const scriptEditor = (
        <>
            {source && (
                <aside className="ec-video-version-notice" aria-label="改稿来源">
                    <strong>改自「{source.title}」</strong>
                    {source.note && (
                        <p>
                            {source.atSeconds !== undefined ? `${Number(source.atSeconds.toFixed(1))} 秒 · ` : ""}
                            {productVideoBeats[source.shotIndex].title}修改意见：{source.note}
                        </p>
                    )}
                </aside>
            )}
            <ProductVideoStoryboard
                key={presenterMode ? "presenter" : "product"}
                active={salesMode ? salesScriptOpen : remixEnabled ? remixScriptOpen : presenterScriptOpen}
                projectImages={salesMode ? [...productImages, ...images.filter((image) => !productImages.some((selected) => selected.resourceId === image.resourceId))] : images}
                canReadFrame={(id) => queryClient.fetchQuery({ ...frameAvailability(scope, id), staleTime: 0 })}
                presenterMode={presenterMode}
                remix={remixEnabled}
                salesVideo={mode === "image"}
                facts={facts}
                closing={closing}
                draft={brief}
                initialShot={source?.shotIndex}
                frame={frame}
                frameLabel={frameLabel}
                purpose={purpose}
                onPurpose={(value) => setScript((previous) => ({ ...previous, purpose: value }))}
                candidateId={candidateId}
                onCandidate={(value) => setScript((previous) => ({ ...previous, candidateId: value }))}
                story={story}
                onChange={setStory}
                onAssist={setPlanningShortcut}
                picking={false}
                onPicking={(value) => setScript((previous) => ({ ...previous, picking: value }))}
                disabled={locked}
            />
        </>
    );
    const inputPreview = story && (
        <details className="ec-shoot-brief ec-video-shoot-review">
            <summary>
                <ChevronDown size={15} aria-hidden />
                <strong>预览生成内容</strong>
                <small>15 秒 · 3 镜</small>
            </summary>
            <dl>
                <dt>视频输入</dt>
                <dd>
                    {salesMode && inputImages.length ? inputImages.map((image, i) => `参考图 ${i + 1} · ${image.name || "已选图片"}`).join(" ／ ") : frame ? `${frameLabel} · ${frame.name || "已选图片"}` : `待添加${frameLabel}`}
                    {reference && ` ＋ 参考视频 · ${reference.name || "已选视频"}`}
                </dd>
                <dt>声音</dt>
                <dd>{salesVoiceMode ? salesVideoVoiceLabels[salesVoiceMode] : settings ? (settings.videoGenerateAudio === "true" ? "生成原生声音" : "无声视频") : "待选择视频模型"}</dd>
                <dt>拍摄指令</dt>
                <dd className="ec-video-shoot-prompt">{prompt}</dd>
            </dl>
        </details>
    );
    const briefEditor = (
        <ProductVideoShootBriefEditor
            draft={brief}
            facts={facts}
            scope={scope}
            sessionId={sessionId}
            projectId={projectId}
            config={config}
            model={planningModel || ""}
            unavailable={planningIssue || ""}
            ensureProject={ensureProject}
            setSubmitting={setSubmittingPlan}
            audience={brief.audience}
            brief={{ scene, closing }}
            onAudience={setTargetAudience}
            onChange={setShootBrief}
            disabled={locked}
        />
    );
    const planningEditor = story && (
        <ProductVideoPlanning
            salesVideo={mode === "image"}
            reference={reference}
            scope={scope}
            sessionId={sessionId}
            projectId={projectId}
            config={config}
            model={planningModel || ""}
            unavailable={planningIssue || ""}
            draft={brief}
            facts={facts}
            story={story}
            closing={closing}
            presenter={presenterMode ? { delivery, voice } : undefined}
            voice={voice}
            shortcut={planningShortcut}
            onShortcutHandled={setPlanningShortcut}
            onVoiceChange={setVoice}
            onEditFacts={presenterMode ? () => stageGrid.current?.querySelector<HTMLTextAreaElement>("#ec-video-facts")?.focus() : undefined}
            initialTarget={source?.shotIndex}
            initialInstruction={source?.note}
            onChange={setStory}
            disabled={locked}
            ensureProject={ensureProject}
            setSubmitting={setSubmittingPlan}
        />
    );
    const productFacts = (
        <div className="ec-video-source-editor">
            <Input.TextArea aria-label="商品卖点" id="ec-video-facts" disabled={locked} value={facts} onChange={(e) => setFacts(e.target.value)} rows={2} placeholder="写下镜头要拍出来的特点，例如瓶身透光、外盖可拆。" />
            <ProductVideoClaims
                key={JSON.stringify([mode, ...(salesMode ? productImages.map((image) => image.resourceId) : [frame?.resourceId])])}
                scope={scope}
                projectId={projectId}
                frame={castingPresenter ? undefined : frame}
                images={salesMode ? productImages : undefined}
                model={visionModel}
                unavailable={visionIssue}
                config={config}
                disabled={locked}
                facts={facts}
                setSubmitting={setSubmittingAnalysis}
                ensureProject={ensureProject}
                onAccept={(point) => setFacts((current) => [...current.trimEnd().split("\n").filter(Boolean), point].join("\n"))}
            />
        </div>
    );
    const savedProductFacts = onSaveFacts && <ProductFactsPanel saved={savedFacts ?? draft.productFacts} current={facts} onUse={setFacts} onSave={onSaveFacts} disabled={locked || factsBusy} />;
    const modelField = (
        <>
            <label htmlFor="ec-video-model">视频模型</label>
            <Select
                id="ec-video-model"
                disabled={locked}
                value={model}
                placeholder={remixEnabled && !reference ? "先添加参考视频" : models.length ? "选择视频模型" : "暂无兼容模型"}
                onChange={setChosenModel}
                options={models.map((value) => ({ value, label: modelDisplayName(config, value) }))}
            />
        </>
    );

    const frameComposer = (
        <ProductVideoFrameComposer
            usage={remixEnabled ? "reference" : "presenter"}
            key={JSON.stringify([scope, sessionId, mode])}
            scope={scope}
            sessionId={sessionId}
            projectId={projectId}
            config={config}
            disabled={otherWorkBusy}
            references={draft.references}
            primaryModelId={draft.primaryModelResourceId}
            currentProduct={presenterMode ? productImages[0] : fromLibrary && activeLibraryFrame?.source === "composite" ? undefined : frame}
            ensureProject={ensureProject}
            onLockChange={setComposingFrame}
            onUse={(result) => {
                chooseFrame(result.resourceId, { ...result, source: "composite" });
                if (presenterMode) setPresenterInput("photo");
                if (presenterMode) setConfirmedFrame(undefined);
                setShowMaterials(true);
                setReview(null);
                setError("");
                requestAnimationFrame(() => materialsPanel.current?.focus());
            }}
        />
    );
    const singlePageSettings = (
        <>
            {marketFields}
            <section className="ec-sales-facts">
                <label htmlFor="ec-video-facts">商品卖点</label>
                {productFacts}
            </section>
            {briefEditor}
            {savedProductFacts}
            <div className="ec-sales-model">{modelField}</div>
        </>
    );
    const quoteControls = (
        <>
            <span role="status">{reason || quotedCost || "15 秒 · 1 条视频"}</span>
            <Button type="primary" disabled={Boolean(reason) || Boolean(submission.pending) || locked} loading={busy} onClick={() => void reviewOrSubmit()}>
                {quote ? "确认生成 1 条视频" : "查看报价"}
            </Button>
        </>
    );
    const selectedRemixPreset = reference ? matchVideoRemixPreset(reference) : (referencePreset ?? "close");
    function chooseRemixPreset(preset: VideoRemixPreset) {
        setReferencePreset(preset);
        if (referenceVideo) setReferenceVideo(applyVideoRemixPreset(referenceVideo, preset));
        setReview(null);
    }

    return (
        <section className="ec-studio-panel ec-video" aria-label="商品视频">
            {submission.pending && !busy && (
                <div className="ec-video-version-notice">
                    <strong>上次生成尚待确认</strong>
                    <Button size="small" loading={checking} onClick={() => void checkSubmission()}>
                        核对提交结果
                    </Button>
                    {unmatched && projectId && (
                        <Button
                            size="small"
                            type="text"
                            onClick={() => {
                                submission.finish(projectId, submission.pending!);
                                setUnmatched(false);
                                setError("");
                            }}
                        >
                            已自行核对，允许重新报价
                        </Button>
                    )}
                </div>
            )}
            {view === "create" && salesMode ? (
                <>
                    <div className="ec-sales-modebar">{modeChooser}</div>
                    <div className="ec-sales-layout" ref={stageGrid}>
                        <section className="ec-sales-upload" aria-label="商品参考图">
                            <ProductVideoProductImages
                                value={productImages}
                                projectImages={images}
                                disabled={locked}
                                onChange={(next) => {
                                    setProductImages(next);
                                    setReview(null);
                                    setError("");
                                }}
                                onUpload={onUpload}
                                canReadImage={(id) => queryClient.fetchQuery({ ...frameAvailability(scope, id), staleTime: 0 })}
                                onBusyChange={setProductImagesBusy}
                            />
                        </section>
                        <div className="ec-sales-main">
                            <ProductVideoSalesGallery draft={brief} facts={facts} closing={closing} story={story} disabled={locked || Boolean(pendingSalesPreset)} onSelect={chooseSalesPreset} />
                            {pendingSalesPreset && (
                                <div className="ec-video-replace" role="group" aria-label="更换拍法确认">
                                    <strong>替换当前分镜？</strong>
                                    <p>应用「{pendingSalesPreset.approach.title}」将替换已编辑的分镜和分镜配图。</p>
                                    <Button ref={keepSalesScript} disabled={locked} onClick={() => resolveSalesPreset(false)}>
                                        保留当前分镜
                                    </Button>
                                    <Button disabled={locked} onClick={() => resolveSalesPreset(true)}>
                                        应用新拍法
                                    </Button>
                                </div>
                            )}
                            <details className="ec-sales-script" open={salesScriptOpen} onToggle={(e) => setSalesScriptOpen(e.currentTarget.open)}>
                                <summary>自定义脚本</summary>
                                {scriptEditor}
                                {planningEditor}
                                {salesVoiceMode !== "silent" && voiceEditor}
                                {inputPreview}
                            </details>
                        </div>
                        <aside className="ec-sales-controls" aria-label="带货视频设置">
                            {singlePageSettings}
                        </aside>
                        <footer className="ec-sales-actions">{quoteControls}</footer>
                    </div>
                </>
            ) : view === "create" && remixEnabled ? (
                <>
                    <div className="ec-sales-modebar">{modeChooser}</div>
                    <div className="ec-remix-layout" ref={stageGrid}>
                        <section className="ec-remix-main" aria-label="复刻素材与分镜">
                            <div className="ec-remix-inputs">
                                <ProductVideoReferencePanel
                                    scope={scope}
                                    value={reference}
                                    preset={selectedRemixPreset}
                                    onPresetChange={chooseRemixPreset}
                                    onChange={(next) => {
                                        setReferenceVideo(next);
                                        setResetRemix(false);
                                        setReview(null);
                                        setError("");
                                    }}
                                    shots={story?.shots}
                                    onApplyShot={(index, note) => {
                                        if (!story || index < 0 || index >= story.shots.length || story.shots[index].split("\n").includes(note)) return;
                                        const shots = story.shots.map((shot, i) => (i === index ? [shot, note].filter(Boolean).join("\n") : shot));
                                        setStory({ ...story, shots, edited: true });
                                        setReview(null);
                                    }}
                                    disabled={locked}
                                    onBusyChange={setReadingReference}
                                />
                                <div className="ec-remix-product">
                                    {imagePicker}
                                    {imageStatus}
                                </div>
                            </div>
                            {reference && !referenceStatus.isFetching && (referenceStatus.isError || referenceStatus.data === false) && (
                                <div className="ec-video-reference-error" role="alert">
                                    参考视频当前不可用。
                                    <Button size="small" onClick={() => void referenceStatus.refetch()}>
                                        重新核对素材
                                    </Button>
                                </div>
                            )}
                            {frameComposer}
                            <details
                                className="ec-remix-disclosure"
                                open={remixScriptOpen}
                                onToggle={(event) => {
                                    setRemixScriptOpen(event.currentTarget.open);
                                    if (!event.currentTarget.open) setResetRemix(false);
                                }}
                            >
                                <summary>自定义脚本</summary>
                                {referenceScript.story &&
                                    automaticRemix &&
                                    (resetRemix ? (
                                        <div role="group" aria-label="恢复自动分镜" className="ec-video-replace">
                                            <p>恢复后会按当前参考片重新编排三镜，替换已编辑的分镜和配图。旁白会保留。</p>
                                            <Button disabled={locked} onClick={() => setResetRemix(false)}>
                                                保留当前分镜
                                            </Button>
                                            <Button
                                                disabled={locked}
                                                onClick={() => {
                                                    setReferenceScript((previous) => ({ ...previous, story: null, candidateId: "", picking: false }));
                                                    setResetRemix(false);
                                                    setReview(null);
                                                }}
                                            >
                                                确认恢复自动分镜
                                            </Button>
                                        </div>
                                    ) : (
                                        <Button size="small" disabled={locked} onClick={() => setResetRemix(true)}>
                                            恢复自动分镜
                                        </Button>
                                    ))}
                                {story ? scriptEditor : <p>选择参考视频后即可调整三段分镜。</p>}
                                {planningEditor}
                                {voiceEditor}
                                {inputPreview}
                            </details>
                            <details className="ec-remix-disclosure">
                                <summary>复刻示例</summary>
                                <ProductVideoPrepGuide mode="reference" active={view === "create"} disabled={locked} referencePreset={selectedRemixPreset} onChooseReferencePreset={chooseRemixPreset} />
                            </details>
                        </section>
                        <aside className="ec-remix-settings" aria-label="视频复刻设置">
                            {singlePageSettings}
                        </aside>
                        <footer className="ec-remix-actions">{quoteControls}</footer>
                    </div>
                </>
            ) : view === "create" ? (
                <>
                    <div className="ec-sales-modebar">{modeChooser}</div>
                    <div className="ec-remix-layout ec-presenter-layout" ref={stageGrid}>
                        <section className="ec-remix-main ec-presenter-main" aria-label="人物口播素材与台词">
                            <div className="ec-presenter-inputs" data-source={presenterInput}>
                                <div className="ec-presenter-frame">
                                    <div className="ec-presenter-source">
                                        <SegmentedControl<"photo" | "cast">
                                            ariaLabel="人货同框图来源"
                                            value={presenterInput}
                                            options={[
                                                { value: "photo", label: "使用已有同框图" },
                                                { value: "cast", label: "选模特合成" },
                                            ]}
                                            disabled={locked}
                                            onChange={(value) => {
                                                setPresenterInput(value);
                                                setReview(null);
                                                setError("");
                                            }}
                                        />
                                    </div>
                                    {castingPresenter ? (
                                        frameComposer
                                    ) : (
                                        <>
                                            {imagePicker}
                                            {imageStatus}
                                            {frame && (
                                                <div className="ec-presenter-confirm">
                                                    {!presenter && <p>确认人物面部、商品外观和拿法。这张照片会用作视频首帧。</p>}
                                                    <Button
                                                        disabled={locked || (!presenter && (previewedFrame !== frame.resourceId || !frameStatus.data || frameStatus.isError || frameStatus.isFetching))}
                                                        aria-pressed={Boolean(presenter)}
                                                        onClick={() => {
                                                            setConfirmedFrame(presenter ? undefined : frame.resourceId);
                                                            setReview(null);
                                                        }}
                                                    >
                                                        {presenter ? "同框图已确认" : "确认使用这张同框图"}
                                                    </Button>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                                <div className="ec-presenter-script">
                                    <ProductVideoPresenterDelivery
                                        delivery={delivery}
                                        disabled={locked}
                                        onChange={(next) => {
                                            setDelivery(next);
                                            setReview(null);
                                        }}
                                    />
                                    {voiceEditor}
                                    {planningEditor}
                                </div>
                            </div>
                            <details className="ec-remix-disclosure" open={presenterScriptOpen} onToggle={(event) => setPresenterScriptOpen(event.currentTarget.open)}>
                                <summary>自定义分镜</summary>
                                {scriptEditor}
                                {presenter && inputPreview}
                            </details>
                            <details className="ec-remix-disclosure">
                                <summary>口播示例</summary>
                                <ProductVideoPrepGuide mode="presenter" active={view === "create"} disabled={locked} />
                            </details>
                        </section>
                        <aside className="ec-remix-settings ec-presenter-settings" aria-label="人物口播设置">
                            {singlePageSettings}
                        </aside>
                        <footer className="ec-remix-actions ec-presenter-actions">{quoteControls}</footer>
                    </div>
                </>
            ) : (
                <section className="ec-video-history" aria-label="本项目近期视频">
                    <div className="ec-video-row">
                        <strong>本项目近期视频</strong>
                        {loadingSource && <small role="status">正在读取来源作品…</small>}
                        {projectId ? (
                            <div className="ec-video-work-actions">
                                <ProductVideoComparison key={projectId} tasks={videos} projectId={projectId} />
                                <Button size="small" onClick={() => void history.refetch()}>
                                    刷新
                                </Button>
                            </div>
                        ) : null}
                    </div>
                    {history.isError ? (
                        <p role="alert">项目视频读取失败，请刷新重试。</p>
                    ) : !videos.length && !submission.pending ? (
                        projectId && history.isFetching ? (
                            <p role="status">正在读取视频…</p>
                        ) : (
                            <div className="ec-video-history-empty">
                                <Film size={32} strokeWidth={1.5} aria-hidden />
                                <h2>还没有商品视频</h2>
                                <Button
                                    onClick={() => {
                                        if (remixEnabled) setRemixScriptOpen(Boolean(story));
                                        onViewChange("create");
                                    }}
                                >
                                    {salesMode ? "制作带货视频" : presenterMode ? "制作人物口播" : story ? "继续编辑分镜" : "制作视频复刻"}
                                </Button>
                            </div>
                        )
                    ) : null}
                    {projectId &&
                        videos.map((task) => (
                            <Fragment key={task.id}>
                                <ProductVideoWorkCard task={task} projectId={projectId} disabled={locked} parentWork={worksById.get(task.clientContext?.ecommerceVideoVersion?.parentTaskId || "")} onOpenSource={openSource} onDerive={derive} />
                                {replaceWith?.taskId === task.id && (
                                    <div className="ec-video-version-notice" role="group" aria-label="替换当前视频草稿">
                                        <p>用这条作品的脚本替换当前编辑中的草稿？原作品会保留。</p>
                                        <Button size="small" onClick={() => setReplaceWith(null)}>
                                            保留当前草稿
                                        </Button>
                                        <Button size="small" onClick={() => applyWorkScript(replaceWith)}>
                                            使用作品脚本
                                        </Button>
                                    </div>
                                )}
                            </Fragment>
                        ))}
                </section>
            )}
            <AppModal
                open={!!enlargedFrame}
                centered
                width="min(900px, calc(100vw - 24px))"
                footer={null}
                title={enlargedFrame?.name || frameLabel}
                onCancel={() => setEnlargedFrame(undefined)}
                afterClose={() => enlargeTrigger.current?.focus({ preventScroll: true })}
            >
                {enlargedFrame && (
                    <div className="ec-frame-lightbox">
                        <CachedResourceImage eager variant="original" storageKey={resourceStorageKey(enlargedFrame.resourceId)} alt={enlargedFrame.name} fallback={<span>原图暂不可预览</span>} loadingFallback={null} />
                    </div>
                )}
            </AppModal>
            {error ? <p role="alert">{error}</p> : null}
            {saveFailed ? (
                <p role="alert">
                    本机视频草稿保存失败，请在离开前重试。{" "}
                    <Button
                        size="small"
                        onClick={() => {
                            lastSnapshot.current = undefined;
                            setSaveAttempt((value) => value + 1);
                        }}
                    >
                        重试保存
                    </Button>
                </p>
            ) : null}
        </section>
    );
}
