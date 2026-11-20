import { Clapperboard, Pause, Play } from "lucide-react";
import { Button, Input } from "antd";
import { useEffect, useRef, useState } from "react";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { resourceStorageKey } from "@/services/api/resources";
import { productVideoBeats } from "./product-video";
import { shotDirection, type ProductVideoBoards, type ProductVideoBoardShot } from "./product-video-board";
import { ProductVideoBoardControls } from "./product-video-board-controls";

// Stills from the example shoot illustrate framing. Only the actual product resource is submitted.
const exampleCuts: Record<string, [string, string]> = {
    reveal: ["orbit", "reveal"],
    detail: ["detail", "orbit"],
    orbit: ["detail", "reveal"],
    "day-in-use": ["follow-steps", "scene-first"],
    "scene-first": ["detail", "scene-first"],
    "small-choice": ["detail", "scene-first"],
    "follow-steps": ["answer-question", "start-with-result"],
    "start-with-result": ["follow-steps", "start-with-result"],
    "answer-question": ["follow-steps", "detail"],
};

export function productShotArtwork(index: number, approachId?: string, boardFrame?: ProductVideoBoardShot["frame"], frame?: ProductVideoBoardShot["frame"], frameLabel = "商品首帧", scriptOnly = false) {
    const source = boardFrame || (!scriptOnly && index === 0 ? frame : undefined);
    const sample = !scriptOnly && approachId && (index === 0 && exampleCuts[approachId] ? approachId : exampleCuts[approachId]?.[index - 1]);
    return {
        image: source ? (
            <CachedResourceImage key={source.resourceId} variant="thumbnail" storageKey={resourceStorageKey(source.resourceId)} alt={source.name} fallback={<small>图片不可用</small>} loadingFallback={<Clapperboard size={20} aria-hidden />} />
        ) : sample ? (
            <img src={`/commerce/video-approaches/${sample}.webp`} alt="" width={480} height={300} />
        ) : (
            <Clapperboard size={24} aria-hidden />
        ),
        label: boardFrame ? "分镜参考" : source ? frameLabel : sample ? "构图示意" : scriptOnly ? "按脚本构图" : "待配图",
        hasImage: Boolean(source || sample),
    };
}

type Props = {
    visible: boolean;
    approachId?: string;
    frame?: { resourceId: string; name: string };
    frameLabel?: string;
    boards?: ProductVideoBoards;
    salesVideo?: boolean;
    remix?: boolean;
    projectImages?: NonNullable<ProductVideoBoardShot["frame"]>[];
    canReadFrame?: (id: string) => Promise<boolean>;
    onBoardChange?: (index: number, patch: Partial<ProductVideoBoardShot>) => void;
    shots: string[];
    disabled: boolean;
    initialShot?: number;
    onEdit?: (index: number, value: string) => void;
    onAssist?: (index: 0 | 1 | 2) => void;
};

