import { Button } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { AppModal } from "@/components/ui/product/app-modal";
import type { EcommerceReference } from "@/services/api/ecommerce";
import { resourceIdFromStorageKey, resourceStorageKey } from "@/services/api/resources";
import { listRemoteAssetsPage } from "@/services/api/user-data";
import type { Asset } from "@/stores/use-asset-store";
import { commerceModelById, commerceModelCatalog, type CommerceModelProfile } from "./model-catalog";

export type CastingPhoto = { resourceId: string; name: string; catalogId?: string };
type ProjectChoice = CastingPhoto & { primary?: boolean };

export function projectCastingPhotos(references: EcommerceReference[], primaryId?: string, currentProduct?: CastingPhoto) {
    const people: ProjectChoice[] = [];
    const products: ProjectChoice[] = [];
    const peopleIds = new Set(references.filter((ref) => ref.role === "model").map((ref) => ref.resourceId));
    for (const ref of references) {
        if (!ref.resourceId) continue;
        if (ref.role === "model") {
            const profile = commerceModelById(ref.catalogId);
            if (profile?.kind === "mannequin" || people.some((item) => item.resourceId === ref.resourceId)) continue;
            people.push({ resourceId: ref.resourceId, catalogId: ref.catalogId, name: ref.name || profile?.name || `项目模特 ${people.length + 1}`, primary: ref.resourceId === primaryId });
        } else if (["primary", "detail", "sku", "package"].includes(ref.role) && !peopleIds.has(ref.resourceId) && !products.some((item) => item.resourceId === ref.resourceId)) {
            products.push({ resourceId: ref.resourceId, name: ref.name || `商品图 ${products.length + 1}`, primary: ref.role === "primary" });
        }
    }
    for (const group of [people, products]) group.sort((a, b) => Number(!!b.primary) - Number(!!a.primary));
    if (currentProduct && !references.some((ref) => ref.resourceId === currentProduct.resourceId)) products.push(currentProduct);
    return { person: people, product: products };
}

type Props = {
    scope: string;
    slot: "person" | "product";
    choices: ProjectChoice[];
    current?: CastingPhoto;
    busy: boolean;
    error: string;
    onClose: () => void;
    onChoose: (photo: CastingPhoto | CommerceModelProfile) => void;
};

export function ProjectCastingPicker(props: Props) {
    const id = useId();
    const { slot, choices, current, busy, error, onClose, onChoose } = props;
    const [key, setKey] = useState(current?.resourceId || choices[0]?.resourceId);
    if (slot === "person") return <CastingGallery {...props} />;
    const selected = choices.find((p) => p.resourceId === key) || choices[0];
    return (
        <AppModal
            title="选择项目商品图"
            open
            width={420}
            onCancel={() => {
                if (!busy) onClose();
            }}
            footer={null}
        >
            <div className="ec-casting-picker">
                <label htmlFor={id}>商品原图</label>
                <select id={id} value={selected?.resourceId || ""} disabled={busy} onChange={(event) => setKey(event.target.value)}>
                    {choices.map((item) => (
                        <option key={item.resourceId} value={item.resourceId}>
                            {item.name}
                            {item.primary ? " · 主图" : ""}
                        </option>
                    ))}
                </select>
                {selected && <CachedResourceImage key={selected.resourceId} storageKey={resourceStorageKey(selected.resourceId)} alt={selected.name} eager variant="thumbnail" />}
                {error && <p role="alert">{error}</p>}
                <Button type="primary" disabled={!selected || busy} loading={busy} onClick={() => selected && onChoose(selected)}>
                    使用这张商品图
                </Button>
            </div>
        </AppModal>
    );
}

const officialPeople = commerceModelCatalog.filter((item) => item.kind === "person");
const galleries = { official: "官方模特", mine: "我的 AI 模特", project: "项目模特" };
type Gallery = keyof typeof galleries;
type Option = { key: string; source: CastingPhoto | CommerceModelProfile; subtitle?: string };

export function privateCastingPhoto(asset: Asset): CastingPhoto | undefined {
    if (asset.kind !== "image" || asset.status === "archived" || (asset.metadata?.ecommerceStage !== "product-video-casting" && !asset.tags?.includes("AI 模特"))) return;
    const resourceId = resourceIdFromStorageKey(asset.data.storageKey);
    if (resourceId) return { resourceId, name: asset.title };
}

