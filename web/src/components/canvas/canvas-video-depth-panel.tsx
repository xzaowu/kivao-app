import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { canvasThemes } from "@/lib/canvas-theme";
import { listVideoEnhanceModels } from "@/lib/canvas/canvas-video-enhance";
import { VIDEO_DEPTH_CAPTURE_OPERATION, videoDepthMaxSeconds, videoDepthQuoteRequest, videoDepthSourceError } from "@/lib/canvas/canvas-video-depth";
import { modelQuoteDescription } from "@/lib/model-pricing";
import { quoteModel, type LogicalModelQuote } from "@/services/api/logical-models";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { modelDisplayName, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasNodeData } from "@/types/canvas";

export function CanvasVideoDepthPanel({
    source,
    config,
    savedModel,
    isRunning = false,
    completed = false,
    failed = false,
    modelLocked = false,
    onClose,
    onModelChange,
    onConfirm,
}: {
    source?: CanvasNodeData;
    config: AiConfig;
    savedModel?: string;
    isRunning?: boolean;
    completed?: boolean;
    failed?: boolean;
    modelLocked?: boolean;
    onClose: () => void;
    onModelChange: (model: string) => void;
    onConfirm: (model: string) => Promise<void> | void;
}) {
    const theme = canvasThemes[useActiveTheme()];
    const models = useMemo(() => listVideoEnhanceModels(config, VIDEO_DEPTH_CAPTURE_OPERATION), [config]);
    const model = savedModel || models[0] || "";
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const maxSeconds = videoDepthMaxSeconds(config, model);
    const error = source ? videoDepthSourceError(source, maxSeconds) : "源视频已删除或不可用，请重新选择原视频";
    const [quoted, setQuoted] = useState<{ key: string; quote: LogicalModelQuote } | null>(null);
    const [quoteError, setQuoteError] = useState("");
    const [quoteAttempt, setQuoteAttempt] = useState(0);
    const submitted = useRef(false);
    const [submitting, setSubmitting] = useState(false);
    const request = models.includes(model) && !error && !isRunning && !completed ? videoDepthQuoteRequest(config, model, source?.metadata?.durationMs || 0) : undefined;
    const requestKey = JSON.stringify([request, source?.id, source?.metadata?.storageKey, source?.metadata?.durationMs]);
    const quote = quoted && quoted.key === requestKey ? quoted.quote : null;
    useEffect(() => {
        setQuoted(null);
        setQuoteError("");
        if (!creditsEnabled || !request) return;
        const controller = new AbortController();
        quoteModel(request, controller.signal)
            .then(({ quote }) => {
                if (!controller.signal.aborted) setQuoted({ key: requestKey, quote });
            })
            .catch(() => {
                if (!controller.signal.aborted) setQuoteError("积分报价暂不可用，请重试");
            });
        return () => controller.abort();
        // 报价身份包含模型、源视频时长；过期响应不可启用新配置的提交按钮。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [creditsEnabled, requestKey, quoteAttempt]);
    const busy = isRunning || submitting;
    const canChangeModel = !busy && !completed && !failed && !modelLocked;
    const ready = !busy && !completed && models.includes(model) && !error && (!creditsEnabled || Boolean(quote));
    return (
        <section
            aria-label="深度动作捕捉设置"
            data-canvas-no-zoom
            data-canvas-wheel-scroll
            className="w-full rounded-[var(--r-xl)] border p-4 text-sm"
            style={{ background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="font-medium">深度动作捕捉</h3>
                <button type="button" aria-label="关闭深度动作捕捉设置" onClick={onClose} className="grid size-11 shrink-0 place-items-center rounded-[var(--r-md)] focus-visible:outline-2">
                    <X className="size-4" />
                </button>
            </div>
            {!models.length ? (
                <p role="alert">暂无可用的深度动作捕捉模型，请联系管理员。</p>
            ) : (
                <>
                    {!models.includes(model) ? (
                        <p role="status" className="mb-3 text-sm">
                            {canChangeModel ? "原模型已不可用，请选择可用模型。" : "原模型已不可用，请从原视频新建捕捉任务。"}
                        </p>
                    ) : null}
                    {models.length > 1 || !models.includes(model) ? (
                        <SegmentedControl
                            disabled={!canChangeModel}
                            ariaLabel="深度动作捕捉模型"
                            value={model}
                            onChange={(value) => {
                                if (canChangeModel) onModelChange(value);
                            }}
                            options={models.map((value) => ({ value, label: modelDisplayName(config, value) }))}
                        />
                    ) : (
                        <p>{modelDisplayName(config, model)}</p>
                    )}
                    <p className="my-3 text-xs" style={{ color: theme.node.muted }}>
                        原片 {((source?.metadata?.durationMs || 0) / 1000).toFixed(2)} 秒 · 上限 {maxSeconds} 秒
                    </p>
                    {error ? (
                        <p role="alert" className="text-sm text-destructive">
                            {error}
                        </p>
                    ) : null}
                    {creditsEnabled && request && !busy && !completed ? (
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                            <p role="status">{quoteError || (quote ? modelQuoteDescription(quote) : "正在计算积分…")}</p>
                            {quoteError ? (
                                <button type="button" className="min-h-11 rounded-[var(--r-md)] px-3 underline underline-offset-4 focus-visible:outline-2" onClick={() => setQuoteAttempt((attempt) => attempt + 1)}>
                                    重试报价
                                </button>
                            ) : null}
                        </div>
                    ) : null}
                </>
            )}
            <button
                type="button"
                aria-busy={busy}
                className="mt-3 min-h-11 w-full rounded-[var(--r-md)] font-medium focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: theme.node.text, color: theme.node.panel }}
                disabled={!ready}
                onClick={async () => {
                    if (!ready || submitted.current) return;
                    submitted.current = true;
                    setSubmitting(true);
                    try {
                        await onConfirm(model);
                    } finally {
                        submitted.current = false;
                        setSubmitting(false);
                    }
                }}
            >
                {busy ? "捕捉中…" : completed ? "已完成" : failed ? "重试捕捉" : "开始捕捉"}
            </button>
        </section>
    );
}
