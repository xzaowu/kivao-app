import { Button, Input } from "antd";
import { ChevronDown, CornerDownLeft, Sparkles } from "lucide-react";
import { useId, useState } from "react";
import type { EcommerceDraft } from "@/services/api/ecommerce";
import { parseBackendGenerationResult } from "@/services/api/generation-task";
import type { ProductVideoShootBrief } from "@/services/api/task-center";
import { briefSuggestionPrompt, fillBriefGaps, parseShootBriefSuggestion, quickShootBrief, shootBriefFields, shootBriefLabels, type ShootBriefValues, type ShootBriefField } from "./product-video-brief-suggestions";
import { readPlanningReceipt, useVideoPlanningTask, type VideoPlanningTaskProps } from "./use-product-video-planning-task";
import "./product-video-shoot-brief.css";

type Props = VideoPlanningTaskProps & {
    sessionId: string;
    draft: EcommerceDraft;
    facts: string;
    audience: string;
    brief: ProductVideoShootBrief;
    onAudience: (value: string) => void;
    onChange: (brief: ProductVideoShootBrief) => void;
};
const placeholders: ShootBriefValues = { audience: "例如每天搭地铁的通勤族", scene: "例如早高峰的地铁车厢", closing: "例如对照尺寸，选适合自己的款式" };

export function ProductVideoShootBriefEditor(props: Props) {
    return <BriefSession key={JSON.stringify([props.scope, props.sessionId])} {...props} />;
}

