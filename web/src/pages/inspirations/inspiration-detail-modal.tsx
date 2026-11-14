import { Button } from "antd";
import { Copy, ExternalLink, Heart, Pencil, Trash2, ArrowUpRight } from "lucide-react";
import { useState } from "react";

import { Tooltip } from "@/components/ui/base/tooltip";
import { AppModal } from "@/components/ui/product/app-modal";
import { MediaPlaceholder } from "@/components/ui/product/media-placeholder";
import { catalogIdOf, inspirationSourceOf, type CreationInspiration } from "@/lib/inspirations/catalog";
import { isCustomInspiration } from "@/lib/inspirations/resolve";
import { modeLabels } from "@/pages/create/creation-types";
import { useUserStore } from "@/stores/use-user-store";
import type { InspirationPreview } from "@/lib/inspirations/examples";
import { InspirationExampleMedia } from "./inspiration-example-media";

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex min-w-0 items-baseline gap-3 text-xs leading-5">
            <span className="w-12 shrink-0 text-foreground/45">{label}</span>
            <span className="min-w-0 flex-1 text-foreground/78">{children}</span>
        </div>
    );
}

export function InspirationDetailModal({
    item,
    canManage,
    examples,
    examplesLoading,
    examplesError,
    categoryLabel,
    favorite,
    onClose,
    onUse,
    onEdit,
    onDelete,
    onToggleFavorite,
    onCopy,
}: {
    item: CreationInspiration | null;
    canManage: boolean;
    examples: InspirationPreview[];
    examplesLoading: boolean;
    examplesError: boolean;
    categoryLabel: (item: CreationInspiration) => string;
    favorite: boolean;
    onClose: () => void;
    onUse: (item: CreationInspiration) => void;
    onEdit: (item: CreationInspiration) => void;
    onDelete: (item: CreationInspiration) => void;
    onToggleFavorite: (item: CreationInspiration) => void;
    onCopy: (text: string, label: string) => void;
}) {
    const showSources = useUserStore((state) => state.features.inspirationSourcesVisible);
    const [usingPrompt, setUsingPrompt] = useState(false);
    const source = item ? inspirationSourceOf(item) : null;
    const custom = item ? isCustomInspiration(catalogIdOf(item)) : false;

    return (
        <AppModal
            open={Boolean(item)}
            onCancel={onClose}
            width={1180}
            centered
            aria-label={item?.title ?? "灵感详情"}
            title={null}
            footer={null}
            flush
            focusTriggerAfterClose={!usingPrompt}
            afterOpenChange={(visible) => {
                if (visible) setUsingPrompt(false);
            }}
        >
            {item ? (
                <div className="inspiration-detail-shell">
                    <div className="inspiration-detail-layout">
                        <section className="inspiration-detail-examples" aria-label="作品示例">
                            <h3 className="text-sm font-semibold">作品示例{examples.length ? ` · ${examples.length}` : ""}</h3>
                            {examples.length ? (
                                <div className={`inspiration-example-gallery${examples.length === 1 ? " is-single" : ""}`}>
                                    {examples.map((example) => (
                                        <figure key={example.id} className="inspiration-example">
                                            <InspirationExampleMedia key={example.id} example={example} controls showSourceLink={showSources} />
                                            {example.title || example.description ? (
                                                <figcaption>
                                                    {example.title ? <strong>{example.title}</strong> : null}
                                                    {example.description ? <p>{example.description}</p> : null}
                                                </figcaption>
                                            ) : null}
                                        </figure>
                                    ))}
                                </div>
                            ) : (
                                <p className="inspiration-example-empty" role="status">
                                    {examplesLoading ? "正在加载作品示例…" : examplesError ? "作品示例暂时无法加载" : "暂未配置作品示例"}
                                    {showSources && item.mode === "video" && item.sourceUrl && /^https:\/\//.test(item.sourceUrl) ? (
                                        <a className="ml-2 underline" href={item.sourceUrl} target="_blank" rel="noreferrer">
                                            查看原作品
                                        </a>
                                    ) : null}
                                </p>
                            )}
                        </section>
                        <div className="inspiration-detail-information">
                            <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
                                <div className="min-w-0">
                                    <h2 className="text-[var(--fs-heading,16px)] font-semibold leading-6 text-foreground">{item.title}</h2>
                                    {item.description ? <p className="mt-1 text-xs leading-5 text-foreground/58">{item.description}</p> : null}
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    <Tooltip title={favorite ? "取消收藏" : "收藏"}>
                                        <button type="button" data-icon-only className="inspiration-icon-button" aria-label={favorite ? "取消收藏灵感" : "收藏灵感"} aria-pressed={favorite} onClick={() => onToggleFavorite(item)}>
                                            <span aria-hidden="true">
                                                <Heart className="size-4" fill={favorite ? "currentColor" : "none"} />
                                            </span>
                                        </button>
                                    </Tooltip>
                                    {canManage ? (
                                        <>
                                            <Tooltip title="编辑">
                                                <button type="button" data-icon-only className="inspiration-icon-button" aria-label="编辑灵感" onClick={() => onEdit(item)}>
                                                    <span aria-hidden="true">
                                                        <Pencil className="size-4" />
                                                    </span>
                                                </button>
                                            </Tooltip>
                                            <Tooltip title={custom ? "删除" : "从库中隐藏"}>
                                                <button type="button" data-icon-only className="inspiration-icon-button" aria-label={custom ? "删除灵感" : "隐藏灵感"} onClick={() => onDelete(item)}>
                                                    <span aria-hidden="true">
                                                        <Trash2 className="size-4" />
                                                    </span>
                                                </button>
                                            </Tooltip>
                                        </>
                                    ) : null}
                                </div>
                            </div>

                            <div className="flex flex-col gap-2">
                                {showSources ? (
                                    <MetaRow label="来源">
                                        {source?.name ?? (item.sourceId && item.sourceId !== "original" ? (source?.label ?? "未标注来源") : "原创")}
                                        {item.credit ? ` · ${item.credit}` : ""}
                                    </MetaRow>
                                ) : null}
                                <MetaRow label="分类">{categoryLabel(item)}</MetaRow>
                                <MetaRow label="类型">
                                    {modeLabels[item.mode]}
                                    {item.ratio ? ` · ${item.ratio}` : ""}
                                </MetaRow>
                                {item.tags?.length ? (
                                    <MetaRow label="标签">
                                        <span className="flex flex-wrap gap-2">
                                            {item.tags.map((tag) => (
                                                <span key={tag} className="inspiration-chip">
                                                    {tag}
                                                </span>
                                            ))}
                                        </span>
                                    </MetaRow>
                                ) : null}
                                {showSources && item.sourceUrl ? (
                                    <MetaRow label="原页">
                                        <a className="inline-flex items-center gap-1 text-primary hover:underline" href={item.sourceUrl} target="_blank" rel="noreferrer">
                                            查看上游内容 <ExternalLink className="size-3" />
                                        </a>
                                    </MetaRow>
                                ) : null}
                            </div>

                            <PromptSection label={item.promptZh ? "提示词 · 中文" : "提示词"} text={item.promptZh || item.prompt} onCopy={onCopy} />
                            {item.promptZh && item.prompt !== item.promptZh ? <PromptSection label="提示词 · 原文" text={item.prompt} onCopy={onCopy} /> : null}
                        </div>
                    </div>

                    <div className="inspiration-detail-footer">
                        <Button onClick={onClose}>关闭</Button>
                        <Button
                            type="primary"
                            icon={<ArrowUpRight className="size-4" />}
                            onClick={() => {
                                setUsingPrompt(true);
                                onClose();
                                onUse(item);
                            }}
                        >
                            用这个创意创作
                        </Button>
                    </div>
                </div>
            ) : null}
        </AppModal>
    );
}

export function InspirationCover({ image }: { image: string }) {
    const [failed, setFailed] = useState(false);
    return failed ? <MediaPlaceholder failed /> : <img src={image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

function PromptSection({ label, text, onCopy }: { label: string; text: string; onCopy: (text: string, label: string) => void }) {
    return (
        <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-medium text-foreground/58">{label}</h3>
                <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => onCopy(text, label)}>
                    复制
                </Button>
            </div>
            <div className="inspiration-prompt-block">{text}</div>
        </section>
    );
}
