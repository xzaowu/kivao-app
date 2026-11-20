import { Check, ChevronRight, Image as ImageIcon, Pencil } from "lucide-react";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { resourceStorageKey } from "@/services/api/resources";
import type { ProductVideoStep } from "./product-video-draft";
import { productVideoBeats } from "./product-video";
import type { ProductVideoStory } from "./product-video-storyboard";
import { shotDirection } from "./product-video-board";
import { productShotArtwork } from "./product-video-shot-preview";
import "./product-video-guide.css";
export { ProductVideoPrepGuide } from "./product-video-examples";

const steps = [
    { id: "materials", label: "准备素材" },
    { id: "script", label: "编排分镜" },
    { id: "review", label: "确认生成" },
] as const;
export function ProductVideoSteps({ step, ready, scripted, disabled, onChange }: { step: ProductVideoStep; ready: boolean; scripted: boolean; disabled: boolean; onChange: (next: ProductVideoStep) => void }) {
    return (
        <nav className="ec-video-steps" aria-label="商品视频制作步骤">
            <ol>
                {steps.map(({ id, label }, i) => {
                    const complete = id === "materials" ? ready : id === "script" && scripted;
                    return (
                        <li key={id}>
                            <button type="button" aria-current={step === id ? "step" : undefined} disabled={disabled} onClick={() => onChange(id)}>
                                <span aria-hidden="true">{complete && step !== id ? <Check size={14} /> : i + 1}</span>
                                {label}
                            </button>
                            {i < steps.length - 1 && <ChevronRight aria-hidden="true" size={14} />}
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}

export function ProductVideoMaterialSummary({ label, frame, extra, onEdit, disabled }: { label: string; frame?: { resourceId: string; name: string }; extra?: string; onEdit: () => void; disabled: boolean }) {
    return (
        <aside className="ec-video-material-summary">
            <div className="ec-video-material-mini">{frame ? <CachedResourceImage variant="thumbnail" storageKey={resourceStorageKey(frame.resourceId)} alt="" /> : <ImageIcon aria-hidden size={22} />}</div>
            <div>
                <small>{label}</small>
                <strong>{frame?.name || (frame ? "已选图片" : "尚未添加")}</strong>
                {extra && <small>{extra}</small>}
            </div>
            <button type="button" disabled={disabled} onClick={onEdit}>
                编辑素材
            </button>
        </aside>
    );
}

export function ProductVideoReviewShots({ story, frame, frameLabel, disabled, onEdit }: { story: ProductVideoStory; frame?: { resourceId: string; name: string }; frameLabel: string; disabled: boolean; onEdit: (index: number) => void }) {
    return (
        <ol className="ec-video-final-shots">
            {productVideoBeats.map(({ time, title }, i) => {
                const board = story.boards?.[i],
                    direction = shotDirection(board);
                const art = productShotArtwork(i, story.approachId, board?.frame, frame, frameLabel);
                return (
                    <li key={title}>
                        <button type="button" className="ec-film-review-frame" disabled={disabled} aria-label={`编辑${title}分镜`} onClick={() => onEdit(i)}>
                            {art.image}
                            <small>{art.label}</small>
                            <span>
                                <Pencil aria-hidden size={14} />
                            </span>
                        </button>
                        <div>
                            <strong>{title}</strong>
                            <small>
                                {time}
                                {direction && ` · ${direction}`}
                            </small>
                            <p>{story.shots[i] || "待补充画面动作"}</p>
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}
