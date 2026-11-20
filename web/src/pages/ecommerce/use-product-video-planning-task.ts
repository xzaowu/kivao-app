import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createClientUUID } from "@/lib/client-id";
import { systemModelQuoteRequest } from "@/lib/model-pricing";
import { modelCompatibilityError, modelPromptLengthError, type ModelRequirements } from "@/lib/model-selection";
import { prepareBackendGenerationTask } from "@/services/api/generation-task";
import { quoteModel, type LogicalModelQuote } from "@/services/api/logical-models";
import { ApiError } from "@/services/api/request";
import { createGenerationTask, listGenerationTasks, queryGenerationTask } from "@/services/api/task-center";
import type { AiConfig } from "@/stores/use-config-store";
import type { PlanningTarget } from "./product-video-planning";

export type ScriptTarget = PlanningTarget | "voice";
type Target = ScriptTarget | "brief";
export type PlanningReceipt<T extends Target> = { projectId: string; operationId: string; taskId?: string; target: T; instruction: string };
const needs: ModelRequirements = { capability: "text", input: { textCount: 1, imageCount: 0, referenceImageCount: 0, videoCount: 0, audioCount: 0, characterCount: 0 } };
const receiptKey = (scope: string, projectId: string, brief: boolean) => JSON.stringify([brief ? "ecommerce-video-shoot-brief" : "ecommerce-video-planning", scope, projectId]);

export function readPlanningReceipt(scope: string, projectId: string | undefined, brief: true): PlanningReceipt<"brief"> | null;
export function readPlanningReceipt(scope: string, projectId: string | undefined, brief: false): PlanningReceipt<ScriptTarget> | null;
export function readPlanningReceipt(scope: string, projectId: string | undefined, brief: boolean): PlanningReceipt<Target> | null {
    if (!projectId) return null;
    try {
        const item = JSON.parse(sessionStorage.getItem(receiptKey(scope, projectId, brief)) || "null");
        return item?.projectId === projectId &&
            typeof item.operationId === "string" &&
            item.operationId &&
            (brief ? item.target === "brief" : ["all", "voice", 0, 1, 2].includes(item.target)) &&
            typeof item.instruction === "string" &&
            (item.taskId === undefined || typeof item.taskId === "string")
            ? item
            : null;
    } catch {
        return null;
    }
}

export type VideoPlanningTaskProps = {
    scope: string;
    projectId?: string;
    config: AiConfig;
    model: string;
    unavailable: string;
    disabled: boolean;
    ensureProject: () => Promise<string>;
    setSubmitting: (value: boolean) => void;
};

