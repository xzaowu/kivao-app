import { Button, Input } from "antd";
import { Film, FolderOpen, Trash2, Upload } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { VideoPlayer } from "@/components/video-player";
import { probeMediaDurationMs } from "@/lib/media-metadata";
import { assertCurrentUserSession, captureUserSession } from "@/lib/user-scope";
import { WorkbenchAssetPicker } from "@/pages/workbench/workbench-asset-picker";
import { getResource, playbackVariantUrl, uploadResourceFile } from "@/services/api/resources";
import type { ProductVideoReference } from "@/services/api/task-center";
import { defaultReferenceAspects, productVideoReferenceAspects } from "./product-video";
import { isProductVideoReference } from "./product-video-version";
import { ProductVideoReferenceBreakdown } from "./product-video-reference-breakdown";
import { referenceTime } from "./product-video-reference-sampling";
import { applyVideoRemixPreset, matchVideoRemixPreset, setVideoRemixAspects, videoRemixPresets, type VideoRemixPreset } from "./product-video-remix-presets";
import "./product-video-reference-panel.css";
import "./product-video-remix-layout.css";

const videoOnly = ["video"] as const;

type Props = {
    scope: string;
    value?: ProductVideoReference;
    preset?: VideoRemixPreset;
    onPresetChange: (preset: VideoRemixPreset) => void;
    onChange: (next?: ProductVideoReference) => void;
    shots?: string[];
    onApplyShot: (index: number, note: string) => void;
    disabled?: boolean;
    onBusyChange?: (busy: boolean) => void;
};

