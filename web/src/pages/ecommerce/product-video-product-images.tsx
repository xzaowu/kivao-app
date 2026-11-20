import { Button } from "antd";
import { ArrowLeft, ArrowRight, Check, FolderOpen, ImagePlus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { AppModal } from "@/components/ui/product/app-modal";
import { assertCurrentUserSession, captureUserSession } from "@/lib/user-scope";
import { WorkbenchAssetPicker, type PickedWorkbenchAsset } from "@/pages/workbench/workbench-asset-picker";
import { resourceStorageKey } from "@/services/api/resources";
import type { ProductVideoVersion } from "@/services/api/task-center";
import { COMMERCE_IMAGE_ACCEPT } from "./image-transfer";
import { isProductVideoFrame } from "./product-video-version";
import "./product-video-product-images.css";

type ProductImage = ProductVideoVersion["frame"];
type Props = {
    value: ProductImage[];
    projectImages: ProductImage[];
    disabled: boolean;
    onChange: (images: ProductImage[]) => void;
    onUpload: (file: File) => Promise<string | undefined>;
    canReadImage: (resourceId: string) => Promise<boolean>;
    onBusyChange?: (busy: boolean) => void;
};

const imageOnly = ["image"] as const;
const maxImages = 3;

export function ProductVideoProductImages({ value, projectImages, disabled, onChange, onUpload, canReadImage, onBusyChange }: Props) {
    const input = useRef<HTMLInputElement>(null);
    const previewTrigger = useRef<HTMLButtonElement | null>(null);
    const mounted = useRef(true);
    const pending = useRef(false);
    const [uploading, setUploading] = useState(false);
    const [picker, setPicker] = useState(false);
    const [preview, setPreview] = useState<ProductImage>();
    const [error, setError] = useState("");
    const title = useId();
    const locked = disabled || uploading;
    const remaining = maxImages - value.length;
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    useEffect(() => {
        if (!picker && !uploading) return;
        onBusyChange?.(true);
        return () => onBusyChange?.(false);
    }, [picker, uploading, onBusyChange]);

    function update(images: ProductImage[]) {
        setError("");
        onChange(images);
    }
    function move(index: number, offset: -1 | 1) {
        const images = [...value];
        const target = index + offset;
        [images[index], images[target]] = [images[target], images[index]];
        update(images);
    }
    async function upload(files: File[]) {
        if (!files.length || locked || pending.current) return;
        if (files.length > remaining) {
            setError(`最多可选择 3 张商品参考图，本次还可添加 ${remaining} 张。`);
            return;
        }
        pending.current = true;
        setUploading(true);
        setError("");
        const images = [...value];
        const problems: string[] = [];
        try {
            const session = captureUserSession();
            for (const file of files) {
                assertCurrentUserSession(session);
                if (!mounted.current) return;
                try {
                    const resourceId = await onUpload(file);
                    if (!resourceId) throw new Error(`“${file.name}”未添加，可检查项目图片。`);
                    if (!images.some((image) => image.resourceId === resourceId)) images.push({ resourceId, name: file.name });
                } catch (cause) {
                    problems.push(cause instanceof Error ? cause.message : `“${file.name}”上传失败，请重试。`);
                }
            }
            assertCurrentUserSession(session);
            if (!mounted.current) return;
            if (images.length !== value.length) onChange(images);
            setError(problems.join(" "));
        } catch (cause) {
            if (mounted.current) setError(cause instanceof Error ? cause.message : "上传中断，请重试。");
        } finally {
            pending.current = false;
            if (mounted.current) {
                setUploading(false);
            }
        }
    }
    async function pick(assets: PickedWorkbenchAsset[]) {
        const session = captureUserSession();
        const images = assets.map(({ resourceId, name }) => ({ resourceId, name, source: "library" as const }));
        if (assets.some(({ kind }) => kind !== "image") || !images.every(isProductVideoFrame)) throw new Error("请选择已同步的图片。");
        const ids = new Set(value.map((image) => image.resourceId));
        const additions = images.filter(({ resourceId }) => {
            if (ids.has(resourceId)) return false;
            ids.add(resourceId);
            return true;
        });
        if (!additions.length) throw new Error("所选图片已经添加，请选择其他图片。");
        if (additions.length > remaining) throw new Error(`还可添加 ${remaining} 张商品参考图。`);
        const available = await Promise.all(additions.map(({ resourceId }) => canReadImage(resourceId)));
        assertCurrentUserSession(session);
        if (!mounted.current) return;
        if (available.includes(false)) throw new Error("所选图片中有素材尚未就绪或无法访问，请重新选择。");
        update([...value, ...additions]);
    }

    return (
        <section className="ec-product-images" aria-labelledby={title} aria-busy={uploading}>
            <header>
                <h2 id={title}>
                    商品参考图{" "}
                    <small>
                        {value.length} / {maxImages}
                    </small>
                </h2>
                <Button size="small" type="text" icon={<FolderOpen size={15} aria-hidden />} aria-label="从素材库选择商品参考图" disabled={locked || remaining <= 0} onClick={() => setPicker(true)}>
                    素材库
                </Button>
            </header>
            <input
                ref={input}
                type="file"
                multiple
                accept={COMMERCE_IMAGE_ACCEPT}
                aria-label="选择商品参考图文件"
                hidden
                disabled={locked || remaining <= 0}
                onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    event.target.value = "";
                    void upload(files);
                }}
            />
            <ol className="ec-product-image-list" aria-label="已选商品参考图" data-empty={!value.length}>
                {value.map((image, index) => {
                    const name = image.name || `商品图 ${index + 1}`;
                    return (
                        <li key={image.resourceId} className="ec-product-image-item">
                            <button
                                type="button"
                                className="ec-product-image-preview"
                                aria-label={`放大查看${name}`}
                                aria-haspopup="dialog"
                                onClick={(event) => {
                                    previewTrigger.current = event.currentTarget;
                                    setPreview(image);
                                }}
                            >
                                <CachedResourceImage storageKey={resourceStorageKey(image.resourceId)} variant="thumbnail" alt={name} fallback={<span>图片暂不可用</span>} loadingFallback={null} />
                                <span aria-hidden className="ec-product-image-number">
                                    {index + 1}
                                </span>
                            </button>
                            <div className="ec-product-image-tools">
                                {value.length > 1 && (
                                    <>
                                        <button type="button" disabled={locked || index === 0} aria-label={`向前移动${name}`} title="向前移动" onClick={() => move(index, -1)}>
                                            <ArrowLeft size={13} aria-hidden />
                                        </button>
                                        <button type="button" disabled={locked || index === value.length - 1} aria-label={`向后移动${name}`} title="向后移动" onClick={() => move(index, 1)}>
                                            <ArrowRight size={13} aria-hidden />
                                        </button>
                                    </>
                                )}
                                <button type="button" disabled={locked} aria-label={`移除${name}`} title="移除" onClick={() => update(value.filter((item) => item.resourceId !== image.resourceId))}>
                                    <X size={14} aria-hidden />
                                </button>
                            </div>
                        </li>
                    );
                })}
                {remaining > 0 && (
                    <li role="presentation" className="ec-product-image-add">
                        <button type="button" aria-label="上传商品参考图" disabled={locked} onClick={() => input.current?.click()}>
                            <ImagePlus size={22} aria-hidden />
                            <strong>{uploading ? "正在上传…" : value.length ? "添加图片" : "上传商品图"}</strong>
                            {!value.length && <small>1–3 张，可选不同角度或细节</small>}
                        </button>
                    </li>
                )}
            </ol>
            {projectImages.length > 0 && (
                <details className="ec-product-image-project">
                    <summary>从项目图片选择</summary>
                    <div role="group" aria-label="选择项目商品参考图">
                        {projectImages.map((image) => {
                            const selected = value.some((item) => item.resourceId === image.resourceId);
                            return (
                                <button
                                    key={image.resourceId}
                                    type="button"
                                    aria-label={image.name || "项目商品图"}
                                    aria-pressed={selected}
                                    disabled={locked || (!selected && remaining <= 0)}
                                    onClick={() => update(selected ? value.filter((item) => item.resourceId !== image.resourceId) : [...value, image])}
                                >
                                    <CachedResourceImage variant="thumbnail" alt="" storageKey={resourceStorageKey(image.resourceId)} loadingFallback={null} />
                                    {selected && <Check size={14} aria-hidden />}
                                </button>
                            );
                        })}
                    </div>
                </details>
            )}
            {error && <small role="alert">{error}</small>}
            <WorkbenchAssetPicker open={picker} accept={imageOnly} maxCount={Math.max(1, remaining)} slotName="商品参考图" syncedOnly onPick={pick} onClose={() => setPicker(false)} />
            <AppModal
                open={Boolean(preview)}
                centered
                width="min(900px, calc(100vw - 24px))"
                footer={null}
                title={preview?.name || "商品参考图"}
                onCancel={() => setPreview(undefined)}
                afterClose={() => previewTrigger.current?.focus({ preventScroll: true })}
            >
                {preview && (
                    <div className="ec-frame-lightbox">
                        <CachedResourceImage eager variant="original" storageKey={resourceStorageKey(preview.resourceId)} alt={preview.name} fallback={<small>原图暂不可预览</small>} loadingFallback={null} />
                    </div>
                )}
            </AppModal>
        </section>
    );
}
