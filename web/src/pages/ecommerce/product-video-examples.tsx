import { Check, Play } from "lucide-react";
import { useRef, useState } from "react";
import { AppModal } from "@/components/ui/product/app-modal";
import type { ProductVideoMode } from "./product-video-draft";
import { videoRemixPresets, type VideoRemixPreset } from "./product-video-remix-presets";
import "./product-video-examples.css";

const assetRoot = "/commerce/video-examples";
const shotsRoot = "/commerce/video-approaches";
const clips = {
    reference: { label: "示例参考片", sequence: "全景亮相 → 瓶口特写 → 正面定格" },
    close: { label: "商品展示", sequence: "轮廓入画 → 瓶口特写 → 商品全貌", frames: [`${shotsRoot}/reveal.webp`, `${shotsRoot}/detail.webp`, `${shotsRoot}/orbit.webp`] },
    adapt: { label: "场景改编", sequence: "客厅开场 → 俯拍使用 → 环境收尾", frames: [`${shotsRoot}/scene-first.webp`, `${shotsRoot}/follow-steps.webp`, `${shotsRoot}/start-with-result.webp`] },
    presenter: { label: "人物口播", sequence: "人物出镜 → 商品亮相 → 手势特写", frames: [`${assetRoot}/presenter.webp`, `${shotsRoot}/day-in-use.webp`, `${shotsRoot}/answer-question.webp`] },
} as const;
type Clip = keyof typeof clips;
type GuideProps = {
    mode: ProductVideoMode;
    active: boolean;
    disabled: boolean;
    referencePreset?: VideoRemixPreset;
    onChooseReferencePreset?: (preset: VideoRemixPreset) => void;
};
const modeTitle = { image: "商品展示示例", reference: "复刻拍法示例", presenter: "人物口播示例" };
const previews = { image: ["close"], reference: ["close", "adapt"], presenter: ["presenter"] } as const;

export function ProductVideoPrepGuide({ active, ...props }: GuideProps) {
    return active ? <Examples key={props.mode} {...props} /> : null;
}

function Examples({ mode, disabled, referencePreset, onChooseReferencePreset }: Omit<GuideProps, "active">) {
    const [preview, setPreview] = useState<Clip | null>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const [mediaError, setMediaError] = useState(false);
    const referenceMode = mode === "reference";
    function play(clip: Clip, button: HTMLButtonElement) {
        trigger.current = button;
        setMediaError(false);
        setPreview(clip);
    }
    return (
        <aside className="ec-video-prep-guide" aria-label="拍法示例">
            <div className="ec-example-heading">
                <h3 tabIndex={-1}>{modeTitle[mode]}</h3>
                {referenceMode && (
                    <button className="ec-example-source" type="button" onClick={(event) => play("reference", event.currentTarget)} aria-label="播放参考片 · 示例参考片">
                        <Play size={13} aria-hidden /> 看示例原片
                    </button>
                )}
            </div>
            <div className="ec-video-examples">
                {previews[mode].map((clip) => {
                    const preset = referenceMode && clip !== "presenter" ? clip : null;
                    return (
                        <div className="ec-video-example" key={clip}>
                            {preset && onChooseReferencePreset && (
                                <div className="ec-example-variation">
                                    <h4>{videoRemixPresets[preset].title}</h4>
                                    <button className="ec-example-apply" type="button" disabled={disabled} aria-pressed={preset === referencePreset} onClick={() => onChooseReferencePreset(preset)} aria-label={`采用${videoRemixPresets[preset].title}拍法`}>
                                        {preset === referencePreset && <Check size={13} aria-hidden />}
                                        {preset === referencePreset ? "已采用" : "采用此拍法"}
                                    </button>
                                </div>
                            )}
                            <button className="ec-example-film" type="button" onClick={(event) => play(clip, event.currentTarget)} aria-label={`播放分镜预演 · ${clips[clip].label}`}>
                                <span className="ec-example-frames" aria-hidden="true">
                                    {clips[clip].frames.map((src) => (
                                        <img key={src} src={src} width="240" height="300" alt="" loading="lazy" decoding="async" />
                                    ))}
                                    <span className="ec-example-play">
                                        <Play size={12} fill="currentColor" />
                                        0:06
                                    </span>
                                </span>
                                <span className="ec-example-caption">{clips[clip].sequence}</span>
                            </button>
                        </div>
                    );
                })}
            </div>
            <AppModal
                open={preview !== null}
                title={preview && `${clips[preview].label} · 分镜预演`}
                onCancel={() => setPreview(null)}
                afterClose={() => trigger.current?.focus({ preventScroll: true })}
                centered
                width="min(430px, calc(100vw - 24px))"
                footer={null}
            >
                {preview && (
                    <div className="ec-example-player">
                        <video src={`${assetRoot}/${preview}.mp4`} aria-label={clips[preview].label} poster={`${assetRoot}/${preview}.webp`} width="288" height="360" controls autoPlay muted playsInline onError={() => setMediaError(true)} />
                        {mediaError && <span role="alert">这段预演暂时无法播放。</span>}
                        <p>{clips[preview].sequence}</p>
                        <figure className="ec-example-original">
                            <img src="/commerce/examples/diffuser-white-preview.webp" width="560" height="700" alt="白色无火香薰瓶" />
                            <figcaption>示例商品原图</figcaption>
                        </figure>
                    </div>
                )}
            </AppModal>
        </aside>
    );
}
