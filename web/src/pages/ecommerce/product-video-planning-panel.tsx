import { Button, Input } from "antd";
import { ChevronDown, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { EcommerceDraft } from "@/services/api/ecommerce";
import { parseBackendGenerationResult } from "@/services/api/generation-task";
import type { ProductVideoReference } from "@/services/api/task-center";
import type { AiConfig } from "@/stores/use-config-store";
import { productVideoBeats } from "./product-video";
import { salesVideoStyle } from "./product-video-approaches";
import { parsePresenterVoice, parseVideoPlanningShots, presenterVoicePrompt, replacePlanningShots, videoPlanningPrompt, type PlanningTarget, type PresenterPlanningBrief } from "./product-video-planning";
import type { ProductVideoStory } from "./product-video-storyboard";
import { readPlanningReceipt, useVideoPlanningTask, type ScriptTarget } from "./use-product-video-planning-task";
import "./product-video-planning.css";

type Props = {
    scope: string;
    sessionId: string;
    projectId?: string;
    config: AiConfig;
    model: string;
    unavailable: string;
    draft: EcommerceDraft;
    facts: string;
    story: ProductVideoStory;
    closing?: string;
    salesVideo?: boolean;
    reference?: ProductVideoReference;
    presenter?: PresenterPlanningBrief;
    voice: string;
    shortcut: ScriptTarget | null;
    onShortcutHandled: (value: null) => void;
    onVoiceChange?: (voice: string) => void;
    onEditFacts?: () => void;
    initialTarget?: PlanningTarget;
    initialInstruction?: string;
    onChange: (story: ProductVideoStory) => void;
    disabled: boolean;
    ensureProject: () => Promise<string>;
    setSubmitting: (value: boolean) => void;
};
type Undo = { before: ProductVideoStory; after: ProductVideoStory; target: PlanningTarget };
export function ProductVideoPlanning(props: Props) {
    return <PlanningSession key={JSON.stringify([props.scope, props.sessionId])} {...props} />;
}

function PlanningSession({
    scope,
    projectId,
    config,
    model,
    unavailable,
    draft,
    facts,
    story,
    closing,
    salesVideo,
    reference,
    presenter,
    voice,
    shortcut,
    onShortcutHandled,
    onVoiceChange,
    onEditFacts,
    initialTarget,
    initialInstruction,
    onChange,
    disabled,
    ensureProject,
    setSubmitting,
}: Props) {
    const [receipt, setReceipt] = useState(() => readPlanningReceipt(scope, projectId, false));
    const [expanded, setExpanded] = useState(Boolean(receipt));
    const [selectedTarget, setTarget] = useState<ScriptTarget>(receipt?.target ?? initialTarget ?? "all");
    const salesVoice = salesVideo ? salesVideoStyle(story.approachId)?.voiceMode : undefined;
    const target = selectedTarget === "voice" && salesVoice === "silent" && !receipt ? "all" : selectedTarget;
    const [instruction, setInstruction] = useState(receipt?.instruction ?? initialInstruction ?? "");
    const [undo, setUndo] = useState<Undo | null>(null);
    const [voiceUndo, setVoiceUndo] = useState<{ before: string; after: string } | null>(null);
    const details = useRef<HTMLDetailsElement>(null);
    useEffect(() => {
        if (shortcut === null) return;
        if (!receipt) {
            setTarget(shortcut);
            setError("");
        } else if (receipt.target !== shortcut) setError("请先处理当前建议，再开始新的策划。");
        setExpanded(true);
        details.current?.querySelector("summary")?.focus();
        onShortcutHandled(null);
    }, [shortcut, onShortcutHandled, receipt]);
    const voiceTarget = target === "voice";
    const prompt = voiceTarget
        ? presenterVoicePrompt(draft, facts, story, instruction, presenter, closing, voice, salesVideo, undefined, reference)
        : videoPlanningPrompt(draft, facts, story, target, instruction, presenter, closing, salesVideo, undefined, reference);
    const missing =
        voiceTarget && !facts.trim() ? "先写下一条已核实的商品卖点，再起草台词。" : ![draft.productName, draft.description, draft.category, facts].some((value) => value.trim()) ? "请先在「商品卖点」写下或采纳商品特点，或在商品资料中填写名称。" : "";
    const assetTitle = target === "voice" ? "商品视频 · 口播台词" : target === "all" ? "商品视频 · 整条分镜策划" : `商品视频 · ${productVideoBeats[target].title}改稿`;
    const { price, issue, unknown, query, task, posting, checking, error, setError, request, checkUnknown, dismiss } = useVideoPlanningTask({
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
    });
    const stale = task?.status === "succeeded" && (task.prompt !== prompt || (task.projectId && task.projectId !== receipt?.projectId));
    let suggestion: string[] | undefined;
    let resultMessage = "";
    if (task?.status === "succeeded") {
        if (stale) resultMessage = "商品资料或分镜已修改。请保留当前草稿，放弃旧建议后再策划。";
        else {
            try {
                const text = parseBackendGenerationResult(task).text || "";
                suggestion = target === "voice" ? [parsePresenterVoice(text)] : parseVideoPlanningShots(text, target);
            } catch {
                resultMessage = voiceTarget ? "没有收到可用的口播台词，原稿已保留。" : "没有收到完整的分镜建议，原稿已保留。";
            }
        }
    } else if (task?.status === "failed" || task?.status === "cancelled") resultMessage = task.status === "cancelled" ? "本次策划已取消。" : "本次策划失败，原稿已保留。";
    const undoable = undo && story.approachId === undo.after.approachId && story.purpose === undo.after.purpose && story.shots.every((shot, i) => (undo.target !== "all" && undo.target !== i) || shot === undo.after.shots[i]);
    const voiceUndoable = voiceUndo && voice === voiceUndo.after;
    function accept() {
        if (!suggestion || disabled || stale) return;
        if (target === "voice") {
            if (!onVoiceChange) return;
            setVoiceUndo({ before: voice, after: suggestion[0] });
            onVoiceChange(suggestion[0]);
        } else {
            const after = replacePlanningShots(story, target, suggestion);
            setUndo({ before: story, after, target });
            onChange(after);
        }
        dismiss();
    }
    function revert() {
        if (!undoable || !undo || disabled) return;
        const next = undo.target === "all" ? { ...story, shots: undo.before.shots } : replacePlanningShots(story, undo.target, [undo.before.shots[undo.target]]);
        onChange({ ...next, edited: undo.before.edited || Boolean(story.boards) || next.shots.some((shot, i) => shot !== undo.before.shots[i]) });
        setUndo(null);
    }
    return (
        <details ref={details} className="ec-video-planning" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
            <summary>
                <Sparkles size={16} aria-hidden />
                <strong>{presenter ? "AI 分镜与台词" : "AI 分镜策划"}</strong>
                <ChevronDown size={15} aria-hidden />
            </summary>
            <div className="ec-video-planning-body">
                <label>
                    策划范围
                    <select
                        aria-label="策划范围"
                        value={target}
                        disabled={disabled || Boolean(receipt)}
                        onChange={(e) => {
                            setError("");
                            const value = e.target.value;
                            setTarget(value === "all" || value === "voice" ? value : (Number(value) as 0 | 1 | 2));
                        }}
                    >
                        <option value="all">整条分镜</option>
                        {(salesVoice !== "silent" || voiceTarget) && <option value="voice">{presenter || salesVoice === "host" ? "人物口播台词" : "商品旁白"}</option>}
                        {productVideoBeats.map((beat, i) => (
                            <option key={beat.title} value={i}>
                                只改{beat.title}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    改稿要求 <small>选填</small>
                    <Input.TextArea
                        value={instruction}
                        maxLength={400}
                        rows={2}
                        disabled={disabled || Boolean(receipt)}
                        onChange={(e) => setInstruction(e.target.value)}
                        placeholder={voiceTarget ? "例如用日常说话的语气，先回答买家最关心的问题" : "例如让开场先看到商品的使用场景"}
                    />
                </label>
                {!receipt && (
                    <div className="ec-video-planning-actions">
                        <Button size="small" disabled={disabled || Boolean(issue)} onClick={() => void request()}>
                            {price ? `${voiceTarget ? "确认起草台词" : "确认策划"} · ${price.estimated ? "约 " : ""}${price.amountMicrocredits / 1_000_000} 积分` : voiceTarget ? "查看台词报价" : "查看策划报价"}
                        </Button>
                        {voiceTarget && voiceUndoable && (
                            <Button
                                type="text"
                                size="small"
                                disabled={disabled}
                                onClick={() => {
                                    onVoiceChange?.(voiceUndo.before);
                                    setVoiceUndo(null);
                                }}
                            >
                                撤销采用台词
                            </Button>
                        )}
                        {!voiceTarget && undoable && (
                            <Button type="text" size="small" disabled={disabled} onClick={revert}>
                                撤销采纳
                            </Button>
                        )}
                    </div>
                )}
                {!receipt && issue && (
                    <div>
                        <small>{issue}</small>
                        {missing === issue && onEditFacts && (
                            <Button size="small" type="link" onClick={onEditFacts}>
                                填写商品卖点
                            </Button>
                        )}
                    </div>
                )}
                {receipt && !unknown && !query.isError && (!task || task.status === "queued" || task.status === "running") && <p role="status">{voiceTarget ? "AI 正在起草口播台词…" : "AI 正在策划分镜…"}</p>}
                {unknown &&
                    (posting ? (
                        <p role="status">正在提交策划任务…</p>
                    ) : (
                        <div>
                            <p role="status">尚未确认提交结果，请先核对任务。</p>
                            <Button size="small" loading={checking} onClick={() => void checkUnknown()}>
                                核对提交结果
                            </Button>
                        </div>
                    ))}
                {query.isError && (
                    <div>
                        <p role="alert">策划任务暂时无法读取。</p>
                        <Button size="small" onClick={() => void query.refetch()}>
                            重新读取
                        </Button>
                    </div>
                )}
                {resultMessage && <p role="status">{resultMessage}</p>}
                {suggestion && (
                    <div className="ec-video-planning-result" role="group" aria-label={voiceTarget ? "AI 台词建议" : "AI 分镜建议"}>
                        {suggestion.map((value, i) => (
                            <p key={i}>
                                <strong>{target === "voice" ? "台词草稿" : productVideoBeats[target === "all" ? i : target].title}</strong>
                                {value}
                            </p>
                        ))}
                    </div>
                )}
                {(suggestion || resultMessage || (unknown && !posting)) && (
                    <div className="ec-video-planning-actions">
                        {suggestion && (
                            <Button size="small" disabled={disabled} onClick={accept}>
                                {voiceTarget ? "采用这版台词" : "采纳建议"}
                            </Button>
                        )}
                        <Button type="text" size="small" disabled={disabled || checking} onClick={dismiss}>
                            {unknown ? "已核对，结束等待" : "放弃建议"}
                        </Button>
                    </div>
                )}
                {error && <p role="alert">{error}</p>}
            </div>
        </details>
    );
}
