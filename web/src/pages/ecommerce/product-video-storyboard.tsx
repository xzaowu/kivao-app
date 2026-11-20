import { Button } from "antd";
import { Check, PenLine, Sparkles } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { SegmentedControl } from "@/components/ui/base/segmented-control/segmented-control";
import type { EcommerceDraft } from "@/services/api/ecommerce";
import { productSalesVideoApproaches, productVideoApproaches, productVideoPurposes, type ProductVideoApproach, type ProductVideoPurpose } from "./product-video-approaches";
import { withBoardShot, type ProductVideoBoards } from "./product-video-board";
import { ProductVideoShotPreview } from "./product-video-shot-preview";
import "./product-video-storyboard.css";

export type ProductVideoStory = { purpose: ProductVideoPurpose; approachId?: string; shots: string[]; edited: boolean; boards?: ProductVideoBoards; boardInputs?: boolean; followBrief?: true };
type Props = {
    active: boolean;
    draft: EcommerceDraft;
    frame?: { resourceId: string; name: string };
    frameLabel?: string;
    projectImages: { resourceId: string; name: string }[];
    canReadFrame: (id: string) => Promise<boolean>;
    presenterMode?: boolean;
    salesVideo?: boolean;
    remix?: boolean;
    facts: string;
    closing: string;
    story: ProductVideoStory | null;
    initialShot?: number;
    purpose: ProductVideoPurpose;
    onPurpose: (purpose: ProductVideoPurpose) => void;
    candidateId: string;
    onCandidate: (value: string) => void;
    picking: boolean;
    onPicking: (picking: boolean) => void;
    onChange: (story: ProductVideoStory) => void;
    onAssist: (target: "all" | 0 | 1 | 2) => void;
    disabled: boolean;
};