export function ProductVideoReferencePanel({ scope, value, preset, onPresetChange, onChange, shots, onApplyShot, disabled, onBusyChange }: Props) {
    const input = useRef<HTMLInputElement>(null);
    const lifetime = useRef<AbortController | null>(null);
    const selecting = useRef(false);
    const busyListener = useRef(onBusyChange);
    const inputId = useId();
    const [picker, setPicker] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [segment, setSegment] = useState<{ resourceId: string; startMs: number; endMs: number; play: number } | null>(null);
    const preview = segment && value?.resourceId === segment.resourceId ? segment : null;
    const player = useRef<HTMLDivElement>(null);
    const locked = Boolean(disabled || busy);
    const aspects = value?.aspects ?? defaultReferenceAspects;
    const selectedPreset = value ? matchVideoRemixPreset(value) : (preset ?? "close");

    useEffect(() => {
        busyListener.current = onBusyChange;
    }, [onBusyChange]);
    useEffect(() => {
        const controller = new AbortController();
        lifetime.current = controller;
        return () => {
            controller.abort();
            if (selecting.current) busyListener.current?.(false);
            selecting.current = false;
        };
    }, [scope]);

    async function select(source: File | { resourceId: string; name: string }) {
        const local = lifetime.current?.signal;
        if (!local || local.aborted || selecting.current || disabled) return;
        let sessionSignal: AbortSignal | undefined;
        try {
            const session = captureUserSession();
            if (session.scope !== scope || session.scope === "guest") return;
            sessionSignal = session.signal;
            const signal = AbortSignal.any([local, session.signal]);
            selecting.current = true;
            setBusy(true);
            busyListener.current?.(true);
            setError("");
            let resource;
            if (source instanceof File) {
                const durationMs = await probeMediaDurationMs(source);
                signal.throwIfAborted();
                if (!durationMs) {
                    setError("无法读取视频时长，请选择浏览器可播放的视频文件。");
                    return;
                }
                if (durationMs > 3_600_000) {
                    setError("参考视频最长为 60 分钟，请先截取需要的片段。");
                    return;
                }
                resource = await uploadResourceFile(source, "video", { fileName: source.name, durationMs, expectedUserId: scope, signal });
            } else {
                resource = await getResource(source.resourceId);
            }
            signal.throwIfAborted();
            assertCurrentUserSession(session);
            if (!resource.id || resource.userId !== scope || resource.kind !== "video" || resource.status !== "ready") {
                setError("该视频尚未就绪或无法访问，请选择其他视频。");
                return;
            }
            const durationMs = resource.durationMs;
            if (!durationMs || !Number.isSafeInteger(durationMs) || durationMs <= 0) {
                setError("素材缺少有效时长，请从设备重新上传原视频。");
                return;
            }
            const next = { resourceId: resource.id, name: source.name, durationMs, aspects, instruction: value?.instruction };
            if (!isProductVideoReference(next)) {
                setError(durationMs > 3_600_000 ? "参考视频最长为 60 分钟，请先截取需要的片段。" : "参考视频信息不完整，请重新选择。");
                return;
            }
            onChange(!value ? applyVideoRemixPreset(next, preset ?? "close") : next);
            setSegment(null);
        } catch {
            if (!local.aborted && !sessionSignal?.aborted) setError(source instanceof File ? "参考视频上传失败，请重试。" : "无法读取参考视频，请重新选择。");
        } finally {
            if (!local.aborted && selecting.current) {
                selecting.current = false;
                setBusy(false);
                busyListener.current?.(false);
            }
        }
    }

    return (
        <>
            <section className="ec-video-reference" aria-label="参考视频">
                <div className="ec-video-reference-heading">
                    <h2>参考视频</h2>
                    {value && <small>{(value.durationMs / 1000).toLocaleString("zh-CN", { maximumFractionDigits: 3 })} 秒</small>}
                </div>
                {value ? (
                    <div ref={player} className="ec-video-reference-preview">
                        <VideoPlayer
                            key={value.resourceId + ":" + (preview?.play ?? "full")}
                            title={value.name}
                            className="ec-video-reference-player"
                            src={playbackVariantUrl(value.resourceId) + (preview ? `#t=${preview.startMs / 1000},${preview.endMs / 1000}` : "")}
                            autoPlay={Boolean(preview)}
                            compactControls
                        />
                        <p className="ec-video-reference-filename" title={value.name}>
                            {value.name}
                        </p>
                        {preview && (
                            <div className="ec-reference-playback-range">
                                <small>
                                    参考片 {referenceTime(preview.startMs)}–{referenceTime(preview.endMs)}
                                </small>
                                <Button size="small" type="text" onClick={() => setSegment(null)}>
                                    返回整片
                                </Button>
                            </div>
                        )}
                    </div>
                ) : (
                    <button type="button" className="ec-remix-video-upload" aria-label="上传参考视频" disabled={locked} onClick={() => input.current?.click()}>
                        <Film size={27} aria-hidden />
                        <span>
                            <strong>上传参考视频</strong>
                            <small>选择想借鉴拍法的原片</small>
                        </span>
                    </button>
                )}
                <div className="ec-video-reference-actions">
                    {value && (
                        <Button disabled={locked} size="small" icon={<Upload size={14} aria-hidden />} onClick={() => input.current?.click()}>
                            更换视频
                        </Button>
                    )}
                    <Button disabled={locked} size="small" aria-label="从素材库选择参考视频" aria-haspopup="dialog" icon={<FolderOpen size={14} aria-hidden />} onClick={() => setPicker(true)}>
                        从素材库选择
                    </Button>
                    {value && (
                        <Button
                            type="text"
                            size="small"
                            disabled={locked}
                            icon={<Trash2 size={14} aria-hidden />}
                            aria-label="移除参考视频"
                            onClick={() => {
                                setError("");
                                setSegment(null);
                                onChange(undefined);
                            }}
                        >
                            移除
                        </Button>
                    )}
                    <input
                        ref={input}
                        hidden
                        type="file"
                        accept="video/*"
                        aria-label="选择参考视频文件"
                        disabled={locked}
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            if (file) void select(file);
                        }}
                    />
                </div>
                {busy && <p role="status">正在读取参考视频…</p>}
                {error && <p role="alert">{error}</p>}
                <WorkbenchAssetPicker
                    open={picker}
                    syncedOnly
                    accept={videoOnly}
                    maxCount={1}
                    slotName="参考视频"
                    onClose={() => setPicker(false)}
                    onPick={async ([asset]) => {
                        if (asset) await select(asset);
                    }}
                />
            </section>
            <section className="ec-remix-method">
                <fieldset className="ec-remix-presets" disabled={locked}>
                    <legend>复刻方式</legend>
                    <div>
                        {(["close", "adapt"] as const).map((id) => {
                            const option = videoRemixPresets[id];
                            return (
                                <label key={id}>
                                    <input type="radio" name={inputId + "-preset"} aria-label={option.title} aria-describedby={inputId + "-" + id} checked={selectedPreset === id} onChange={() => onPresetChange(id)} />
                                    <span>
                                        <strong>{option.title}</strong>
                                        <small id={inputId + "-" + id}>{id === "close" ? "沿用镜头节奏、运镜和构图，用你的商品重拍。" : "借鉴原片节奏，重新安排场景、动作和机位。"}</small>
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                </fieldset>
                {value && (
                    <details className="ec-remix-disclosure ec-remix-reference-detail">
                        <summary>借鉴细节与片段</summary>
                        <fieldset className="ec-video-reference-aspects" disabled={locked}>
                            <legend>
                                借鉴哪些拍法 <small>至少选一项</small>
                            </legend>
                            {productVideoReferenceAspects.map(({ key, title }) => (
                                <label key={key}>
                                    <input
                                        type="checkbox"
                                        checked={aspects.includes(key)}
                                        disabled={aspects.length === 1 && aspects.includes(key)}
                                        onChange={(event) => onChange(setVideoRemixAspects(value, event.target.checked ? [...aspects, key] : aspects.filter((item) => item !== key)))}
                                    />
                                    {title}
                                </label>
                            ))}
                        </fieldset>
                        <ProductVideoReferenceBreakdown
                            key={JSON.stringify([scope, value.resourceId, value.durationMs])}
                            scope={scope}
                            reference={value}
                            disabled={locked}
                            shots={shots}
                            onApply={onApplyShot}
                            onPlayClip={(startMs, endMs) => {
                                setSegment((previous) => ({ resourceId: value.resourceId, startMs, endMs, play: (previous?.play ?? 0) + 1 }));
                                player.current?.scrollIntoView({ block: "nearest" });
                            }}
                        />
                        <label className="ec-video-reference-instruction" htmlFor={inputId}>
                            补充要求（选填）
                        </label>
                        <Input.TextArea
                            id={inputId}
                            disabled={locked}
                            autoSize={{ minRows: 2, maxRows: 4 }}
                            maxLength={240}
                            placeholder="例如，保留开头的快速推进，结尾停在商品特写。"
                            value={value.instruction || ""}
                            onChange={(event) => onChange({ ...value, instruction: event.target.value })}
                        />
                    </details>
                )}
            </section>
        </>
    );
}