export function useVideoPlanningTask<T extends Target>({
    scope,
    projectId,
    config,
    model,
    unavailable,
    disabled,
    ensureProject,
    setSubmitting,
    prompt,
    assetTitle,
    target,
    instruction,
    missing,
    receipt,
    setReceipt,
}: VideoPlanningTaskProps & {
    prompt: string;
    assetTitle: string;
    target: T;
    instruction: string;
    missing: string;
    receipt: PlanningReceipt<T> | null;
    setReceipt: (item: PlanningReceipt<T> | null) => void;
}) {
    const brief = target === "brief";
    const queryGroup = brief ? "video-brief-suggestion" : "video-script-suggestion";
    const [review, setReview] = useState<{ key: string; price: LogicalModelQuote } | null>(null);
    const [error, setError] = useState("");
    const [checking, setChecking] = useState(false);
    const [checkedMissing, setCheckedMissing] = useState("");
    const [posting, setPosting] = useState(false);
    const lock = useRef(false);
    const lifetime = useRef<AbortController | null>(null);
    useEffect(() => {
        const current = new AbortController();
        lifetime.current = current;
        return () => current.abort();
    }, []);

    const client = useQueryClient();
    const query = useQuery({
        queryKey: [queryGroup, scope, receipt?.projectId, receipt?.taskId],
        enabled: Boolean(receipt?.taskId),
        queryFn: ({ signal }) => queryGenerationTask(receipt!.taskId!, { signal }),
        staleTime: Infinity,
        retry: false,
        refetchInterval: ({ state }) => (!state.error && (state.data?.status === "queued" || state.data?.status === "running") ? 1500 : false),
    });
    const task = query.data;
    const quoteRequest = systemModelQuoteRequest(config, model, "text", needs);
    const key = JSON.stringify([scope, model, prompt, quoteRequest]);
    const latest = useRef(key);
    useLayoutEffect(() => {
        latest.current = key;
    }, [key]);
    const price = review?.key === key ? review.price : null;
    const issue = missing || (!model ? unavailable || "当前没有可用的策划模型。" : modelCompatibilityError(config, model, needs) || modelPromptLengthError(config, model, "text", prompt) || (!quoteRequest ? "当前策划模型无法报价。" : ""));
    const unknown = Boolean(receipt && !receipt.taskId);
    function remember(item: PlanningReceipt<T>) {
        try {
            sessionStorage.setItem(receiptKey(scope, item.projectId, brief), JSON.stringify(item));
        } catch {
            /* Page state still tracks this task. */
        }
        if (!lifetime.current?.signal.aborted) setReceipt(item);
    }
    function dismiss() {
        if (receipt) {
            try {
                sessionStorage.removeItem(receiptKey(scope, receipt.projectId, brief));
            } catch {
                /* A denied storage write does not affect the draft. */
            }
        }
        setReceipt(null);
        setError("");
        setReview(null);
        setCheckedMissing("");
    }
    async function request() {
        if (disabled || lock.current || receipt || issue || !quoteRequest) return;
        const signal = lifetime.current!.signal;
        let sent: PlanningReceipt<T> | undefined;
        lock.current = true;
        setSubmitting(true);
        setError("");
        try {
            const fresh = (await quoteModel(quoteRequest, signal)).quote;
            signal.throwIfAborted();
            if (latest.current !== key) return;
            if (!Number.isSafeInteger(fresh.amountMicrocredits) || fresh.amountMicrocredits < 0) throw new Error("策划报价无效，请重新获取。");
            if (!price || price.amountMicrocredits !== fresh.amountMicrocredits || price.billingMode !== fresh.billingMode || price.estimated !== fresh.estimated || price.quantity !== fresh.quantity) {
                setReview({ key, price: fresh });
                if (price) setError("策划报价已更新，请核对后确认。");
                return;
            }
            const id = await ensureProject();
            signal.throwIfAborted();
            if (!id || (projectId && id !== projectId)) throw new Error("商品项目已切换，请重新打开简报或分镜。");
            const operationId = createClientUUID();
            const input = await prepareBackendGenerationTask({
                projectId: id,
                mode: "text",
                config: { ...config, model, taskWorkflowProvider: "model" },
                prompt,
                streamText: false,
                signal,
                clientOperationId: operationId,
                metadata: {
                    source: "ecommerce-agent",
                    stage: "product-video-storyboard",
                    ecommerceProjectId: id,
                    assetTitle,
                },
            });
            signal.throwIfAborted();
            if (latest.current !== key) return;
            const entry = { projectId: id, operationId, target, instruction };
            const storageKey = receiptKey(scope, id, brief);
            if (sessionStorage.getItem(storageKey)) throw new Error("当前项目有一笔策划任务待核对，请重新打开工作台。");
            sessionStorage.setItem(storageKey, JSON.stringify(entry));
            sent = entry;
            setPosting(true);
            setReceipt(sent);
            const created = await createGenerationTask(input);
            if (!created.id || created.projectId !== id || created.type !== "canvas_text") throw new Error("策划任务回执与当前项目不符");
            if (!signal.aborted) client.setQueryData([queryGroup, scope, id, created.id], created);
            remember({ ...sent, taskId: created.id });
            if (!signal.aborted) setReview(null);
        } catch (cause) {
            if (signal.aborted) return;
            setReview(null);
            const ambiguous = sent && (!(cause instanceof ApiError) || !cause.status || [408, 409].includes(cause.status) || cause.status >= 500);
            if (!ambiguous) {
                if (sent) {
                    try {
                        sessionStorage.removeItem(receiptKey(scope, sent.projectId, brief));
                    } catch {
                        /* Storage is optional. */
                    }
                    setReceipt(null);
                }
                setError(cause instanceof Error ? cause.message : "策划请求失败。");
            }
        } finally {
            lock.current = false;
            if (!signal.aborted) {
                setPosting(false);
                setSubmitting(false);
            }
        }
    }
    async function checkUnknown() {
        if (!receipt || receipt.taskId || checking) return;
        const signal = lifetime.current!.signal;
        setChecking(true);
        setError("");
        try {
            const tasks = await listGenerationTasks(100, { projectId: receipt.projectId }, undefined, signal);
            signal.throwIfAborted();
            const matches = tasks.filter((item) => item.projectId === receipt.projectId && item.type === "canvas_text" && item.clientOperationId === receipt.operationId);
            if (matches.length === 1) remember({ ...receipt, taskId: matches[0].id });
            else if (matches.length === 0) {
                setCheckedMissing(receipt.operationId);
                setError("近期任务里尚未找到对应回执，可稍后再次核对。");
            } else {
                setCheckedMissing("");
                setError("有多条关联记录，请先在任务中心核对。");
            }
        } catch {
            if (!signal.aborted) setError("暂时无法读取任务，请稍后核对。");
        } finally {
            if (!signal.aborted) setChecking(false);
        }
    }

    return { price, issue, unknown, query, task, posting, checking, canReleaseUnknown: Boolean(unknown && checkedMissing === receipt?.operationId), error, setError, request, checkUnknown, dismiss };
}
