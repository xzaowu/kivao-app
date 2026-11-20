import { Button } from "antd";
import { Columns2 } from "lucide-react";
import { useRef, useState } from "react";
import { AppModal } from "@/components/ui/product/app-modal";
import { workbenchTaskOutputs, type WorkbenchOutput } from "@/pages/workbench/workbench-batches";
import type { GenerationTask, ProductVideoVersion } from "@/services/api/task-center";
import { productVideoBeats } from "./product-video";
import { labelOf, languages } from "./catalog";
import { productVideoInputLabel, productVideoVersionForTask } from "./product-video-version";
import { shotDirection } from "./product-video-board";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { resourceStorageKey } from "@/services/api/resources";

type Edition = { id: string; title: string; version: ProductVideoVersion; output: WorkbenchOutput };

export function comparableProductVideos(tasks: GenerationTask[], projectId: string): Edition[] {
    const editions = tasks.flatMap((task, index) => {
        const version = productVideoVersionForTask(task, projectId);
        if (!version || task.status !== "succeeded") return [];
        const output = workbenchTaskOutputs(task, "video")[0];
        if (!output?.url || (output.mimeType && !output.mimeType.startsWith("video/")) || (!task.resultJson && task.previewKind === "image")) return [];
        const date = new Date(task.completedAt || task.createdAt || task.created_at || "");
        const when = Number.isFinite(+date) ? date.toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "";
        return [{ id: task.id, time: Number.isFinite(+date) ? +date : 0, title: [task.clientContext?.assetTitle || "商品视频", when || `第 ${index + 1} 条`].join(" · "), version, output }];
    });
    return editions.sort((a, b) => b.time - a.time);
}

export function ProductVideoComparison({ tasks, projectId }: { tasks: GenerationTask[]; projectId: string }) {
    const editions = comparableProductVideos(tasks, projectId);
    const [pair, setPair] = useState<[string, string] | null>(null);
    const left = editions.find((item) => item.id === pair?.[0]);
    const right = editions.find((item) => item.id === pair?.[1]);
    if (!pair && editions.length < 2) return null;
    return (
        <>
            <Button
                size="small"
                icon={<Columns2 size={15} aria-hidden />}
                disabled={editions.length < 2}
                onClick={() => {
                    const newest = editions[0];
                    const previous = editions.find((item) => item.id === newest.version.parentTaskId) || editions[1];
                    setPair([previous.id, newest.id]);
                }}
            >
                对比成片
            </Button>
            <AppModal title="对比成片" open={Boolean(pair)} onCancel={() => setPair(null)} width={900} footer={null} className="ec-video-compare-modal">
                {left && right ? <CompareVersions pair={[left, right]} options={editions} onSelect={(side, id) => setPair(side === 0 ? [id, right.id] : [left.id, id])} /> : pair ? <p role="status">所选作品已变化，请关闭后重新选择。</p> : null}
            </AppModal>
        </>
    );
}

