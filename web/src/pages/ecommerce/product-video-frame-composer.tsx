import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "antd";
import { ChevronDown, Expand, ImagePlus, Images, ScanFace, Upload } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { AppModal } from "@/components/ui/product/app-modal";
import { createClientUUID } from "@/lib/client-id";
import { systemModelQuoteRequest } from "@/lib/model-pricing";
import { assertCurrentUserSession, captureUserSession } from "@/lib/user-scope";
import { WorkbenchAssetPicker } from "@/pages/workbench/workbench-asset-picker";
import type { EcommerceReference } from "@/services/api/ecommerce";
import { prepareBackendGenerationTask } from "@/services/api/generation-task";
import { quoteModel, type LogicalModelQuote } from "@/services/api/logical-models";
import { ApiError } from "@/services/api/request";
import { refreshResource, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { createGenerationTask, listGenerationTasks, queryGenerationTask, recoverGenerationTaskMedia, type GenerationTask } from "@/services/api/task-center";
import { modelDisplayName, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { COMMERCE_IMAGE_ACCEPT, normalizeCommerceImageFile } from "./image-transfer";
import type { CommerceModelProfile } from "./model-catalog";
import { projectCastingPhotos, ProjectCastingPicker, type CastingPhoto } from "./product-video-frame-composer-casting";
import { isProductVideoFrame } from "./product-video-version";
import { castingImageSettings, castingModels, castingOutput, frameRequirements } from "./casting-image-task";
import { CastingPortraitGenerator } from "./casting-portrait-generator";
import "./product-video-frame-composer.css";

type Frame = CastingPhoto;
type Slot = "person" | "product";
type FrameUsage = "presenter" | "reference";
type Receipt = { projectId: string; operationId: string; taskId?: string; person: Frame; product: Frame; instruction: string; model: string };
type Props = {
    scope: string;
    sessionId: string;
    projectId?: string;
    config: AiConfig;
    disabled: boolean;
    usage?: FrameUsage;
    references: EcommerceReference[];
    primaryModelId?: string;
    currentProduct?: Frame;
    ensureProject: () => Promise<string>;
    onUse: (frame: Frame) => void;
    onLockChange: (locked: boolean) => void;
};
const kinds = ["image"] as const;
const slotNames = { person: "人物原图", product: "商品原图" };
const slots = ["person", "product"] as const;
export { frameRequirements };

export function frameModels(config: AiConfig) {
    return castingModels(config, frameRequirements);
}

function storageKey(scope: string, projectId: string, usage: FrameUsage) {
    return JSON.stringify([usage === "presenter" ? "ecommerce-presenter-frame" : "ecommerce-reference-frame", scope, projectId]);
}

function readReceipt(scope: string, projectId: string | undefined, usage: FrameUsage): Receipt | null {
    try {
        const item = projectId && JSON.parse(sessionStorage.getItem(storageKey(scope, projectId, usage)) || "null");
        if (
            item?.projectId === projectId &&
            item?.operationId &&
            typeof item.operationId === "string" &&
            isProductVideoFrame(item.person) &&
            isProductVideoFrame(item.product) &&
            typeof item.model === "string" &&
            typeof item.instruction === "string" &&
            (item.taskId === undefined || typeof item.taskId === "string")
        )
            return item;
    } catch {
        /* A blocked store is reported before a new task is sent. */
    }
    return null;
}

export function compositeOutput(task: GenerationTask | undefined, receipt: Pick<Receipt, "projectId" | "operationId"> | null) {
    return castingOutput(task, receipt, "人物与商品同框图");
}

export function compositePrompt(usage: FrameUsage, instruction: string) {
    const direction = usage === "reference" ? "为参考视频复刻制作一张人物与商品的商品参考图。展示人物使用或展示商品的自然姿态，方便参考视频编排不同机位和动作。" : "生成一张真人口播商品宣传短片的首帧，人物面向镜头。";
    return [
        direction,
        "第一张参考图是出镜人物，第二张是商品。仅把人物参考图中的多视角用作同一模特的造型依据。成图为单一机位、单一场景，保持人物面貌、商品外形、颜色及包装标识。商品完整可辨，注意真实尺度、接触和光影。不要添加文字、水印或其他商品。",
        instruction.trim(),
    ]
        .filter(Boolean)
        .join("\n");
}

type FrameInputs = Partial<Record<Slot, Frame>> & { productPicked: boolean };

export function composerProduct(inputs: FrameInputs, projectProducts: Array<Frame & { primary?: boolean }>, currentId?: string, submitted?: Frame): Frame | undefined {
    if (submitted) return submitted;
    const product = inputs.productPicked ? inputs.product : projectProducts.find((photo) => photo.resourceId === currentId) || inputs.product || projectProducts.find((photo) => photo.primary);
    return product?.resourceId === inputs.person?.resourceId ? undefined : product;
}

export function compositeReviewKey(usage: FrameUsage, sources: Partial<Record<Slot, Frame>>, instruction: string, model?: string, request?: ReturnType<typeof systemModelQuoteRequest>) {
    return JSON.stringify([usage, sources.person?.resourceId, sources.product?.resourceId, instruction.trim(), model, request]);
}

function readFrameDraft(key: string) {
    try {
        const item = JSON.parse(sessionStorage.getItem(key) || "null");
        if (item && (!item.person || isProductVideoFrame(item.person)) && (!item.product || isProductVideoFrame(item.product)) && typeof item.instruction === "string" && item.instruction.length <= 240 && typeof item.model === "string")
            return { ...item, productPicked: item.productPicked === undefined ? !!item.product : item.productPicked === true } as FrameInputs & { instruction: string; model: string };
    } catch {
        /* Input preparation remains available without this optional draft. */
    }
}

export function ProductVideoFrameComposer({ scope, sessionId, projectId, config, disabled, usage = "presenter", references, primaryModelId, currentProduct, ensureProject, onUse, onLockChange }: Props) {
    const isReference = usage === "reference";
    const draftType = isReference ? "ecommerce-reference-frame-draft" : "ecommerce-frame-draft";
    const sessionKey = JSON.stringify([draftType, scope, sessionId]);
    const draftKey = projectId ? JSON.stringify([draftType, scope, projectId]) : sessionKey;
    const [draft] = useState(() => readFrameDraft(draftKey) || (projectId ? readFrameDraft(sessionKey) : undefined));
    const [receipt, setReceipt] = useState(() => readReceipt(scope, projectId, usage));
    const [opened, setOpened] = useState(!isReference || !!receipt);
    const projectPhotos = useMemo(() => projectCastingPhotos(references, primaryModelId, currentProduct), [references, primaryModelId, currentProduct]);
    const [inputs, setInputs] = useState<FrameInputs>(() => ({
        person: receipt?.person || draft?.person || projectPhotos.person.find((photo) => photo.primary),
        product: receipt?.product || draft?.product,
        productPicked: draft?.productPicked ?? false,
    }));
    const product = composerProduct(inputs, projectPhotos.product, currentProduct?.resourceId, receipt?.product);
    const sources = useMemo(() => ({ person: inputs.person, product }), [inputs.person, product]);
    const [instruction, setInstruction] = useState(receipt?.instruction || draft?.instruction || "");
    const [selectedModel, setSelectedModel] = useState(receipt?.model || draft?.model || config.imageModel);
    useEffect(() => {
        if (!sources.person && !sources.product && !instruction) return;
        try {
            sessionStorage.setItem(draftKey, JSON.stringify({ ...sources, productPicked: inputs.productPicked, instruction, model: selectedModel }));
            if (draftKey !== sessionKey) sessionStorage.removeItem(sessionKey);
        } catch {
            /* The paid submission checks receipt storage independently. */
        }
    }, [draftKey, sessionKey, sources, inputs.productPicked, instruction, selectedModel]);
    const [checkedUnknown, setCheckedUnknown] = useState(false);
    const [picker, setPicker] = useState<Slot | null>(null);
    const [casting, setCasting] = useState<Slot | null>(null);
    const [previewSource, setPreviewSource] = useState<Slot | null>(null);
    const previewTrigger = useRef<HTMLButtonElement>(null);
    const [generatingPortrait, setGeneratingPortrait] = useState(false);
    const [error, setError] = useState("");
    const [review, setReview] = useState<{ key: string; price: LogicalModelQuote } | null>(null);
    useEffect(() => setReview(null), [product?.resourceId]);
    const [working, setWorking] = useState<"action" | "compose" | null>(null);
    const busy = working !== null;
    useEffect(() => {
        onLockChange(busy || !!picker || !!casting || !!previewSource || generatingPortrait);
        return () => onLockChange(false);
    }, [busy, picker, casting, previewSource, generatingPortrait, onLockChange]);
    const [previewed, setPreviewed] = useState("");
    const [previewAttempt, setPreviewAttempt] = useState(0);
    const guard = useRef(false);
    const lifetime = useRef<AbortController | null>(null);
    useEffect(() => {
        const controller = new AbortController();
        lifetime.current = controller;
        return () => controller.abort();
    }, []);
    const id = useId();
    const client = useQueryClient();
    const imageEnabled = useUserStore((state) => state.features.imageWorkbenchEnabled);
    const models = frameModels(config);
    const model = models.includes(selectedModel) ? selectedModel : models[0];
    const settings = castingImageSettings(config, model);
    const request = settings && systemModelQuoteRequest(settings, model, "image", frameRequirements);
    const key = compositeReviewKey(usage, sources, instruction, model, request);
    const price = review?.key === key ? review.price : null;
    const readTask = useQuery({
        queryKey: ["ecommerce-presenter-frame-task", scope, receipt?.projectId, receipt?.taskId],
        enabled: opened && Boolean(receipt?.taskId),
        queryFn: ({ signal }) => queryGenerationTask(receipt!.taskId!, { signal }),
        retry: false,
        refetchInterval: ({ state }) => (!state.error && (state.data?.status === "queued" || state.data?.status === "running") ? 1500 : false),
    });
    const task = readTask.data;
    const output = compositeOutput(task, receipt);
    const pendingSettlement = task?.billing?.status === "uncertain" || task?.providerCancelStatus === "uncertain" || task?.providerCancelStatus === "requested";
    const unknown = receipt && !receipt.taskId;
    const locked = disabled || busy || !!receipt;
    function remember(item: Receipt) {
        sessionStorage.setItem(storageKey(scope, item.projectId, usage), JSON.stringify(item));
        if (!lifetime.current?.signal.aborted) setReceipt(item);
    }
    function clear() {
        if (receipt) {
            try {
                sessionStorage.removeItem(storageKey(scope, receipt.projectId, usage));
            } catch {
                setError("无法清除原任务回执，请开启站点存储后重试。");
                return;
            }
        }
        setReceipt(null);
        setCheckedUnknown(false);
        setReview(null);
        setPreviewed("");
        setError("");
    }
    async function run(action: (signal: AbortSignal) => Promise<void>) {
        if (guard.current || disabled || !lifetime.current || lifetime.current.signal.aborted) return;
        guard.current = true;
        setWorking(action === compose ? "compose" : "action");
        setError("");
        const local = lifetime.current.signal;
        try {
            const session = captureUserSession();
            if (session.scope !== scope || scope === "guest") throw new Error("请登录后重新选择素材。");
            await action(AbortSignal.any([local, session.signal]));
            assertCurrentUserSession(session);
        } catch (cause) {
            if (!local.aborted) setError(cause instanceof Error ? cause.message : "操作失败，请重试。");
        } finally {
            guard.current = false;
            if (!local.aborted) setWorking(null);
        }
    }
    async function verify(frame: Frame, signal: AbortSignal) {
        const resource = await refreshResource(frame.resourceId);
        signal.throwIfAborted();
        if (resource.id !== frame.resourceId || resource.userId !== scope || resource.status !== "ready" || resource.kind !== "image" || !resource.mimeType.startsWith("image/")) throw new Error("原图片当前不可用，请重新选择。");
    }
    async function select(slot: Slot, value: Frame | File | CommerceModelProfile) {
        if (locked) return;
        await run(async (signal) => {
            let frame: Frame;
            if (value instanceof File || "image" in value) {
                const profile = value instanceof File ? undefined : value;
                let file: File;
                if (value instanceof File) file = normalizeCommerceImageFile(value);
                else if (sources.person?.catalogId === value.id && slot === "person") {
                    await verify(sources.person, signal);
                    setCasting(null);
                    return;
                } else {
                    const response = await fetch(value.image, { credentials: "same-origin", signal });
                    if (!response.ok) throw new Error("模特原图暂时无法读取，请重试或上传人物照片。");
                    const blob = await response.blob();
                    signal.throwIfAborted();
                    if (!blob.size || blob.type !== "image/png") throw new Error("模特原图格式无效，请重新选择。");
                    file = normalizeCommerceImageFile(new File([blob], value.name + ".png", { type: blob.type }));
                }
                const resource = await uploadResourceFile(file, "image", { fileName: file.name, signal, expectedUserId: scope });
                signal.throwIfAborted();
                frame = { resourceId: resource.id, name: profile?.name || file.name, ...(profile && { catalogId: profile.id }) };
            } else frame = { resourceId: value.resourceId, name: value.name, ...(value.catalogId && { catalogId: value.catalogId }) };
            if (!isProductVideoFrame(frame)) throw new Error("请重新选择有效图片。");
            if (sources[slot === "product" ? "person" : "product"]?.resourceId === frame.resourceId) throw new Error("人物和商品需要分别选择两张图片。");
            await verify(frame, signal);
            setInputs((value) => ({ ...value, [slot]: frame, productPicked: slot === "product" || value.productPicked }));
            setCasting(null);
            setReview(null);
        });
    }
    async function compose(signal: AbortSignal) {
        const { person, product } = sources;
        if (!imageEnabled || !person || !product || !settings || !request || receipt) return;
        await Promise.all([verify(person, signal), verify(product, signal)]);
        const fresh = (await quoteModel(request, signal)).quote;
        signal.throwIfAborted();
        if (!Number.isSafeInteger(fresh.amountMicrocredits) || fresh.amountMicrocredits < 0) throw new Error("同框图报价无效，请重试。");
        if (!price || fresh.amountMicrocredits !== price.amountMicrocredits || fresh.billingMode !== price.billingMode || fresh.estimated !== price.estimated || fresh.quantity !== price.quantity) {
            setReview({ key, price: fresh });
            if (price) setError("同框图报价已变化，请核对后再确认。");
            return;
        }
        const project = await ensureProject();
        signal.throwIfAborted();
        if (!project || readReceipt(scope, project, usage)) throw new Error("项目里还有一张同框图待核对，请重新打开商品视频。");
        const saved: Receipt = { projectId: project, operationId: createClientUUID(), person, product, instruction, model };
        const input = await prepareBackendGenerationTask({
            projectId: project,
            mode: "image",
            config: settings,
            prompt: compositePrompt(usage, instruction),
            signal,
            clientOperationId: saved.operationId,
            referenceImages: slots.map((slot) => ({ id: saved[slot].resourceId, name: saved[slot].name, dataUrl: "", type: "image/*", role: "reference", slotKey: slot, storageKey: resourceStorageKey(saved[slot].resourceId) })),
            metadata: {
                source: "ecommerce-agent",
                stage: "product-video-frame",
                ecommerceProjectId: project,
                assetTitle: isReference ? "参考复刻 · 同框图" : "人物口播 · 同框图",
                ecommerceVideoQuote: { billingMode: fresh.billingMode, amountMicrocredits: fresh.amountMicrocredits },
            },
        });
        signal.throwIfAborted();
        try {
            remember(saved);
        } catch {
            throw new Error("此浏览器无法保存提交回执，请开启站点存储后再合成。");
        }
        setReview(null);
        try {
            const created = await createGenerationTask({ ...input, operation: "image_to_image" });
            if (!created.id || created.type !== "canvas_image" || created.projectId !== project || created.clientOperationId !== saved.operationId) throw new Error("同框图提交回执待核对。");
            remember({ ...saved, taskId: created.id });
            if (!signal.aborted) client.setQueryData(["ecommerce-presenter-frame-task", scope, project, created.id], created);
        } catch (cause) {
            if (cause instanceof ApiError && cause.status && cause.status < 500 && ![408, 409].includes(cause.status)) {
                sessionStorage.removeItem(storageKey(scope, project, usage));
                if (!signal.aborted) setReceipt(null);
                throw cause;
            }
            throw new Error("提交结果尚未确认，请先核对原任务。");
        }
    }
    async function recover(signal: AbortSignal) {
        if (!receipt) return;
        const tasks = await listGenerationTasks(100, { projectId: receipt.projectId }, undefined, signal);
        signal.throwIfAborted();
        const found = tasks.find((task) => task.type === "canvas_image" && task.projectId === receipt.projectId && task.clientOperationId === receipt.operationId);
        if (!found) {
            setCheckedUnknown(true);
            throw new Error("近期任务中尚未找到。可稍后再查，或在任务中心核对后重新准备。");
        }
        remember({ ...receipt, taskId: found.id });
    }
    return (
        <details className="ec-frame-composer" open={opened} onToggle={(event) => setOpened(event.currentTarget.open)}>
            <summary>
                <Images size={16} aria-hidden />
                <strong>{isReference ? "添加出镜模特（选填）" : "合成人物与商品首帧"}</strong>
                <ChevronDown size={14} aria-hidden />
            </summary>
            {opened && (
                <div className="ec-frame-composer-body">
                    {isReference && <p>选一位模特与商品合成参考图，确认后用于这条复刻视频。</p>}
                    <div className="ec-frame-desk">
                        <div className="ec-frame-inputs">
                            {slots.map((slot) => {
                                const photo = sources[slot];
                                const fromProject = slot === "person" || projectPhotos.product.length > 0;
                                const chooseSource = () => {
                                    setError("");
                                    if (fromProject) setCasting(slot);
                                    else setPicker(slot);
                                };
                                const chooseName = slot === "person" ? "官方模特库" : fromProject ? "选择项目商品图" : "从素材库选择商品原图";
                                return (
                                    <fieldset key={slot}>
                                        <legend>{slotNames[slot]}</legend>
                                        {photo ? (
                                            <>
                                                <button
                                                    type="button"
                                                    className="ec-frame-photo"
                                                    aria-label={`放大查看${slotNames[slot]}`}
                                                    aria-haspopup="dialog"
                                                    onClick={(event) => {
                                                        previewTrigger.current = event.currentTarget;
                                                        setPreviewSource(slot);
                                                    }}
                                                >
                                                    <CachedResourceImage storageKey={resourceStorageKey(photo.resourceId)} variant="thumbnail" alt={photo.name} fallback={<span>图片暂不可预览</span>} loadingFallback={null} />
                                                    <span className="ec-frame-zoom" aria-hidden>
                                                        <Expand size={14} />
                                                    </span>
                                                </button>
                                                <small className="ec-casting-name" title={photo.name}>
                                                    {photo.name}
                                                </small>
                                            </>
                                        ) : (
                                            <button type="button" className="ec-frame-photo ec-frame-photo-empty" disabled={locked} onClick={chooseSource} aria-haspopup="dialog">
                                                {slot === "person" ? <ScanFace size={28} aria-hidden /> : <ImagePlus size={28} aria-hidden />}
                                                {chooseName}
                                            </button>
                                        )}
                                        <div className="ec-frame-source-actions">
                                            {photo && fromProject && (
                                                <Button size="small" className="ec-casting-open" disabled={locked} aria-haspopup="dialog" onClick={chooseSource}>
                                                    {chooseName}
                                                </Button>
                                            )}
                                            {slot === "person" && (
                                                <Button
                                                    size="small"
                                                    className="ec-casting-open"
                                                    disabled={locked}
                                                    aria-haspopup="dialog"
                                                    onClick={() => {
                                                        setError("");
                                                        setGeneratingPortrait(true);
                                                    }}
                                                >
                                                    AI 生成模特
                                                </Button>
                                            )}
                                            {(photo || fromProject) && (
                                                <Button type="text" size="small" disabled={locked} aria-label={`从素材库选择${slotNames[slot]}`} aria-haspopup="dialog" onClick={() => setPicker(slot)}>
                                                    素材库
                                                </Button>
                                            )}
                                            <label className="ec-frame-upload">
                                                <input
                                                    type="file"
                                                    accept={COMMERCE_IMAGE_ACCEPT}
                                                    aria-label={`上传${slotNames[slot]}`}
                                                    disabled={locked}
                                                    onChange={(event) => {
                                                        const file = event.target.files?.[0];
                                                        event.target.value = "";
                                                        if (file) void select(slot, file);
                                                    }}
                                                />
                                                <Upload size={13} aria-hidden /> 上传
                                            </label>
                                        </div>
                                    </fieldset>
                                );
                            })}
                        </div>
                        <AppModal
                            title={previewSource ? slotNames[previewSource] : undefined}
                            open={previewSource !== null}
                            footer={null}
                            width="min(900px, calc(100vw - 24px))"
                            onCancel={() => setPreviewSource(null)}
                            afterClose={() => previewTrigger.current?.focus({ preventScroll: true })}
                        >
                            {previewSource && sources[previewSource] && (
                                <div className="ec-frame-lightbox">
                                    <CachedResourceImage
                                        storageKey={resourceStorageKey(sources[previewSource].resourceId)}
                                        variant="original"
                                        eager
                                        alt={sources[previewSource].name}
                                        loadingFallback={<span role="status">正在读取原图…</span>}
                                        fallback={<span role="status">暂时无法读取原图</span>}
                                    />
                                    <small>{sources[previewSource].name}</small>
                                </div>
                            )}
                        </AppModal>
                        {casting && (
                            <ProjectCastingPicker
                                scope={scope}
                                slot={casting}
                                choices={projectPhotos[casting]}
                                current={sources[casting]}
                                busy={busy}
                                error={error}
                                onClose={() => {
                                    setCasting(null);
                                    setError("");
                                }}
                                onChoose={(value) => void select(casting, value)}
                            />
                        )}
                        {generatingPortrait && (
                            <CastingPortraitGenerator
                                scope={scope}
                                sessionId={sessionId}
                                projectId={projectId}
                                config={config}
                                imageEnabled={imageEnabled}
                                busy={busy}
                                ensureProject={ensureProject}
                                run={run}
                                error={error}
                                onClose={() => {
                                    setGeneratingPortrait(false);
                                    setError("");
                                }}
                                onUse={async (photo, signal) => {
                                    await verify(photo, signal);
                                    setInputs((existing) => ({ ...existing, person: photo }));
                                    setReview(null);
                                }}
                            />
                        )}
                        <WorkbenchAssetPicker
                            open={Boolean(picker)}
                            accept={kinds}
                            syncedOnly
                            maxCount={1}
                            slotName={picker ? slotNames[picker] : ""}
                            onClose={() => setPicker(null)}
                            onPick={async ([asset]) => {
                                if (picker && asset) await select(picker, asset);
                            }}
                        />
                        <div className="ec-frame-tools">
                            <div className="ec-frame-pose">
                                <label htmlFor={id + "-instruction"}>同框姿势（选填）</label>
                                <input id={id + "-instruction"} value={instruction} disabled={locked} maxLength={240} onChange={(e) => setInstruction(e.target.value)} placeholder="例如，坐在桌前，将商品举至胸前" />
                                <div className="ec-casting-suggestions" aria-label="同框姿势建议">
                                    {Object.entries({
                                        手持展示: isReference ? "自然托住商品，让包装正面清晰可见。" : "面向镜头，双手托住商品，保持包装正面清晰可见。",
                                        桌面讲解: "站在桌旁，一手指向商品细节，另一手留在画面内。",
                                        穿戴演示: "自然穿戴商品，身体微侧，露出关键细节。",
                                    }).map(([name, value]) => (
                                        <Button key={name} size="small" type="text" disabled={locked} onClick={() => setInstruction(value)}>
                                            {name}
                                        </Button>
                                    ))}
                                </div>
                            </div>
                            <div className="ec-frame-render-options">
                                {!!models.length && (
                                    <label>
                                        图片模型{" "}
                                        <select value={model} disabled={locked} onChange={(e) => setSelectedModel(e.target.value)}>
                                            {models.map((item) => (
                                                <option key={item} value={item}>
                                                    {modelDisplayName(config, item)}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                )}
                                {!receipt && (
                                    <>
                                        {(!imageEnabled || !request) && <p role="status">{imageEnabled ? "暂无支持两张参考图的系统图片模型。也可直接上传已有同框图。" : "图片生成暂未开放，可直接上传已有同框图。"}</p>}
                                        {price && <p role="status">1 张同框图 · 最高 {price.amountMicrocredits / 1_000_000} 积分</p>}
                                        <Button
                                            type="primary"
                                            disabled={locked || !imageEnabled || !sources.person || !sources.product || !request}
                                            loading={working === "compose"}
                                            aria-label={price ? "确认合成 1 张同框图" : "查看同框图报价"}
                                            onClick={() => void run(compose)}
                                        >
                                            {price ? "确认合成 1 张同框图" : "查看同框图报价"}
                                        </Button>
                                    </>
                                )}
                                {unknown && (
                                    <>
                                        <p role="status">同框图提交回执待核对</p>
                                        <Button disabled={busy} onClick={() => void run(recover)}>
                                            核对同框图任务
                                        </Button>
                                        <Button size="small" type="text" disabled={busy || disabled || !checkedUnknown} onClick={clear}>
                                            已核对，重新准备
                                        </Button>
                                    </>
                                )}
                                {receipt?.taskId &&
                                    (readTask.isError ? (
                                        <Button onClick={() => void readTask.refetch()}>重新读取同框图任务</Button>
                                    ) : !task || ["queued", "running"].includes(task.status) ? (
                                        <p role="status">正在合成人物与商品同框图…</p>
                                    ) : (
                                        <>
                                            {output ? (
                                                <>
                                                    <CachedResourceImage
                                                        key={output.resourceId + ":" + previewAttempt}
                                                        storageKey={resourceStorageKey(output.resourceId)}
                                                        alt="合成的人物与商品同框图"
                                                        onLoad={() => setPreviewed(output.resourceId)}
                                                        onError={() => setPreviewed("")}
                                                        loadingFallback={<span role="status">正在读取合成原图…</span>}
                                                        fallback={
                                                            <Button disabled={busy} onClick={() => setPreviewAttempt((value) => value + 1)}>
                                                                重新读取合成原图
                                                            </Button>
                                                        }
                                                    />
                                                    <Button
                                                        disabled={busy || disabled || previewed !== output.resourceId}
                                                        onClick={() =>
                                                            void run(async (signal) => {
                                                                await verify(output, signal);
                                                                setInputs((value) => ({ ...value, product: receipt.product }));
                                                                onUse(output);
                                                                clear();
                                                                setOpened(false);
                                                            })
                                                        }
                                                    >
                                                        {isReference ? "用作复刻商品参考图" : "用作口播首帧"}
                                                    </Button>
                                                </>
                                            ) : pendingSettlement ? (
                                                <p role="status">原任务的费用或取消结果仍在核对，请稍后刷新任务。</p>
                                            ) : (
                                                <p role="status">{task.status === "succeeded" ? "未取得可用的原图，可在任务中心核对保存结果。" : "同框图合成未完成，原素材已保留。"}</p>
                                            )}
                                            {task.canRecoverMedia ? (
                                                <Button
                                                    disabled={busy || disabled}
                                                    onClick={() =>
                                                        void run(async (signal) => {
                                                            await recoverGenerationTaskMedia(task.id);
                                                            signal.throwIfAborted();
                                                            await readTask.refetch();
                                                        })
                                                    }
                                                >
                                                    重新保存原任务的图片
                                                </Button>
                                            ) : pendingSettlement ? (
                                                <Button disabled={busy} onClick={() => void readTask.refetch()}>
                                                    刷新原任务
                                                </Button>
                                            ) : (
                                                <Button type="text" size="small" disabled={busy || disabled} onClick={clear}>
                                                    {output ? "重新准备同框图" : "返回核对素材与报价"}
                                                </Button>
                                            )}
                                        </>
                                    ))}
                                {error && <p role="alert">{error}</p>}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </details>
    );
}
