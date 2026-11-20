import { Button, Input } from "antd";
import { Play, Scissors } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { assertCurrentUserSession, captureUserSession } from "@/lib/user-scope";
import type { ProductVideoReference } from "@/services/api/task-center";
import { defaultReferenceAspects, productVideoBeats } from "./product-video";
import { readReferenceClips, ReferenceReadError, referenceTime, type ReferenceBreakdown } from "./product-video-reference-sampling";

type Props = {
    scope: string;
    reference: ProductVideoReference;
    disabled?: boolean;
    shots?: string[];
    onApply: (index: number, note: string) => void;
    onPlayClip: (startMs: number, endMs: number) => void;
};

export function ProductVideoReferenceBreakdown({ scope, reference, disabled, shots, onApply, onPlayClip }: Props) {
    const id = useId();
    const active = useRef<AbortController | null>(null);
    const [result, setResult] = useState<ReferenceBreakdown | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [progress, setProgress] = useState<number | null>(null);
    const [error, setError] = useState("");
    const [selected, setSelected] = useState(0);
    const [target, setTarget] = useState(0);
    const [notes, setNotes] = useState<Record<number, string>>({});
    useEffect(() => () => active.current?.abort(), []);

    async function analyze() {
        if (disabled || active.current) return;
        const controller = new AbortController();
        active.current = controller;
        setExpanded(true);
        setProgress(0);
        setError("");
        try {
            const session = captureUserSession();
            if (session.scope !== scope || session.scope === "guest") throw new Error();
            const signal = AbortSignal.any([controller.signal, session.signal, AbortSignal.timeout(60_000)]);
            const breakdown = await readReferenceClips(reference.resourceId, reference.durationMs, signal, (n) => {
                if (!signal.aborted) setProgress(n);
            });
            signal.throwIfAborted();
            assertCurrentUserSession(session);
            setResult(breakdown);
        } catch (cause) {
            if (!controller.signal.aborted) {
                setError(cause instanceof ReferenceReadError ? cause.message : "暂时读不到这段参考片。可以重新拆片，或观看原片后手写分镜。");
            }
        } finally {
            if (active.current === controller) {
                active.current = null;
                if (!controller.signal.aborted) setProgress(null);
            }
        }
    }

    const clip = result?.clips[selected];
    const aspects = reference.aspects ?? defaultReferenceAspects;
    const detail = notes[selected] ?? `沿用这段的${aspects.map((key) => ({ rhythm: "镜头节奏", camera: "运镜方式", framing: "主体构图" })[key]).join("、")}来展示本商品。`;
    const note = clip && detail.trim() ? `参考《${reference.name || "参考片"}》${referenceTime(clip.startMs)}–${referenceTime(clip.endMs)}：${detail.trim()}`.replace(/\s*\n\s*/g, " ") : "";
    const applied = Boolean(note && shots?.[target]?.split("\n").includes(note));
    const tooLong = Array.from([shots?.[target], note].filter(Boolean).join("\n")).length > 16000;

    return (
        <section className="ec-reference-breakdown" aria-label="参考片拆解">
            <Button
                size="small"
                icon={<Scissors size={15} aria-hidden />}
                disabled={disabled && progress === null}
                aria-expanded={expanded}
                aria-controls={id}
                onClick={() => {
                    if (progress !== null) {
                        active.current?.abort();
                        active.current = null;
                        setProgress(null);
                        setExpanded(false);
                    } else if (result) setExpanded(!expanded);
                    else void analyze();
                }}
            >
                {progress !== null ? "取消读取" : result ? (expanded ? "收起参考片段" : "查看参考片段") : error ? "重新拆解参考片" : "拆解参考片"}
            </Button>
            <div id={id} hidden={!expanded}>
                {progress !== null && (
                    <label className="ec-reference-progress">
                        正在读取参考片画面 <progress value={progress} max={100} />
                    </label>
                )}
                {error && <p role="alert">{error}</p>}
                {result && clip && (
                    <>
                        <p>{result.byChange ? "按采样画面的明显变化估算分段，时间点为近似值。" : "采样未找到明显变化，按时间顺序展示画面。"}选择要借鉴的一段。</p>
                        <div className="ec-reference-clips" role="group" aria-label="参考片段">
                            {result.clips.map((item, i) => (
                                <button
                                    type="button"
                                    key={item.startMs}
                                    disabled={disabled}
                                    aria-pressed={i === selected}
                                    aria-label={`第 ${i + 1} 段，${referenceTime(item.startMs)} 至 ${referenceTime(item.endMs)}`}
                                    onClick={() => {
                                        setSelected(i);
                                        const fraction = item.sample.timeMs / reference.durationMs;
                                        setTarget(fraction < 3 / 15 ? 0 : fraction < 9 / 15 ? 1 : 2);
                                    }}
                                >
                                    <img src={item.sample.thumbnail} alt="" />
                                    <span>
                                        {referenceTime(item.startMs)}–{referenceTime(item.endMs)}
                                    </span>
                                </button>
                            ))}
                        </div>
                        <Button size="small" type="text" disabled={disabled} className="ec-reference-play-clip" icon={<Play size={14} aria-hidden />} onClick={() => onPlayClip(clip.startMs, clip.endMs)}>
                            播放所选片段
                        </Button>
                        <label htmlFor={id + "-note"}>这段想借鉴什么</label>
                        <Input.TextArea id={id + "-note"} value={detail} onChange={(event) => setNotes({ ...notes, [selected]: event.target.value })} disabled={disabled} maxLength={300} autoSize={{ minRows: 2, maxRows: 4 }} />
                        <label htmlFor={id + "-target"}>加入 15 秒成片</label>
                        <div className="ec-reference-apply">
                            <select id={id + "-target"} value={target} disabled={disabled} onChange={(event) => setTarget(Number(event.target.value))}>
                                {productVideoBeats.map((beat, i) => (
                                    <option key={beat.title} value={i}>
                                        {beat.title} · {beat.time}
                                    </option>
                                ))}
                            </select>
                            <Button size="small" disabled={disabled || !note || applied || tooLong} onClick={() => onApply(target, note)}>
                                {applied ? `已加入${productVideoBeats[target].title}` : `追加到${productVideoBeats[target].title}`}
                            </Button>
                        </div>
                        {tooLong && !applied && <p role="status">这一镜的文字已达上限，请先精简分镜。</p>}
                    </>
                )}
            </div>
        </section>
    );
}
