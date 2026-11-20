import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "antd";
import { Plus, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createClientUUID } from "@/lib/client-id";
import { assertCurrentUserSession, captureUserSession } from "@/lib/user-scope";
import { systemModelQuoteRequest } from "@/lib/model-pricing";
import { modelCompatibilityError, type ModelRequirements } from "@/lib/model-selection";
import { parseBackendGenerationResult, prepareBackendGenerationTask } from "@/services/api/generation-task";
import { quoteModel, type LogicalModelQuote } from "@/services/api/logical-models";
import { resourceStorageKey } from "@/services/api/resources";
import { ApiError } from "@/services/api/request";
import { createGenerationTask, listGenerationTasks, queryGenerationTask } from "@/services/api/task-center";
import type { AiConfig } from "@/stores/use-config-store";
import { productClaimSuggestions } from "./product-video";
import { matchingClaimTask, readClaimReceipt, replaceClaimReceipt, type ClaimReceipt } from "./product-video-claims-receipt";

type ProductImage = { resourceId: string; name: string };
const prompt =
    '观察全部商品参考图，把能直接从画面证实、适合在短视频中展示的特点写进 visibleDescription。同一处细节只写一次；图中信息冲突或看不清时略过。每行一个具体的候选卖点，最多五行。不要推断材质、功效、性能、价格、认证或促销。只返回 JSON 对象 {"category":"商品类别","visibleDescription":"可确认的卖点"}。';

type Props = {
    scope: string;
    projectId?: string;
    frame?: ProductImage;
    images?: readonly ProductImage[];
    config: AiConfig;
    model: string;
    unavailable: string;
    disabled: boolean;
    facts: string;
    onAccept: (point: string) => void;
    ensureProject: () => Promise<string>;
    setSubmitting: (busy: boolean) => void;
};