export function ProductVideoStoryboard({
    active,
    draft,
    frame,
    frameLabel,
    projectImages,
    canReadFrame,
    presenterMode,
    salesVideo,
    remix,
    facts,
    closing,
    story,
    initialShot,
    purpose,
    onPurpose,
    candidateId,
    onCandidate,
    picking,
    onPicking,
    onChange,
    onAssist,
    disabled,
}: Props) {
    const [pending, setPending] = useState<ProductVideoApproach | null>(null);
    const groupName = useId();
    const sectionTitle = useRef<HTMLHeadingElement>(null);
    const keepButton = useRef<HTMLButtonElement>(null);
    const moveFocus = useRef(false);
    const choosing = !story || (!remix && picking);
    const approachesFor = (target: ProductVideoPurpose) => (salesVideo ? productSalesVideoApproaches(target, draft, facts, closing) : productVideoApproaches(target, draft));
    const approaches = remix ? [] : approachesFor(purpose);
    const candidate = approaches.find((item) => item.id === candidateId) ?? approaches[0];
    useLayoutEffect(() => {
        if (!moveFocus.current) return;
        moveFocus.current = false;
        (pending ? keepButton.current : sectionTitle.current)?.focus();
    }, [choosing, pending]);

    function editScript(approach?: ProductVideoApproach) {
        moveFocus.current = true;
        onChange({ purpose, approachId: approach?.id, shots: approach?.shots ?? ["", "", ""], edited: false });
        setPending(null);
        onPicking(false);
    }
    function keepScript() {
        moveFocus.current = true;
        setPending(null);
        onPicking(false);
    }
    function choose() {
        if (disabled || pending) return;
        if (story?.approachId === candidate.id) keepScript();
        else if (story?.edited && (story.boards || story.shots.some((shot) => shot.trim()))) {
            moveFocus.current = true;
            setPending(candidate);
        } else editScript(candidate);
    }

    if (remix && !story) return null;
    if (!remix && pending) {
        return (
            <div className="ec-video-replace" role="group" aria-label="更换拍法确认">
                <h2>替换当前分镜？</h2>
                <p>应用「{pending.title}」会替换三段分镜、分镜参考图和镜头设置。卖点和口播会保留。</p>
                <Button ref={keepButton} disabled={disabled} onClick={keepScript}>
                    保留当前分镜
                </Button>
                <Button disabled={disabled} onClick={() => editScript(pending)}>
                    应用新拍法
                </Button>
            </div>
        );
    }

    if (choosing) {
        return (
            <form
                className="ec-video-planner"
                id="ec-video-preset-form"
                onSubmit={(event) => {
                    event.preventDefault();
                    choose();
                }}
            >
                <div className="ec-video-row ec-video-planner-head">
                    <h2 ref={sectionTitle} tabIndex={-1}>
                        选择视频拍法
                    </h2>
                    <Button
                        size="small"
                        htmlType="button"
                        icon={<Sparkles size={14} aria-hidden />}
                        disabled={disabled}
                        onClick={() => {
                            if (story) keepScript();
                            else editScript();
                            onAssist("all");
                        }}
                    >
                        AI 帮我编排
                    </Button>
                    <Button type="text" size="small" icon={<PenLine size={14} aria-hidden />} disabled={disabled} onClick={() => (story ? keepScript() : editScript())}>
                        {story ? "返回当前分镜" : "自己写分镜"}
                    </Button>
                </div>
                <SegmentedControl<ProductVideoPurpose> ariaLabel="视频用途" value={purpose} onChange={onPurpose} options={productVideoPurposes.map(({ id, label }) => ({ value: id, label }))} disabled={disabled} />
                <div role="group" aria-label="选择拍法" className="ec-video-approaches">
                    {approaches.map((item) => (
                        <label key={item.id}>
                            <input type="radio" name={groupName} checked={candidate.id === item.id} value={item.id} onChange={() => onCandidate(item.id)} disabled={disabled} />
                            <img src={`/commerce/video-approaches/${item.id}.webp`} width={480} height={300} alt="" />
                            <span className="ec-video-card-title">
                                <strong>{item.title}</strong>
                                <span className="ec-video-choice-mark" aria-hidden>
                                    {candidate.id === item.id && <Check size={12} strokeWidth={3} />}
                                </span>
                            </span>
                        </label>
                    ))}
                </div>
                <ProductVideoShotPreview key={candidate.id} visible={active} approachId={candidate.id} shots={candidate.shots} disabled={disabled} />
            </form>
        );
    }

    const applied = remix ? undefined : approachesFor(story.purpose).find((item) => item.id === story.approachId);
    const hasBoardImage = story.boards?.some((board) => board.frame);
    return (
        <section className="ec-video-planner" aria-label="分镜脚本">
            <div className="ec-video-row ec-video-planner-head">
                <div>
                    <h2 ref={sectionTitle} tabIndex={-1}>
                        {remix ? "复刻分镜" : presenterMode ? "口播分镜" : (applied?.title ?? "自写分镜")}
                    </h2>
                    <small>草稿自动保存到此浏览器</small>
                </div>
                {!remix && !presenterMode && !salesVideo && (
                    <Button
                        size="small"
                        disabled={disabled}
                        onClick={() => {
                            moveFocus.current = true;
                            onPurpose(story.purpose);
                            onCandidate(story.approachId || "");
                            onPicking(true);
                        }}
                    >
                        更换拍法
                    </Button>
                )}
            </div>
            <ProductVideoShotPreview
                visible={active}
                key={story.approachId || "manual"}
                initialShot={initialShot}
                approachId={story.approachId}
                frame={frame}
                frameLabel={frameLabel}
                shots={story.shots}
                boards={story.boards}
                salesVideo={salesVideo}
                remix={remix}
                projectImages={projectImages}
                canReadFrame={canReadFrame}
                onBoardChange={(index, patch) =>
                    onChange({ ...story, edited: true, ...(salesVideo && patch.frame && story.boardInputs === undefined && { boardInputs: true }), boards: withBoardShot(story.boards, index, { ...story.boards?.[index], ...patch }) })
                }
                disabled={disabled}
                onEdit={(index, value) => onChange({ ...story, edited: true, shots: story.shots.map((text, n) => (n === index ? value : text)) })}
                onAssist={onAssist}
            />
            {salesVideo && (
                <label>
                    <input type="checkbox" checked={Boolean(story.boardInputs && hasBoardImage)} disabled={disabled || !hasBoardImage} onChange={(event) => onChange({ ...story, edited: true, boardInputs: event.target.checked })} /> 生成时使用分镜参考图
                </label>
            )}
        </section>
    );
}
