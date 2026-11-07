import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { listVideoEnhanceModels } from "@/lib/canvas/canvas-video-enhance";
import { VIDEO_DEPTH_CAPTURE_OPERATION, videoDepthMaxSeconds, videoDepthQuoteRequest, videoDepthSourceError } from "@/lib/canvas/canvas-video-depth";
import { modelQuoteDescription } from "@/lib/model-pricing";
import { quoteModel, type LogicalModelQuote } from "@/services/api/logical-models";
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
    onClose: () => void;
    onModelChange: (model: string) => void;
    onConfirm: (model: string) => Promise<void> | void;
}) {
    const theme = canvasThemes[useActiveTheme()];
    const models = useMemo(() => listVideoEnhanceModels(config, VIDEO_DEPTH_CAPTURE_OPERATION), [config]);
    const model = savedModel || models[0] || "";
    const creditsEnabled = useUserStore((s) => s.features.creditsEnabled);
    const maxSeconds = videoDepthMaxSeconds(config, model);
    const error = source ? videoDepthSourceError(source, maxSeconds) : "源视频已删除或不可用，请重新选择原视频";
    const [quoted, setQuoted] = useState<{ key: string; quote: LogicalModelQuote } | null>(null);
    const submitted = useRef(false);
    const [quoteError, setQuoteError] = useState("");
    const validModel = models.includes(model);
    const request = validModel && !error && !isRunning && !completed ? videoDepthQuoteRequest(config, model, source?.metadata?.durationMs || 0) : undefined;
    const requestKey = JSON.stringify(request);
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
                if (!controller.signal.aborted) setQuoteError("积分报价暂不可用，请稍后重新打开");
            });
        return () => controller.abort();
        // Request identity includes the selected model and measured source duration.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [creditsEnabled, requestKey]);
    const ready = !isRunning && !completed && validModel && !error && (!creditsEnabled || Boolean(quote));
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
            <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="font-medium">深度动作捕捉</h3>
                <button type="button" aria-label="关闭深度动作捕捉设置" onClick={onClose} className="grid size-7 place-items-center rounded-[var(--r-md)]">
                    <X className="size-4" />
                </button>
            </div>
            {!models.length ? (
                <p role="alert">管理员尚未配置可用的深度动作捕捉模型，请在模型渠道中配置火山 MediaKit 对应协议。</p>
            ) : (
                <>
                    {models.length > 1 ? (
                        <SegmentedControl disabled={isRunning || completed || failed} ariaLabel="深度动作捕捉模型" value={model} onChange={onModelChange} options={models.map((value) => ({ value, label: modelDisplayName(config, value) }))} />
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
                    {creditsEnabled && !error && !isRunning && !completed ? (
                        <p className="text-sm" role="status">
                            {quoteError || (quote ? modelQuoteDescription(quote) : "正在计算积分…")}
                        </p>
                    ) : null}
                </>
            )}
            <button
                type="button"
                className="mt-3 h-9 w-full rounded-[var(--r-md)] font-medium disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: theme.node.text, color: theme.node.panel }}
                disabled={!ready}
                onClick={async () => {
                    if (!ready || submitted.current) return;
                    submitted.current = true;
                    try {
                        await onConfirm(model);
                    } finally {
                        submitted.current = false;
                    }
                }}
            >
                {isRunning ? "捕捉中…" : completed ? "已完成" : failed ? "重试捕捉" : "开始捕捉"}
            </button>
        </section>
    );
}