export function ProductVideoShotPreview({ visible, approachId, frame, frameLabel = "商品首帧", boards, salesVideo, remix, projectImages, canReadFrame, onBoardChange, shots, disabled, initialShot = 0, onEdit, onAssist }: Props) {
    const [active, setActive] = useState(initialShot);
    const [playing, setPlaying] = useState(false);
    const playback = useRef({ remaining: 0, deadline: 0, ended: false });
    useEffect(() => {
        if (!playing) return;
        if (!visible) {
            playback.current.remaining = Math.max(1, playback.current.deadline - performance.now());
            setPlaying(false);
            return;
        }
        const duration = playback.current.remaining || productVideoBeats[active].durationSeconds * 1000;
        playback.current.deadline = performance.now() + duration;
        const timer = window.setTimeout(() => {
            playback.current.remaining = 0;
            if (active === productVideoBeats.length - 1) {
                playback.current.ended = true;
                setPlaying(false);
            } else setActive(active + 1);
        }, duration);
        return () => window.clearTimeout(timer);
    }, [active, playing, visible]);

    function pause() {
        if (playing) playback.current.remaining = Math.max(1, playback.current.deadline - performance.now());
        setPlaying(false);
    }
    function play() {
        if (playback.current.ended) {
            playback.current.ended = false;
            setActive(0);
        }
        setPlaying(true);
    }
    const beat = productVideoBeats[active];
    function artwork(index: number) {
        return productShotArtwork(index, approachId, boards?.[index]?.frame, frame, frameLabel, salesVideo || remix);
    }
    const activeArt = artwork(active);
    function selectShot(index: number) {
        setPlaying(false);
        playback.current.remaining = 0;
        playback.current.ended = false;
        setActive(index);
    }
    const timeline = (
        <div className={onEdit ? "ec-shot-timeline ec-board-strip" : "ec-shot-timeline"} role="group" aria-label="镜头时间线">
            {productVideoBeats.map((item, index) => {
                const art = artwork(index);
                return (
                    <button type="button" key={item.title} data-shot={index} aria-pressed={active === index} onClick={() => selectShot(index)}>
                        {onEdit && (
                            <span className="ec-board-thumb">
                                {art.image}
                                <small>{art.label}</small>
                            </span>
                        )}
                        <strong>{item.title}</strong>
                        <small>{item.time}</small>
                        {onEdit && shotDirection(boards?.[index]) && <span className="ec-board-direction">{shotDirection(boards?.[index])}</span>}
                    </button>
                );
            })}
        </div>
    );
    return (
        <section className={onEdit ? "ec-shot-deck ec-shot-edit" : "ec-shot-deck"} aria-label="分镜预演">
            <div className="ec-shot-deck-head">
                <div>
                    <Clapperboard size={17} aria-hidden />
                    <h3>{onEdit ? "视觉故事板" : "分镜预览"}</h3>
                    <small>15 秒</small>
                </div>
                <button type="button" aria-pressed={playing} disabled={disabled} onClick={playing ? pause : play}>
                    {playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
                    {playing ? "暂停预演" : "播放分镜"}
                </button>
            </div>
            {onEdit && timeline}
            <div className="ec-shot-content">
                <figure className="ec-shot-monitor" data-has-art={activeArt.hasImage}>
                    {activeArt.image}
                    <figcaption>{activeArt.label}</figcaption>
                </figure>
                <div className="ec-shot-notes">
                    <small>镜头 {active + 1} / 3</small>
                    <strong>
                        {beat.title}
                        <span>{beat.time}</span>
                    </strong>
                    {onEdit ? (
                        productVideoBeats.map((item, index) => (
                            <div key={item.title} hidden={active !== index}>
                                <Input.TextArea
                                    id={`ec-video-shot-${index}`}
                                    aria-label={`${item.title}画面`}
                                    required
                                    disabled={disabled}
                                    value={shots[index]}
                                    placeholder="写下这一镜的画面和动作"
                                    onFocus={pause}
                                    onChange={(event) => onEdit(index, event.target.value)}
                                    autoSize={{ minRows: 2, maxRows: 6 }}
                                />
                                {onAssist && (
                                    <Button
                                        size="small"
                                        htmlType="button"
                                        disabled={disabled}
                                        onClick={() => {
                                            pause();
                                            onAssist(index as 0 | 1 | 2);
                                        }}
                                    >
                                        AI 帮写这一镜
                                    </Button>
                                )}
                            </div>
                        ))
                    ) : (
                        <p>{shots[active]}</p>
                    )}
                </div>
            </div>
            {onBoardChange && canReadFrame && !playing && (
                <ProductVideoBoardControls key={active} title={beat.title} shot={boards?.[active]} images={projectImages || []} canReadFrame={canReadFrame} disabled={disabled} salesVideo={salesVideo} onChange={(patch) => onBoardChange(active, patch)} />
            )}
            {!onEdit && timeline}
        </section>
    );
}
