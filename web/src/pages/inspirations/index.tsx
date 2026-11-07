import { App, Button, Input, Switch } from "antd";
import { ArrowUpRight, ChevronDown, Image as ImageIcon, Play, Search, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { PaginationBar } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState, WorkspaceState } from "@/components/layout/workspace-state";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { Select } from "@/components/ui/base/select";
import { AppModal } from "@/components/ui/product/app-modal";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { filterInspirationHall } from "@/lib/inspiration-hall";
import { workbenchCategoryLabel } from "@/pages/workbench/workbench-catalog";
import { fetchInspirations, type InspirationEntry } from "@/services/api/inspirations";
import "./inspirations.css";

const labels = { all: "全部", image: "图片", video: "视频", text: "文本" };

export function InspirationHall({ onUse }: { onUse: (item: InspirationEntry) => void }) {
    const navigate = useNavigate();
    const { message } = App.useApp();
    const query = useQuery({ queryKey: ["inspiration-hall"], queryFn: ({ signal }) => fetchInspirations(false, signal), staleTime: 0 });
    const items = query.data || [];
    const [mode, setMode] = useState("all");
    const [category, setCategory] = useState("all");
    const [sort, setSort] = useState("default");
    const [search, setSearch] = useState("");
    const debouncedSearch = useDebouncedValue(search, 250);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(30);
    const [detail, setDetail] = useState<InspirationEntry | null>(null);
    const [previewEnabled, setPreviewEnabled] = useState(true);
    const visible = useMemo(() => filterInspirationHall(items, mode, category, debouncedSearch, sort), [items, mode, category, debouncedSearch, sort]);
    const categories = [...new Set(items.map((item) => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    const currentPage = Math.min(page, Math.max(1, Math.ceil(visible.length / pageSize)));
    useEffect(() => {
        setPage(1);
    }, [mode, category, debouncedSearch, sort, pageSize]);
    const open = (item: InspirationEntry) => {
        if (item.type === "tool") void navigate(`/toolbox/${item.mode}?tool=${encodeURIComponent(item.toolId!)}`);
        else setDetail(item);
    };
    const copyPrompt = () => {
        if (!detail || !navigator.clipboard) {
            message.warning("当前浏览器不能直接复制，请手动选择提示词。");
            return;
        }
        void navigator.clipboard
            .writeText(detail.prompt)
            .then(() => message.success("提示词已复制"))
            .catch(() => message.error("复制失败，请手动选择提示词"));
    };
    return (
        <section id="creation-inspirations" className="inspiration-hall" aria-labelledby="inspiration-hall-title">
            <header className="inspiration-hall-header">
                <h2 id="inspiration-hall-title">灵感大厅</h2>
            </header>
            <div className="inspiration-hall-toolbar">
                <SegmentedControl options={Object.entries(labels).map(([value, label]) => ({ value, label }))} value={mode} onChange={setMode} ariaLabel="按创作类型筛选灵感" className="inspiration-hall-modes" />
                <label className="inspiration-preview-toggle">
                    <Switch size="small" checked={previewEnabled} onChange={setPreviewEnabled} aria-label="悬停播放视频" />
                    悬停播放
                </label>
                <Input allowClear prefix={<Search className="size-4" />} placeholder="搜索标题、说明或提示词" aria-label="搜索灵感" value={search} onChange={(event) => setSearch(event.target.value)} className="inspiration-hall-search" />
                <Button type="text" icon={<SlidersHorizontal className="size-4" />} aria-expanded={filtersOpen} aria-controls="inspiration-hall-filters" onClick={() => setFiltersOpen((value) => !value)} className="inspiration-hall-filter-toggle">
                    更多筛选
                    <ChevronDown className={filtersOpen ? "is-open" : undefined} />
                </Button>
                <span className="inspiration-hall-count" role="status">
                    共 {visible.length} 条
                </span>
            </div>
            {filtersOpen ? (
                <div id="inspiration-hall-filters" className="inspiration-hall-filters" role="group" aria-label="灵感进阶筛选">
                    <div className="inspiration-hall-field">
                        <span>分类</span>
                        <Select options={[{ value: "all", label: "全部分类" }, ...categories.map((value) => ({ value, label: workbenchCategoryLabel(value) }))]} value={category} onChange={setCategory} ariaLabel="按分类筛选灵感" />
                    </div>
                    <div className="inspiration-hall-field">
                        <span>排序</span>
                        <Select
                            options={[
                                { value: "default", label: "默认顺序" },
                                { value: "title", label: "按标题" },
                            ]}
                            value={sort}
                            onChange={setSort}
                            ariaLabel="灵感排序"
                        />
                    </div>
                </div>
            ) : null}
            <div className="inspiration-hall-results">
                {query.isPending ? (
                    <WorkspaceLoadingState label="正在准备灵感" rows={2} />
                ) : query.isError ? (
                    <WorkspaceErrorState title="灵感加载失败" description="请稍后重试。" onRetry={() => void query.refetch()} />
                ) : visible.length ? (
                    <>
                        <div className="inspiration-gallery">
                            {visible.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((item) => (
                                <article key={item.id} className="inspiration-card">
                                    <button
                                        type="button"
                                        className="inspiration-card-open"
                                        aria-label={`查看${item.type === "tool" ? "创作工具" : "灵感"}：${item.title}`}
                                        onClick={() => open(item)}
                                        onPointerEnter={previewEnabled ? playHoverPreview : undefined}
                                        onPointerLeave={(event) => pauseVideoPreview(event.currentTarget.querySelector("video"))}
                                    >
                                        <span className="inspiration-card-cover">
                                            <InspirationMedia key={item.mediaUrl} item={item} hoverPreview={previewEnabled} />
                                        </span>
                                        {item.mediaKind === "video" && item.mediaUrl ? (
                                            <span className="inspiration-video-mark" aria-hidden="true">
                                                <Play />
                                            </span>
                                        ) : null}
                                        {(item.examples?.length || 0) > 1 ? <span className="inspiration-example-count">{item.examples!.length} 个示例</span> : null}
                                        <span className="inspiration-card-body">
                                            <span className="inspiration-card-title">{item.title}</span>
                                            <span className="inspiration-card-tags">
                                                <span className="inspiration-chip">{labels[item.mode]}</span>
                                                {item.category ? <span className="inspiration-chip">{workbenchCategoryLabel(item.category)}</span> : null}
                                                {item.type === "tool" ? (
                                                    <span className="inspiration-chip">
                                                        创作工具 <ArrowUpRight className="size-3" />
                                                    </span>
                                                ) : null}
                                            </span>
                                        </span>
                                    </button>
                                </article>
                            ))}
                        </div>
                        <PaginationBar
                            current={currentPage}
                            pageSize={pageSize}
                            total={visible.length}
                            pageSizeOptions={[30, 60, 90]}
                            onChange={(value, size) => {
                                setPage(value);
                                setPageSize(size);
                            }}
                        />
                    </>
                ) : (
                    <WorkspaceState title={items.length ? "没有找到符合条件的灵感" : "灵感正在准备中"} description={items.length ? "试试其他类型、分类或搜索词。" : "精选创意与创作工具将在这里展示。"} />
                )}
            </div>
            <AppModal
                open={Boolean(detail)}
                onCancel={() => setDetail(null)}
                title={detail?.title}
                width={(detail?.examples?.length || 0) > 1 ? 960 : 680}
                styles={{ body: { maxHeight: "70dvh", overflowY: "auto" } }}
                footer={
                    detail ? (
                        <>
                            <Button onClick={copyPrompt}>复制提示词</Button>
                            <Button
                                type="primary"
                                onClick={() => {
                                    onUse(detail);
                                    setDetail(null);
                                }}
                            >
                                用这个创意创作
                            </Button>
                        </>
                    ) : null
                }
            >
                {detail ? (
                    <div className="space-y-4">
                        {detail.examples?.length ? (
                            <div className="inspiration-detail-examples">
                                {detail.examples.map((example, index) => (
                                    <figure key={example.resourceId} aria-label={`示例 ${index + 1}`}>
                                        <InspirationMedia item={example} controls />
                                        <figcaption>示例 {index + 1}</figcaption>
                                    </figure>
                                ))}
                            </div>
                        ) : null}
                        {detail.description ? <p>{detail.description}</p> : null}
                        <p className="whitespace-pre-wrap break-words">{detail.prompt}</p>
                    </div>
                ) : null}
            </AppModal>
        </section>
    );
}

const HOVER_PREVIEW_QUERY = "(any-hover: hover) and (any-pointer: fine)";

function pauseVideoPreview(video: HTMLVideoElement | null) {
    if (!video) return;
    video.pause();
    if (video.readyState > 0) video.currentTime = 0;
}

function playHoverPreview(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType !== "mouse" || document.hidden || !window.matchMedia(HOVER_PREVIEW_QUERY).matches) return;
    const video = event.currentTarget.querySelector("video");
    if (!video) return;
    video.muted = true;
    // Browser autoplay policy can reject playback; keep the still frame usable.
    void video.play().catch(() => {});
}

export function InspirationMedia({ item, controls = false, hoverPreview = false }: { item: Pick<InspirationEntry, "mediaUrl" | "mediaKind">; controls?: boolean; hoverPreview?: boolean }) {
    const [failed, setFailed] = useState(false);
    const [videoAspect, setVideoAspect] = useState<{ src: string; ratio: string } | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const pausePreview = useCallback(() => {
        pauseVideoPreview(videoRef.current);
    }, []);
    useEffect(() => {
        if (!hoverPreview || item.mediaKind !== "video") return;
        const policy = window.matchMedia(HOVER_PREVIEW_QUERY);
        const policyChanged = () => {
            if (!policy.matches) pausePreview();
        };
        const visibilityChanged = () => {
            if (document.hidden) pausePreview();
        };
        policy.addEventListener("change", policyChanged);
        document.addEventListener("visibilitychange", visibilityChanged);
        return () => {
            pausePreview();
            policy.removeEventListener("change", policyChanged);
            document.removeEventListener("visibilitychange", visibilityChanged);
        };
    }, [hoverPreview, item.mediaKind, item.mediaUrl, pausePreview]);
    if (!item.mediaUrl || failed)
        return (
            <span className="inspiration-media-placeholder">
                <ImageIcon aria-hidden="true" />
            </span>
        );
    return item.mediaKind === "video" ? (
        <video
            ref={videoRef}
            className="w-full object-contain"
            style={{ aspectRatio: videoAspect?.src === item.mediaUrl ? videoAspect.ratio : undefined }}
            src={item.mediaUrl}
            controls={controls}
            muted={!controls}
            loop={hoverPreview}
            playsInline
            preload="metadata"
            onLoadedMetadata={(event) => {
                const { videoWidth, videoHeight } = event.currentTarget;
                // Keep the natural ratio when the browser discards or reloads media metadata.
                if (videoWidth > 0 && videoHeight > 0) setVideoAspect({ src: item.mediaUrl!, ratio: `${videoWidth} / ${videoHeight}` });
            }}
            onError={() => setFailed(true)}
        />
    ) : (
        <img className="size-full object-cover" src={item.mediaUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
    );
}

export default InspirationHall;