function BriefSession({ audience, brief, onAudience, onChange, draft, facts, ...taskProps }: Props) {
    const { scope, projectId, disabled } = taskProps;
    const uid = useId();
    const [receipt, setReceipt] = useState(() => readPlanningReceipt(scope, projectId, true));
    const [expanded, setExpanded] = useState(Boolean(receipt));
    const [notice, setNotice] = useState("");
    const current: ShootBriefValues = { audience, scene: brief.scene || "", closing: brief.closing || "" };
    const instruction = receipt?.instruction ?? JSON.stringify(current);
    const prompt = briefSuggestionPrompt(draft, facts, instruction);
    const missing = [draft.productName, draft.category, draft.description, facts].some((v) => v.trim()) ? "" : "先填商品名称，或从「AI 分析卖点」采纳一条商品特点，再请 AI 起草。";
    const { price, issue, unknown, query, task, posting, checking, canReleaseUnknown, error, request, checkUnknown, dismiss } = useVideoPlanningTask({
        ...taskProps,
        prompt,
        assetTitle: "商品视频 · 拍摄简报",
        target: "brief",
        instruction,
        missing,
        receipt,
        setReceipt,
    });
    let ai: ShootBriefValues | undefined;
    let resultMessage = "";
    if (task?.status === "succeeded") {
        if (task.type !== "canvas_text" || task.projectId !== receipt?.projectId || task.prompt !== prompt) resultMessage = "商品资料已变化，请结束本次建议后重新起草。";
        else {
            try {
                ai = parseShootBriefSuggestion(parseBackendGenerationResult(task).text || "");
            } catch {
                resultMessage = "AI 未返回完整的三项建议，可保留现有填写，或重新起草。";
            }
        }
    } else if (task?.status === "failed" || task?.status === "cancelled") resultMessage = task.status === "cancelled" ? "本次简报已取消。" : "本次简报生成失败，可保留现有填写后重试。";
    const suggestion = ai || quickShootBrief(draft);
    const gaps = shootBriefFields.filter((field) => !current[field].trim());
    function edit(field: ShootBriefField, value: string) {
        if (field === "audience") onAudience(value);
        else onChange({ ...brief, [field]: value });
        setNotice("");
    }
    function fill() {
        const next = fillBriefGaps(current, suggestion);
        if (next.audience !== audience) onAudience(next.audience);
        if (next.scene !== current.scene || next.closing !== current.closing) onChange({ scene: next.scene, closing: next.closing });
        setNotice(`已填入${gaps.map((key) => shootBriefLabels[key]).join("、")}。`);
    }
    return (
        <details className="ec-shoot-brief" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
            <summary>
                <ChevronDown size={15} aria-hidden />
                <strong>拍摄简报</strong>
                <small>{[audience, brief.scene, brief.closing].find((item) => item?.trim()) || "选填"}</small>
                <span className="ec-shoot-brief-assist">
                    <Sparkles size={13} aria-hidden />
                    {ai ? "AI 建议已就绪" : unknown ? "待核对任务" : receipt && !resultMessage && !query.isError ? "AI 起草中" : issue ? "填写建议" : "建议 / AI 起草"}
                </span>
            </summary>
            <div className="ec-shoot-brief-fields">
                <div className="ec-shoot-brief-tools">
                    {gaps.length > 0 && (
                        <Button size="small" htmlType="button" disabled={disabled} onClick={fill}>
                            {ai ? "用 AI 建议填入空白项" : "一键填入空白项"}
                        </Button>
                    )}
                    {!receipt && (
                        <Button
                            size="small"
                            htmlType="button"
                            icon={<Sparkles aria-hidden size={14} />}
                            disabled={disabled || Boolean(issue)}
                            onClick={() => {
                                setNotice("");
                                void request();
                            }}
                        >
                            {price ? `确认起草 · ${price.estimated ? "约 " : ""}${price.amountMicrocredits / 1_000_000} 积分` : "AI 起草简报 · 查看报价"}
                        </Button>
                    )}
                    {ai && (
                        <Button
                            htmlType="button"
                            size="small"
                            type="text"
                            disabled={disabled}
                            onClick={() => {
                                dismiss();
                                setNotice("");
                            }}
                        >
                            结束 AI 建议
                        </Button>
                    )}
                </div>
                {!receipt && issue && <small className="ec-shoot-brief-hint">{issue}</small>}
                {receipt && !unknown && !query.isError && (!task || task.status === "queued" || task.status === "running") && <p role="status">AI 正在起草受众、拍摄场景和收尾目标…</p>}
                {unknown &&
                    (posting ? (
                        <p role="status">正在提交简报任务…</p>
                    ) : (
                        <div>
                            <p role="status">尚未确认提交结果，请先核对任务。</p>
                            <Button htmlType="button" size="small" loading={checking} onClick={() => void checkUnknown()}>
                                核对简报任务
                            </Button>
                        </div>
                    ))}
                {query.isError && (
                    <div>
                        <p role="alert">简报任务暂时无法读取。</p>
                        <Button size="small" htmlType="button" onClick={() => void query.refetch()}>
                            重新读取简报
                        </Button>
                    </div>
                )}
                {canReleaseUnknown && (
                    <Button htmlType="button" size="small" disabled={checking} onClick={dismiss}>
                        已在任务中心核对，结束等待
                    </Button>
                )}
                {resultMessage && (
                    <div>
                        <p role="status">{resultMessage}</p>
                        <Button size="small" htmlType="button" onClick={dismiss}>
                            结束本次建议
                        </Button>
                    </div>
                )}
                {error && <p role="alert">{error}</p>}
                {shootBriefFields.map((field) => {
                    const fieldId = `${uid}-${field}`;
                    const selected = current[field].trim() === suggestion[field];
                    return (
                        <div key={field} className="ec-shoot-brief-field">
                            <label htmlFor={fieldId}>{shootBriefLabels[field]}</label>
                            <Input id={fieldId} name={field} value={current[field]} disabled={disabled} maxLength={field === "audience" ? 4000 : 240} onChange={(event) => edit(field, event.target.value)} placeholder={placeholders[field]} />
                            {!selected && (
                                <button
                                    type="button"
                                    className="ec-shoot-brief-suggestion"
                                    disabled={disabled}
                                    aria-label={`${current[field].trim() ? "替换" : "填入"}「${shootBriefLabels[field]}」为${ai ? " AI " : ""}建议：${suggestion[field]}`}
                                    onClick={() => {
                                        edit(field, suggestion[field]);
                                        setNotice(`已采用「${shootBriefLabels[field]}」的建议，可继续编辑。`);
                                    }}
                                >
                                    <CornerDownLeft size={13} aria-hidden />
                                    <span>
                                        <strong>{ai ? "AI 建议" : current[field].trim() ? "改用建议" : "建议"}</strong>
                                        {suggestion[field]}
                                    </span>
                                </button>
                            )}
                        </div>
                    );
                })}
                <span role="status" className="ec-shoot-brief-hint">
                    {notice}
                </span>
            </div>
        </details>
    );
}
