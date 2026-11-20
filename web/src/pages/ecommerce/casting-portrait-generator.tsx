import { Button } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { AppModal } from "@/components/ui/product/app-modal";
import { createClientUUID } from "@/lib/client-id";
import { systemModelQuoteRequest } from "@/lib/model-pricing";
import { prepareBackendGenerationTask } from "@/services/api/generation-task";
import { quoteModel, type LogicalModelQuote } from "@/services/api/logical-models";
import { ApiError } from "@/services/api/request";
import { resourceIdFromStorageKey, resourceStorageKey } from "@/services/api/resources";
import { createGenerationTask, listGenerationTasks, queryGenerationTask, recoverGenerationTaskMedia } from "@/services/api/task-center";
import { getRemoteAsset } from "@/services/api/user-data";
import { materializeEffectKey } from "@/services/generation-task-materializer";
import { generationAssetId } from "@/stores/use-asset-store";
import { modelDisplayName, type AiConfig } from "@/stores/use-config-store";
import { castingModels, castingImageSettings, castingOutput, portraitRequirements } from "./casting-image-task";
import { appearanceFields, portraitLooks, portraitPrompt, restorePortraitBrief } from "./casting-portrait-brief";
import type { CastingPhoto } from "./product-video-frame-composer-casting";

type Receipt = { projectId: string; operationId: string; taskId?: string; title: string };
const receiptKey = (scope: string, projectId: string) => JSON.stringify(["ecommerce-casting-portrait", scope, projectId]);

function readReceipt(scope: string, projectId?: string): Receipt | null {
    if (!projectId) return null;
    const raw = sessionStorage.getItem(receiptKey(scope, projectId));
    if (!raw) return null;
    const r: Receipt = JSON.parse(raw);
    if (r?.projectId !== projectId || typeof r.title !== "string" || !r.title || !/^[a-f\d-]{36}$/i.test(r.operationId) || (r.taskId !== undefined && (typeof r.taskId !== "string" || !r.taskId)))
        throw new Error("模特任务回执无法读取，请先到任务中心核对。");
    return r;
}

type Props = {
    scope: string;
    sessionId: string;
    projectId?: string;
    config: AiConfig;
    imageEnabled: boolean;
    busy: boolean;
    error: string;
    ensureProject: () => Promise<string>;
    run: (action: (signal: AbortSignal) => Promise<void>) => Promise<void>;
    onUse: (photo: CastingPhoto, signal: AbortSignal) => Promise<void>;
    onClose: () => void;
};