function CompareVersions({ pair, options, onSelect }: { pair: [Edition, Edition]; options: Edition[]; onSelect: (side: 0 | 1, id: string) => void }) {
    const [side, setSide] = useState<0 | 1>(0);
    const [onlyChanged, setOnlyChanged] = useState(true);
    const players = useRef<(HTMLVideoElement | null)[]>([]);
    const targetTime = useRef(0);
    const [left, right] = pair.map((item) => item.version);
    const leftImages = left.productImages ?? [left.frame];
    const rightImages = right.productImages ?? [right.frame];
    type ChangeRow = { label: string; left: string; right: string; frames?: NonNullable<ProductVideoVersion["boards"]>[number]["frame"][] };
    const rows: ChangeRow[] = [
        { label: "商品图用途", left: productVideoInputLabel(left), right: productVideoInputLabel(right) },
        ...Array.from({ length: Math.max(leftImages.length, rightImages.length) }, (_, i) => ({
            label: `商品图 ${i + 1}`,
            left: leftImages[i]?.name || "",
            right: rightImages[i]?.name || "",
            frames: [leftImages[i], rightImages[i]],
        })),
        ...(left.boardInputs || right.boardInputs ? [{ label: "分镜参考图用途", left: left.boardInputs ? "参与生成" : "仅供预演", right: right.boardInputs ? "参与生成" : "仅供预演" }] : []),
        ...productVideoBeats.map((beat, index) => ({ label: beat.title, left: left.shots[index], right: right.shots[index] })),
        ...productVideoBeats.flatMap((beat, i) => {
            const a = left.boards?.[i],
                b = right.boards?.[i];
            if (!a && !b) return [];
            const changes: ChangeRow[] = [];
            if (a?.camera || a?.framing || b?.camera || b?.framing) changes.push({ label: `${beat.title}拍法`, left: shotDirection(a), right: shotDirection(b) });
            if (a?.frame || b?.frame) changes.push({ label: `${beat.title}参考图`, left: a?.frame?.name || "", right: b?.frame?.name || "", frames: [a?.frame, b?.frame] });
            return changes;
        }),
        ...(left.shootBrief || right.shootBrief || left.audience !== right.audience
            ? [
                  { label: "受众", left: left.audience, right: right.audience },
                  { label: "场景", left: left.shootBrief?.scene || "", right: right.shootBrief?.scene || "" },
                  { label: "收尾目标", left: left.shootBrief?.closing || "", right: right.shootBrief?.closing || "" },
              ]
            : []),
        { label: "口播文案", left: left.voice, right: right.voice },
        { label: "投放市场", left: left.region || "", right: right.region || "" },
        { label: "成片语言", left: labelOf(languages, left.language), right: labelOf(languages, right.language) },
        { label: "视频比例", left: left.settings.ratio === "auto" ? "由模型决定" : left.settings.ratio, right: right.settings.ratio === "auto" ? "由模型决定" : right.settings.ratio },
        { label: "商品卖点", left: left.facts, right: right.facts },
    ];
    function seek(video: HTMLVideoElement | null, seconds: number) {
        if (video && video.readyState >= 1 && Number.isFinite(video.duration)) video.currentTime = Math.min(seconds, video.duration);
    }
    function align(seconds: number) {
        targetTime.current = seconds;
        players.current.forEach((video) => {
            video?.pause();
            seek(video, seconds);
        });
    }
    const differences = rows.filter((row) => row.left !== row.right || row.frames?.[0]?.resourceId !== row.frames?.[1]?.resourceId);
    return (
        <div className="ec-video-compare">
            <div className="ec-video-compare-switch" role="group" aria-label="正在查看的成片">
                {(["A", "B"] as const).map((letter, i) => (
                    <Button
                        key={letter}
                        aria-pressed={side === i}
                        onClick={() => {
                            align(players.current[side]?.currentTime || 0);
                            setSide(i === 0 ? 0 : 1);
                        }}
                    >
                        版本 {letter}
                    </Button>
                ))}
            </div>
            <div className="ec-video-compare-players">
                {pair.map((edition, i) => (
                    <div key={i} className="ec-video-compare-edition" data-active={side === i}>
                        <label>
                            版本 {i === 0 ? "A" : "B"}
                            <select
                                value={edition.id}
                                onChange={(event) => {
                                    align(0);
                                    onSelect(i === 0 ? 0 : 1, event.target.value);
                                }}
                            >
                                {options.map((option) => (
                                    <option key={option.id} value={option.id} disabled={option.id === pair[1 - i].id}>
                                        {option.title}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <ComparisonPlayer
                            key={edition.id + edition.output.url}
                            edition={edition}
                            label={i === 0 ? "A" : "B"}
                            inputRef={(node) => {
                                players.current[i] = node;
                            }}
                            onReady={(video) => seek(video, targetTime.current)}
                            onPlay={() => players.current[1 - i]?.pause()}
                        />
                    </div>
                ))}
            </div>
            <div className="ec-video-compare-cues" role="group" aria-label="将两版定位到同一镜头">
                <span>同时定位</span>
                {productVideoBeats.map((beat, i) => (
                    <Button size="small" key={beat.title} onClick={() => align(productVideoBeats.slice(0, i).reduce((start, item) => start + item.durationSeconds, 0))}>
                        {beat.title}
                    </Button>
                ))}
            </div>
            <div className="ec-video-compare-diffs">
                <div className="ec-video-compare-diff-heading">
                    <h3>脚本对照</h3>
                    <label>
                        <input type="checkbox" checked={onlyChanged} onChange={(event) => setOnlyChanged(event.target.checked)} />
                        只看变化
                    </label>
                </div>
                {onlyChanged && !differences.length && <p role="status">两版的商品图、分镜、口播和卖点相同。</p>}
                {(onlyChanged ? differences : rows).map((row) => (
                    <section key={row.label} aria-label={row.label}>
                        <h4>{row.label}</h4>
                        <dl>
                            {[row.left, row.right].map((value, i) => {
                                const frame = row.frames?.[i];
                                return (
                                    <div key={i}>
                                        <dt>版本 {i === 0 ? "A" : "B"}</dt>
                                        <dd>
                                            {frame && <CachedResourceImage className="ec-video-work-board-image" variant="thumbnail" storageKey={resourceStorageKey(frame.resourceId)} alt="" loadingFallback={null} fallback={<small>预览不可用</small>} />}
                                            {value || (frame ? "已选参考图" : "未填写")}
                                        </dd>
                                    </div>
                                );
                            })}
                        </dl>
                    </section>
                ))}
            </div>
        </div>
    );
}

function ComparisonPlayer({ edition, label, inputRef, onReady, onPlay }: { edition: Edition; label: string; inputRef: (video: HTMLVideoElement | null) => void; onReady: (video: HTMLVideoElement) => void; onPlay: () => void }) {
    const [failed, setFailed] = useState(false);
    const ref = useRef<HTMLVideoElement>(null);
    return (
        <>
            <video
                ref={(node) => {
                    ref.current = node;
                    inputRef(node);
                }}
                controls
                playsInline
                preload="metadata"
                aria-label={`播放版本 ${label}`}
                src={edition.output.url}
                poster={edition.output.posterUrl}
                onPlay={onPlay}
                onLoadedMetadata={(event) => {
                    setFailed(false);
                    onReady(event.currentTarget);
                }}
                onError={() => setFailed(true)}
            />
            {failed && (
                <div role="status">
                    此版本暂时无法播放。{" "}
                    <Button
                        size="small"
                        onClick={() => {
                            setFailed(false);
                            ref.current?.load();
                        }}
                    >
                        重新加载版本 {label}
                    </Button>
                </div>
            )}
        </>
    );
}