export function ProductVideoClaims({ scope, projectId, frame, images, config, model, unavailable, disabled, facts, onAccept, ensureProject, setSubmitting }: Props) {
    const client = useQueryClient();
    const inputs = images ?? (frame ? [frame] : []);
    const imageIds = inputs.map((image) => image.resourceId);
    const validInputs = inputs.length >= 1 && inputs.length <= 3 && imageIds.every(Boolean) && new Set(imageIds).size === imageIds.length;
    const receiptScope = (id: string) => [scope, id, ...imageIds] as const;
    const key = (id: string) => ["product-video-claims-receipt", ...receiptScope(id)];
    const receiptQuery = useQuery({
        queryKey: key(projectId || ""),
        enabled: Boolean(projectId && validInputs && scope !== "guest"),
        queryFn: () => readClaimReceipt(receiptScope(projectId!)),
        retry: false,
    });
    const receipt = receiptQuery.data || null;
    const taskId = receipt?.taskId || "";
    const unknown = Boolean(receipt?.operationId && !taskId);
    const [checkedMissing, setCheckedMissing] = useState("");
    const [review, setReview] = useState<{ selection: string; quote: LogicalModelQuote } | null>(null);
    const [error, setError] = useState("");
    const lock = useRef(false);
    const lifetime = useRef<AbortController | null>(null);
    useEffect(() => {
        const current = new AbortController();
        lifetime.current = current;
        return () => current.abort();
    }, []);

    const query = useQuery({
        queryKey: ["product-video-claims", scope, projectId, taskId],
        enabled: Boolean(taskId),
        queryFn: async ({ signal }) => {
            const found = await queryGenerationTask(taskId, { signal });
            if (!receipt || !projectId || !matchingClaimTask(found, projectId, receipt)) throw new Error("分析记录与当前任务不符。");
            return found;
        },
        retry: false,
        refetchInterval: ({ state }) => (state.data?.status === "running" || state.data?.status === "queued" ? 1500 : false),
    });
    const task = query.isError || receiptQuery.isError ? undefined : query.data;
    const pending = Boolean(taskId && (!task || task.status === "queued" || task.status === "running"));
    const storageUnavailable = Boolean(projectId && validInputs && (receiptQuery.isLoading || receiptQuery.isError));
    const awaitingBilling = task?.billing?.status === "uncertain" || task?.providerCancelStatus === "uncertain" || task?.providerCancelStatus === "requested";
    const unresolved = pending || unknown || query.isError || storageUnavailable || awaitingBilling;
    const needs: ModelRequirements = { capability: "text", input: { textCount: 1, imageCount: inputs.length, referenceImageCount: inputs.length, videoCount: 0, audioCount: 0, characterCount: 0 } };
    const issue = !inputs.length ? "添加商品图后可用 AI 分析。" : !validInputs ? "请选择 1–3 张不同的商品图。" : !model ? unavailable || "目前没有可用的商品识别模型，可以手填卖点。" : modelCompatibilityError(config, model, needs);
    const hasRequest = !issue && systemModelQuoteRequest(config, model, "text", needs);
    const selection = JSON.stringify([scope, model, ...imageIds]);
    const quote = review?.selection === selection ? review.quote : null;
    let suggestions: string[] = [];
    let resultMessage = "";
    if (task?.status === "succeeded") {
        try {
            suggestions = productClaimSuggestions(parseBackendGenerationResult(task).text || "");
            if (!suggestions.length) resultMessage = "没有从商品图中识别出可确认的卖点，可以换图或手填。";
        } catch {
            resultMessage = "模型未返回可用的卖点，可以重新分析或手填。";
        }
    } else if (task?.status === "failed" || task?.status === "cancelled") {
        resultMessage = task.status === "cancelled" ? "分析已取消。" : "本次分析失败，可以重试或手填。";
    }

    async function analyze() {
        if (!hasRequest || lock.current || unresolved || disabled || scope === "guest") return;
        const signal = lifetime.current!.signal;
        let admitted: ClaimReceipt | null = null;
        let id = "";
        lock.current = true;
        setSubmitting(true);
        setError("");
        try {
            const session = captureUserSession();
            if (session.scope !== scope) throw new Error("账号已切换，请重新读取。");
            const fresh = (await quoteModel(hasRequest, signal)).quote;
            signal.throwIfAborted();
            assertCurrentUserSession(session);
            if (!Number.isSafeInteger(fresh.amountMicrocredits) || fresh.amountMicrocredits < 0) throw new Error("分析报价无效，请重新获取");
            if (!quote || fresh.amountMicrocredits !== quote.amountMicrocredits || fresh.billingMode !== quote.billingMode || fresh.estimated !== quote.estimated) {
                setReview({ selection, quote: fresh });
                if (quote) setError("分析报价已更新，请重新确认。");
                return;
            }
            id = await ensureProject();
            signal.throwIfAborted();
            assertCurrentUserSession(session);
            if (!id || (projectId && projectId !== id)) throw new Error("商品项目已切换。");
            const operationId = createClientUUID();
            const input = await prepareBackendGenerationTask({
                projectId: id,
                mode: "text",
                prompt,
                config: { ...config, model, taskWorkflowProvider: "model" },
                clientOperationId: operationId,
                streamText: false,
                signal,
                referenceImages: inputs.map((image) => ({ id: image.resourceId, name: image.name, type: "image/*", dataUrl: "", storageKey: resourceStorageKey(image.resourceId) })),
                metadata: { source: "ecommerce-agent", stage: "product-understanding", ecommerceProjectId: id, assetTitle: "商品视频 · 卖点分析", ...(images && { productVideoClaims: true }) },
            });
            signal.throwIfAborted();
            assertCurrentUserSession(session);
            const entry = { operationId };
            await replaceClaimReceipt(receiptScope(id), receipt, entry);
            admitted = entry;
            client.setQueryData(key(id), entry);
            signal.throwIfAborted();
            assertCurrentUserSession(session);
            const created = await createGenerationTask(input);
            if (!matchingClaimTask(created, id, entry)) throw new Error("分析回执与原请求不符。");
            const acknowledged = { ...entry, taskId: created.id };
            await replaceClaimReceipt(receiptScope(id), entry, acknowledged);
            client.setQueryData(key(id), acknowledged);
            if (!signal.aborted) setReview(null);
        } catch (cause) {
            let ambiguous = Boolean(admitted);
            if (admitted && cause instanceof ApiError && [400, 422].includes(cause.status || 0)) {
                try {
                    await replaceClaimReceipt(receiptScope(id), admitted, receipt);
                    client.setQueryData(key(id), receipt);
                    ambiguous = false;
                } catch {
                    // A changed or unreadable receipt must still be reconciled.
                }
            }
            if (id) void client.invalidateQueries({ queryKey: key(id) });
            if (!signal.aborted) {
                setReview(null);
                setError(ambiguous ? "提交结果待核对，已保留原卖点。" : cause instanceof Error && cause.name === "Error" ? cause.message : "无法确认分析回执或报价，请检查浏览器存储后重试。");
            }
        } finally {
            lock.current = false;
            if (!signal.aborted) setSubmitting(false);
        }
    }

    async function reconcile(release = false) {
        if (!projectId || !receipt?.operationId || taskId || lock.current || disabled) return;
        const signal = lifetime.current!.signal;
        lock.current = true;
        setSubmitting(true);
        setError("");
        try {
            const session = captureUserSession();
            if (session.scope !== scope) throw new Error("账号已切换，请重新打开项目。");
            const tasks = await listGenerationTasks(100, { projectId }, undefined, signal);
            signal.throwIfAborted();
            assertCurrentUserSession(session);
            const matches = tasks.filter((item) => matchingClaimTask(item, projectId, receipt));
            if (matches.length > 1) throw new Error("找到多个关联任务，请在任务中心核对。");
            if (!matches.length && !(release && checkedMissing === receipt.operationId)) {
                setCheckedMissing(receipt.operationId);
                return;
            }
            const next = matches[0] ? { ...receipt, taskId: matches[0].id } : null;
            await replaceClaimReceipt(receiptScope(projectId), receipt, next);
            client.setQueryData(key(projectId), next);
            if (!signal.aborted) {
                setCheckedMissing("");
                setReview(null);
            }
        } catch {
            if (!signal.aborted) {
                setCheckedMissing("");
                setError("暂时无法核对唯一的分析记录。原回执已保留，请稍后重试或前往任务中心。");
            }
            void client.invalidateQueries({ queryKey: key(projectId) });
        } finally {
            lock.current = false;
            if (!signal.aborted) setSubmitting(false);
        }
    }

    return (
        <div className="ec-video-claims">
            <div className="ec-video-row">
                <Button size="small" icon={<Sparkles size={14} />} disabled={disabled || !hasRequest || unresolved} onClick={() => void analyze()}>
                    {unknown ? "分析待核对" : pending ? "分析中…" : quote ? `确认分析 · ${quote.estimated ? "约 " : ""}${quote.amountMicrocredits / 1_000_000} 积分` : task ? "重新分析卖点" : "AI 分析卖点"}
                </Button>
            </div>
            {!hasRequest ? <small>{issue || "当前商品识别模型无法报价，可以手填卖点。"}</small> : inputs.length > 1 ? <small>将一起分析这 {inputs.length} 张商品图。</small> : null}
            {error ? <p role="alert">{error}</p> : null}
            {receiptQuery.isError && (
                <p role="alert">
                    无法读取本机分析回执。
                    <Button size="small" onClick={() => void receiptQuery.refetch()}>
                        重新读取回执
                    </Button>
                </p>
            )}
            {unknown && !receiptQuery.isError && (
                <div className="ec-video-row">
                    <Button size="small" disabled={disabled} onClick={() => void reconcile()}>
                        核对卖点分析任务
                    </Button>
                    {checkedMissing === receipt?.operationId && (
                        <>
                            <small role="status">近期任务未找到该次分析。请先到任务中心核对。</small>
                            <Button size="small" disabled={disabled} onClick={() => void reconcile(true)}>
                                已人工核对，允许重新分析
                            </Button>
                        </>
                    )}
                </div>
            )}
            {query.isError ? (
                <p role="alert">
                    分析记录暂时无法读取。
                    <Button size="small" onClick={() => void query.refetch()}>
                        重新读取
                    </Button>
                </p>
            ) : null}
            {awaitingBilling ? <small role="status">该任务的费用仍在核对中。</small> : resultMessage ? <small role="status">{resultMessage}</small> : null}
            {suggestions.length ? (
                <div className="ec-video-suggestions" role="group" aria-label="AI 候选卖点">
                    <small role="status">AI 建议 · 核对后点选加入</small>
                    {suggestions.map((point) => {
                        const accepted = facts.split("\n").some((line) => line.trim() === point);
                        return (
                            <button type="button" key={point} disabled={accepted || disabled} onClick={() => onAccept(point)}>
                                <span>{point}</span>
                                {accepted ? <small>已加入</small> : <Plus size={15} aria-hidden />}
                            </button>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