function CastingGallery({ scope, choices, current, busy, error, onClose, onChoose }: Props) {
    const group = useId();
    const [tab, setTab] = useState<Gallery>("official");
    const [filter, setFilter] = useState("all");
    const [page, setPage] = useState(1);
    const [key, setKey] = useState(current?.catalogId || current?.resourceId);
    const mine = useQuery({ queryKey: ["ecommerce-casting-library", scope, page], enabled: tab === "mine", retry: false, queryFn: ({ signal }) => listRemoteAssetsPage({ page, pageSize: 24, kind: "image", status: "active", query: "AI 模特", signal }) });
    const photos: Option[] =
        tab === "official"
            ? officialPeople.filter((p) => filter === "all" || p.age === filter).map((source) => ({ key: source.id, source, subtitle: source.description }))
            : tab === "project"
              ? choices.map((source) => ({ key: source.resourceId, source, subtitle: source.primary ? "主模特" : undefined }))
              : (mine.data?.assets || []).flatMap((asset) => {
                    const source = privateCastingPhoto(asset);
                    return source ? [{ key: source.resourceId, source }] : [];
                });
    const selected = photos.find((option) => option.key === key) || photos[0];
    const choose = () => {
        if (!selected) return;
        const source = selected.source;
        onChoose("image" in source ? choices.find((p) => p.catalogId === source.id) || source : source);
    };
    return (
        <AppModal
            open
            title="出镜模特库"
            width={680}
            footer={null}
            onCancel={() => {
                if (!busy) onClose();
            }}
        >
            <div className="ec-casting-gallery">
                <div className="ec-casting-tabs" role="group" aria-label="模特来源">
                    {(Object.keys(galleries) as Gallery[])
                        .filter((k) => k !== "project" || choices.length)
                        .map((k) => (
                            <button
                                key={k}
                                type="button"
                                aria-pressed={tab === k}
                                disabled={busy}
                                onClick={() => {
                                    setTab(k);
                                    setKey(undefined);
                                }}
                            >
                                {galleries[k]}
                            </button>
                        ))}
                </div>
                {tab === "official" && (
                    <label className="ec-casting-filter">
                        年龄组
                        <select value={filter} onChange={(e) => setFilter(e.target.value)} disabled={busy}>
                            <option value="all">全部年龄</option>
                            <option value="adult">成年</option>
                            <option value="mature">银发</option>
                            <option value="child">童装</option>
                        </select>
                    </label>
                )}
                {!!photos.length && (
                    <fieldset className="ec-casting-grid" disabled={busy}>
                        <legend className="sr-only">选择一位出镜人</legend>
                        {photos.map(({ key: optionKey, source, subtitle }) => (
                            <label className="ec-casting-card" key={optionKey}>
                                <input type="radio" name={group} value={optionKey} aria-label={source.name} checked={selected?.key === optionKey} onChange={() => setKey(optionKey)} />
                                {"resourceId" in source ? (
                                    <CachedResourceImage storageKey={resourceStorageKey(source.resourceId)} variant="thumbnail" alt="" />
                                ) : (
                                    <img width="240" height="320" src={`/ecommerce-models/previews/${source.id}.webp`} alt="" loading="lazy" />
                                )}
                                <span>{source.name}</span>
                                {tab === "project" && subtitle && <small>{subtitle}</small>}
                            </label>
                        ))}
                    </fieldset>
                )}
                {tab === "mine" && (mine.isPending ? <p role="status">正在读取你的模特…</p> : mine.isError ? <Button onClick={() => void mine.refetch()}>重新读取我的模特</Button> : !photos.length && <p>这里会保存你用「AI 生成模特」创建的人物。</p>)}
                {tab === "mine" && (page > 1 || mine.data?.hasMore) && (
                    <div className="ec-casting-suggestions">
                        <Button disabled={busy || page === 1} onClick={() => setPage((p) => p - 1)}>
                            上一页
                        </Button>
                        <Button disabled={busy || !mine.data?.hasMore} onClick={() => setPage((p) => p + 1)}>
                            下一页
                        </Button>
                    </div>
                )}
                <div className="ec-casting-footer">
                    <div aria-live="polite">
                        {selected && (
                            <>
                                <strong>{selected.source.name}</strong>
                                {selected.subtitle && <small>{selected.subtitle}</small>}
                            </>
                        )}
                    </div>
                    <Button type="primary" disabled={busy || !selected} loading={busy} onClick={choose}>
                        使用这位模特
                    </Button>
                </div>
                {error && <p role="alert">{error}</p>}
            </div>
        </AppModal>
    );
}
