import { Button, Input } from "antd";
import { ChevronDown, CornerUpLeft, MessageSquarePlus } from "lucide-react";
import { useId, useRef, useState } from "react";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { formatVideoResolutionLabel } from "@/lib/video-generation-options";
import { workbenchTaskOutputs } from "@/pages/workbench/workbench-batches";
import { resourceStorageKey } from "@/services/api/resources";
import type { GenerationTask } from "@/services/api/task-center";
import { productVideoBeats, productVideoPresenterDeliveries, productVideoReferenceFocus } from "./product-video";
import { productVideoInputLabel, productVideoVersionForTask } from "./product-video-version";
import { ProductVideoDelivery } from "./product-video-delivery";
import { shotDirection } from "./product-video-board";
import { labelOf, languages } from "./catalog";
import "./product-video-works.css";

type ShotIndex = 0 | 1 | 2;
type Props = {
    task: GenerationTask;
    projectId: string;
    parentWork?: GenerationTask;
    onOpenSource?: (sourceTaskId: string) => void;
    disabled: boolean;
    onDerive: (task: GenerationTask, shotIndex: ShotIndex, note?: string, atSeconds?: number) => void;
};

const dateFormat = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export function ProductVideoWorkCard({ task, projectId, parentWork, onOpenSource, disabled, onDerive }: Props) {
    const version = productVideoVersionForTask(task, projectId);
    const output = workbenchTaskOutputs(task, "video")[0];
    const video = useRef<HTMLVideoElement>(null);
    const [media, setMedia] = useState<{ url: string; ready: boolean } | null>(null);
    const [showFrame, setShowFrame] = useState(false);
    const [marker, setMarker] = useState<{ seconds: number; shot: ShotIndex | null; note: string } | null>(null);
    const addNoteButton = useRef<HTMLButtonElement>(null);
    const titleId = useId();
    const noteId = useId();
    const sourceId = version?.parentTaskId;
    const sourceAvailable = parentWork && parentWork.id === sourceId && parentWork.projectId === projectId;
    const createdAt = new Date(task.createdAt || task.created_at || "");
    const ready = Boolean(media?.ready && output?.url === media.url);
    const failed = task.status === "failed" || task.status === "cancelled";

    function startNote() {
        if (!video.current || !version || !ready) return;
        const position = video.current.currentTime;
        if (!Number.isFinite(position) || position < 0) return;
        video.current.pause();
        const seconds = Math.floor(position * 10) / 10;
        const [opening, detail] = productVideoBeats;
        const shot = seconds < opening.durationSeconds ? 0 : seconds < opening.durationSeconds + detail.durationSeconds ? 1 : seconds <= version.settings.seconds ? 2 : null;
        setMarker({ seconds, shot, note: "" });
    }

    return (
        <article className="ec-video-work" aria-labelledby={titleId} id={`ec-video-work-${task.id}`} tabIndex={-1}>
            <header className="ec-video-work-heading">
                <h3 id={titleId}>{task.clientContext?.assetTitle || "商品带货短片"}</h3>
                {Number.isFinite(createdAt.getTime()) && <time dateTime={createdAt.toISOString()}>{dateFormat.format(createdAt)}</time>}
                {sourceId &&
                    (sourceAvailable ? (
                        <a href={`#ec-video-work-${encodeURIComponent(sourceId)}`}>查看来源作品</a>
                    ) : onOpenSource ? (
                        <Button type="link" size="small" disabled={disabled} onClick={() => onOpenSource(sourceId)}>
                            查看来源作品
                        </Button>
                    ) : (
                        <small>从已有作品改版</small>
                    ))}
            </header>
            {output?.url ? (
                <div className="ec-video-work-player">
                    <video
                        ref={video}
                        controls
                        playsInline
                        preload="metadata"
                        aria-label="商品视频成片"
                        src={output.url}
                        poster={output.posterUrl}
                        onLoadedMetadata={() => setMedia({ url: output.url, ready: true })}
                        onError={() => setMedia({ url: output.url, ready: false })}
                    />
                    {media?.url === output.url && !media.ready && (
                        <div className="ec-video-work-actions">
                            <span role="status">视频暂时无法播放</span>
                            <Button
                                size="small"
                                onClick={() => {
                                    setMedia(null);
                                    video.current?.load();
                                }}
                            >
                                重新加载视频
                            </Button>
                        </div>
                    )}
                    {output.resourceId && task.projectId === projectId && task.previewKind !== "image" && (!output.mimeType || output.mimeType.startsWith("video/")) && (
                        <ProductVideoDelivery key={output.resourceId} output={{ ...output, resourceId: output.resourceId }} title={task.clientContext?.assetTitle || "商品视频"} />
                    )}
                </div>
            ) : (
                <p role="status">
                    {{ queued: "等待生成", running: "正在生成", failed: "生成失败", cancelled: "已取消", succeeded: "已完成，预览暂不可用" }[task.status]}
                    {task.status === "failed" && task.error ? ` · ${task.error}` : ""}
                </p>
            )}
            {version && (
                <>
                    <details className="ec-video-work-script" onToggle={(event) => setShowFrame(event.currentTarget.open)}>
                        <summary>
                            <ChevronDown size={15} aria-hidden />
                            查看原始脚本
                        </summary>
                        <div className="ec-video-work-frame">
                            {showFrame && !version.productImages && <CachedResourceImage variant="thumbnail" storageKey={resourceStorageKey(version.frame.resourceId)} alt="" loadingFallback={null} fallback={<small>商品图预览暂不可用</small>} />}
                            <div>
                                <small>{productVideoInputLabel(version)}</small>
                                {version.productImages ? (
                                    <ol className="ec-video-work-products" aria-label="提交时的商品参考图">
                                        {version.productImages.map((image, i) => (
                                            <li key={image.resourceId}>
                                                {showFrame && <CachedResourceImage variant="thumbnail" storageKey={resourceStorageKey(image.resourceId)} alt="" loadingFallback={null} fallback={<small>预览不可用</small>} />}
                                                <span>{`${i + 1}. ${image.name || "商品图"}`}</span>
                                            </li>
                                        ))}
                                    </ol>
                                ) : (
                                    <strong>{version.frame.name || (version.presenter ? "人货同框图" : version.boardInputs || version.referenceVideo ? "商品参考图" : "商品首帧")}</strong>
                                )}
                                <small>
                                    提交规格 ·{" "}
                                    {[
                                        `${version.settings.seconds} 秒`,
                                        version.settings.ratio,
                                        formatVideoResolutionLabel(version.settings.resolution),
                                        version.settings.generateAudio ? "生成声音" : "不生成声音",
                                        version.region,
                                        labelOf(languages, version.language),
                                    ]
                                        .filter((item) => item && item !== "auto")
                                        .join(" · ")}
                                </small>
                            </div>
                        </div>
                        {version.referenceVideo && (
                            <div className="ec-video-work-voice">
                                <strong>参考视频 · {version.referenceVideo.name}</strong>
                                <p>
                                    {Number((version.referenceVideo.durationMs / 1000).toFixed(3))} 秒 · 借鉴{productVideoReferenceFocus(version.referenceVideo)}
                                </p>
                                {version.referenceVideo.instruction && <p>{version.referenceVideo.instruction}</p>}
                            </div>
                        )}
                        {(version.audience || version.shootBrief?.scene || version.shootBrief?.closing) && (
                            <div className="ec-video-work-voice">
                                <strong>拍摄简报</strong>
                                {version.audience && <p>受众 · {version.audience}</p>}
                                {version.shootBrief?.scene && <p>场景 · {version.shootBrief.scene}</p>}
                                {version.shootBrief?.closing && <p>收尾目标 · {version.shootBrief.closing}</p>}
                            </div>
                        )}
                        <ol className="ec-video-work-shots">
                            {version.shots.map((shot, i) => {
                                const board = version.boards?.[i];
                                const direction = shotDirection(board);
                                return (
                                    <li key={productVideoBeats[i].title}>
                                        <span>
                                            <strong>{productVideoBeats[i].title}</strong>
                                            <small>{productVideoBeats[i].time}</small>
                                        </span>
                                        <div>
                                            {showFrame && board?.frame && (
                                                <CachedResourceImage
                                                    className="ec-video-work-board-image"
                                                    variant="thumbnail"
                                                    storageKey={resourceStorageKey(board.frame.resourceId)}
                                                    alt={board.frame.name || "分镜参考图"}
                                                    loadingFallback={null}
                                                    fallback={<small>分镜图当前不可用</small>}
                                                />
                                            )}
                                            {direction && <small>{direction}</small>}
                                            <p>{shot}</p>
                                        </div>
                                    </li>
                                );
                            })}
                        </ol>
                        {version.voice && (
                            <div className="ec-video-work-voice">
                                <strong>{version.presenter ? `人物口播 · ${productVideoPresenterDeliveries[version.presenter.delivery]}` : "口播文案"}</strong>
                                <p>{version.voice}</p>
                            </div>
                        )}
                    </details>
                    <div className="ec-video-work-actions">
                        <Button disabled={disabled} icon={<CornerUpLeft size={15} aria-hidden />} onClick={() => onDerive(task, 0)}>
                            {failed ? "从原稿继续编辑" : "沿用脚本，换个开场"}
                        </Button>
                        {output?.url && !marker && (
                            <Button ref={addNoteButton} disabled={disabled || !ready} icon={<MessageSquarePlus size={15} aria-hidden />} onClick={startNote}>
                                在此处留意见
                            </Button>
                        )}
                    </div>
                    {marker && (
                        <form
                            className="ec-video-work-note"
                            onSubmit={(event) => {
                                event.preventDefault();
                                if (!disabled && marker.shot !== null && marker.note.trim()) onDerive(task, marker.shot, marker.note.trim(), marker.seconds);
                            }}
                        >
                            <div className="ec-video-work-note-heading">
                                <label htmlFor={noteId}>修改意见</label>
                                <span>
                                    第 {marker.seconds} 秒{marker.shot !== null && ` · ${productVideoBeats[marker.shot].title}`}
                                </span>
                            </div>
                            {marker.seconds > version.settings.seconds && (
                                <label>
                                    此处超过脚本时长，请选择要改的镜头
                                    <select value={marker.shot ?? ""} onChange={(event) => setMarker({ ...marker, shot: Number(event.target.value) as ShotIndex })}>
                                        <option value="" disabled>
                                            选择镜头
                                        </option>
                                        {productVideoBeats.map((beat, i) => (
                                            <option key={beat.title} value={i}>
                                                {beat.title}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            )}
                            <Input.TextArea id={noteId} autoFocus value={marker.note} maxLength={400} rows={2} placeholder="例如让刷头的近景多停留一秒" onChange={(event) => setMarker({ ...marker, note: event.target.value })} />
                            <div className="ec-video-work-actions">
                                <Button htmlType="submit" disabled={disabled || marker.shot === null || !marker.note.trim()}>
                                    带着意见改稿
                                </Button>
                                <Button
                                    htmlType="button"
                                    type="text"
                                    onClick={() => {
                                        setMarker(null);
                                        requestAnimationFrame(() => addNoteButton.current?.focus());
                                    }}
                                >
                                    取消
                                </Button>
                            </div>
                        </form>
                    )}
                </>
            )}
        </article>
    );
}