export function CastingPortraitGenerator({ scope, sessionId, projectId, config, imageEnabled, busy, error, ensureProject, run, onUse, onClose }: Props) {
    const id = useId();
    const [initial] = useState(() => {
        try {
            return { receipt: readReceipt(scope, projectId), error: "" };
        } catch {
            return { receipt: null, error: "无法读取本地模特任务回执，请开启站点存储，并在任务中心核对原任务。" };
        }
    });
    const [receipt, setReceipt] = useState(initial.receipt);
    const sessionDraft = JSON.stringify(["ecommerce-casting-brief", scope, "session", sessionId]);
    const draftKey = projectId ? JSON.stringify(["ecommerce-casting-brief", scope, "project", projectId]) : sessionDraft;
    const [brief, setBrief] = useState(() => {
        try {
            return restorePortraitBrief(JSON.parse(sessionStorage.getItem(draftKey) || sessionStorage.getItem(sessionDraft) || "null"));
        } catch {
            return restorePortraitBrief();
        }
    });
    useEffect(() => {
        try {
            sessionStorage.setItem(draftKey, JSON.stringify(brief));
            if (draftKey !== sessionDraft) sessionStorage.removeItem(sessionDraft);
        } catch {
            // Optional style preferences are independent of the paid task receipt.
        }
    }, [brief, draftKey, sessionDraft]);
    const look = portraitLooks.find((item) => item.name === brief.look)!;
    const [selectedModel, setModel] = useState(config.imageModel);
    const [review, setReview] = useState<{ key: string; quote: LogicalModelQuote } | null>(null);
    const [loaded, setLoaded] = useState("");
    const [checkedMissing, setCheckedMissing] = useState(false);
    const [previewAttempt, setPreviewAttempt] = useState(0);
    const models = castingModels(config, portraitRequirements);
    const model = models.includes(selectedModel) ? selectedModel : models[0];
    const settings = castingImageSettings(config, model);
    const request = settings && systemModelQuoteRequest(settings, model, "image", portraitRequirements);
    const prompt = portraitPrompt(brief);
    const key = JSON.stringify([prompt, request]);
    const price = review?.key === key ? review.quote : null;
    const query = useQuery({
        queryKey: ["ecommerce-casting-portrait-task", scope, receipt?.projectId, receipt?.taskId],
        enabled: !!receipt?.taskId,
        retry: false,
        queryFn: ({ signal }) => queryGenerationTask(receipt!.taskId!, { signal }),
        refetchInterval: ({ state }) => (!state.error && ["queued", "running"].includes(state.data?.status || "") ? 1600 : false),
    });
    const task = query.data;
    const photo = castingOutput(task, receipt, receipt?.title || "");
    const uncertain = task?.billing?.status === "uncertain" || task?.providerCancelStatus === "uncertain" || task?.providerCancelStatus === "requested";
    function persist(r: Receipt) {
        sessionStorage.setItem(receiptKey(scope, r.projectId), JSON.stringify(r));
        setReceipt(r);
    }
    function clear(r: Receipt) {
        const saved = readReceipt(scope, r.projectId);
        if (saved?.operationId === r.operationId) sessionStorage.removeItem(receiptKey(scope, r.projectId));
        setReceipt(null);
        setReview(null);
        setLoaded("");
        setCheckedMissing(false);
    }
    async function generate(signal: AbortSignal) {
        if (receipt || initial.error || !settings || !request || !imageEnabled || !model) return;
        const fresh = (await quoteModel(request, signal)).quote;
        signal.throwIfAborted();
        if (!Number.isSafeInteger(fresh.amountMicrocredits) || fresh.amountMicrocredits < 0) throw new Error("模特图报价不可用，请重新查看。");
        if (!price || price.amountMicrocredits !== fresh.amountMicrocredits || price.billingMode !== fresh.billingMode || price.estimated !== fresh.estimated || price.quantity !== fresh.quantity) {
            setReview({ key, quote: fresh });
            if (price) throw new Error("报价已更新，请重新确认。");
            return;
        }
        const project = await ensureProject();
        signal.throwIfAborted();
        if (!project) throw new Error("请先保存商品项目，再生成模特。");
        const previous = readReceipt(scope, project);
        if (previous) {
            setReceipt(previous);
            return;
        }
        const title = "AI 模特 · " + look.name;
        const r: Receipt = { projectId: project, operationId: createClientUUID(), title };
        const input = await prepareBackendGenerationTask({
            projectId: project,
            mode: "image",
            config: settings,
            signal,
            clientOperationId: r.operationId,
            prompt,
            metadata: { source: "ecommerce-agent", stage: "product-video-casting", ecommerceProjectId: project, assetTitle: title, ecommerceVideoQuote: { billingMode: fresh.billingMode, amountMicrocredits: fresh.amountMicrocredits } },
        });
        signal.throwIfAborted();
        persist(r);
        setReview(null);
        try {
            const created = await createGenerationTask({ ...input, operation: "text_to_image" });
            if (!created.id || created.type !== "canvas_image" || created.projectId !== project || created.clientOperationId !== r.operationId) throw new Error("回执待核对");
            persist({ ...r, taskId: created.id });
        } catch (cause) {
            if (cause instanceof ApiError && cause.status && cause.status < 500 && ![408, 409].includes(cause.status)) {
                clear(r);
                throw cause;
            }
            throw new Error("提交回执待核对，请先查找原模特任务。");
        }
    }
    async function recover(signal: AbortSignal) {
        if (!receipt) return;
        const tasks = await listGenerationTasks(100, { projectId: receipt.projectId }, undefined, signal);
        signal.throwIfAborted();
        const found = tasks.find((item) => item.id && item.type === "canvas_image" && item.projectId === receipt.projectId && item.clientOperationId === receipt.operationId);
        if (!found) {
            setCheckedMissing(true);
            throw new Error("尚未找到原任务，请稍后再查，或到任务中心确认没有提交成功。");
        }
        persist({ ...receipt, taskId: found.id });
    }
    async function adopt(signal: AbortSignal) {
        if (!receipt || !task || !photo || loaded !== photo.resourceId) return;
        const assetId = task.outputs?.find((o) => o.outputIndex === 0 && o.mediaType === "image")?.materializedAssetId || (await generationAssetId(materializeEffectKey(task.id, 0)));
        const { asset } = await getRemoteAsset(assetId);
        signal.throwIfAborted();
        if (asset.kind !== "image" || resourceIdFromStorageKey(asset.data.storageKey) !== photo.resourceId) throw new Error("私人素材库中的模特原图尚未就绪，请重新核对。");
        await onUse({ ...photo, name: asset.title || photo.name }, signal);
        clear(receipt);
        onClose();
    }
    return (
        <AppModal
            open
            title="AI 生成模特"
            width={520}
            footer={null}
            onCancel={() => {
                if (!busy) onClose();
            }}
        >
            <div className="ec-casting-picker ec-portrait-generator">
                {!receipt && (
                    <form
                        aria-label="生成虚拟模特"
                        onChange={() => setReview(null)}
                        onSubmit={(e) => {
                            e.preventDefault();
                            void run(generate);
                        }}
                    >
                        <fieldset disabled={busy}>
                            <legend>
                                出镜风格 <small>造型参考图</small>
                            </legend>
                            <div className="ec-portrait-looks">
                                {portraitLooks.map((item) => (
                                    <label key={item.name}>
                                        <input type="radio" name={id} value={item.name} checked={brief.look === item.name} onChange={() => setBrief({ ...brief, look: item.name })} />
                                        <img src={`/ecommerce-models/previews/${item.example}.webp`} alt="" width={240} height={320} />
                                        <span>{item.name}</span>
                                    </label>
                                ))}
                            </div>
                            <p className="ec-portrait-direction">{look.direction}</p>
                        </fieldset>
                        <fieldset disabled={busy}>
                            <legend>
                                模特形象 <small>选填</small>
                            </legend>
                            <div className="ec-portrait-attributes">
                                {appearanceFields.map(({ key, label, options }) => (
                                    <label key={key} htmlFor={id + key}>
                                        {label}
                                        <select id={id + key} name={key} value={brief[key]} onChange={(event) => setBrief({ ...brief, [key]: event.target.value })}>
                                            <option value="">AI 自选</option>
                                            {options.map((option) => (
                                                <option key={option} value={option}>
                                                    {option}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                ))}
                            </div>
                        </fieldset>
                        <div className="ec-portrait-detail">
                            <label htmlFor={id + "-detail"}>发型、妆容或穿搭（选填）</label>
                            <textarea id={id + "-detail"} name="detail" value={brief.detail} disabled={busy} rows={2} maxLength={400} onChange={(e) => setBrief({ ...brief, detail: e.target.value })} placeholder="例如齐肩短发、自然淡妆，穿浅蓝色衬衫" />
                        </div>
                        {models.length > 1 && (
                            <label>
                                图片模型
                                <select value={model} disabled={busy} onChange={(e) => setModel(e.target.value)}>
                                    {models.map((item) => (
                                        <option key={item} value={item}>
                                            {modelDisplayName(config, item)}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                        {!request || !imageEnabled ? (
                            <p role="status">{imageEnabled ? "暂无支持文生图的系统模型，可以从官方模特库选人。" : "图片生成暂未开放，可以从官方模特库选人。"}</p>
                        ) : (
                            <p>生成一张人物定妆照，保存在你的素材库，可在其他商品项目中复用。</p>
                        )}
                        {price && <p role="status">1 张模特图 · 最高 {price.amountMicrocredits / 1_000_000} 积分</p>}
                        <Button htmlType="submit" type="primary" loading={busy} disabled={busy || !request || !imageEnabled || !!initial.error}>
                            {price ? "确认生成 1 张模特图" : "查看模特图报价"}
                        </Button>
                    </form>
                )}
                {receipt &&
                    (!receipt.taskId ? (
                        <>
                            <p role="status">模特提交回执待核对</p>
                            <Button disabled={busy} onClick={() => void run(recover)}>
                                核对模特任务
                            </Button>
                            {checkedMissing && (
                                <Button disabled={busy} type="text" onClick={() => void run(async () => clear(receipt))}>
                                    已在任务中心核对，重新准备
                                </Button>
                            )}
                        </>
                    ) : query.isError ? (
                        <Button onClick={() => void query.refetch()}>重新读取模特任务</Button>
                    ) : !task || task.status === "queued" || task.status === "running" ? (
                        <p role="status">正在生成模特，稍后重开此入口可查看原任务。</p>
                    ) : (
                        <>
                            {photo && (
                                <>
                                    <CachedResourceImage
                                        key={photo.resourceId + ":" + previewAttempt}
                                        storageKey={resourceStorageKey(photo.resourceId)}
                                        alt={photo.name}
                                        onLoad={() => setLoaded(photo.resourceId)}
                                        onError={() => setLoaded("")}
                                        fallback={<Button onClick={() => setPreviewAttempt((n) => n + 1)}>重新读取模特原图</Button>}
                                    />
                                    <Button type="primary" disabled={busy || loaded !== photo.resourceId} onClick={() => void run(adopt)}>
                                        使用这位 AI 模特
                                    </Button>
                                </>
                            )}
                            {!photo && <p role="status">{uncertain ? "正在核对费用与任务状态。" : task.status === "succeeded" ? "模特原图暂未就绪，请核对原任务。" : "这次模特生成未完成，可以重新准备。"}</p>}
                            {task.canRecoverMedia ? (
                                <Button
                                    disabled={busy}
                                    onClick={() =>
                                        void run(async (signal) => {
                                            await recoverGenerationTaskMedia(task.id);
                                            signal.throwIfAborted();
                                            await query.refetch();
                                        })
                                    }
                                >
                                    重新保存原任务图片
                                </Button>
                            ) : uncertain ? (
                                <Button onClick={() => void query.refetch()}>刷新原任务</Button>
                            ) : (
                                <Button disabled={busy} type="text" onClick={() => void run(async () => clear(receipt))}>
                                    重新选风格
                                </Button>
                            )}
                        </>
                    ))}
                {(error || initial.error) && <p role="alert">{error || initial.error}</p>}
            </div>
        </AppModal>
    );
}
