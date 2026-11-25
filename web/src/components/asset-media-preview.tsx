import { useEffect, useRef, useState, type ReactNode } from "react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import type { Asset } from "@/stores/use-asset-store";

type AssetMediaPreviewProps = {
    asset?: Asset | null;
    alt: string;
    className?: string;
    fallback?: ReactNode;
    /** 解析授权地址期间显示的内容，缺省与 fallback 相同。 */
    loadingFallback?: ReactNode;
    /** 图片或视频首帧可以显示时调用，供卡片结束加载骨架。 */
    onLoad?: () => void;
    onError?: () => void;
};

export function AssetMediaPreview({ asset, alt, className = "", fallback = null, loadingFallback = fallback, onLoad, onError }: AssetMediaPreviewProps) {
    if (!asset) return fallback;

    if (asset.kind === "video" && asset.data.url) {
        return <AssetVideoPreview key={`${asset.id}:${asset.data.url}:${asset.coverUrl}`} asset={asset} alt={alt} className={className} onLoad={onLoad} onError={onError} />;
    }

    const storageKey = asset.kind === "image" ? asset.data.storageKey : undefined;
    const imageUrl = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    if (!imageUrl && !storageKey) return fallback;
    return <CachedResourceImage storageKey={storageKey} src={imageUrl} variant="thumbnail" alt={alt} loading="lazy" decoding="async" className={className} fallback={fallback} loadingFallback={loadingFallback} onLoad={onLoad} onError={onError} />;
}

function AssetVideoPreview({ asset, alt, className, onLoad, onError }: AssetMediaPreviewProps & { asset: Extract<Asset, { kind: "video" }> }) {
    const poster = asset.coverUrl && asset.coverUrl !== asset.data.url ? asset.coverUrl : undefined;
    const [posterFailed, setPosterFailed] = useState(false);
    const [requested, setRequested] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        if (typeof IntersectionObserver === "undefined") {
            setRequested(true);
            return;
        }
        let active = true;
        const observer = new IntersectionObserver(
            (entries) => {
                if (active && entries.some((entry) => entry.isIntersecting)) {
                    setRequested(true);
                    observer.disconnect();
                }
            },
            { rootMargin: "240px" },
        );
        observer.observe(video);
        return () => {
            active = false;
            observer.disconnect();
        };
    }, [posterFailed]);

    // 列表只需静态预览；有封面时不再为每张卡片请求视频元数据。
    if (poster && !posterFailed) return <img src={poster} alt={alt} loading="lazy" decoding="async" className={className} onLoad={onLoad} onError={() => setPosterFailed(true)} />;
    return (
        <video
            ref={videoRef}
            src={requested ? asset.data.url : undefined}
            width={asset.data.width || 320}
            height={asset.data.height || 180}
            aria-label={alt}
            muted
            playsInline
            preload={requested ? "metadata" : "none"}
            className={className}
            onLoadedMetadata={(event) => {
                if (!requested) return;
                // 无封面时仍解码首帧，仅将请求推迟到卡片接近视口后。
                const video = event.currentTarget;
                if (video.currentTime === 0 && video.duration > 0) video.currentTime = Math.min(0.001, video.duration);
            }}
            onLoadedData={() => {
                if (requested) onLoad?.();
            }}
            onError={() => {
                if (requested) onError?.();
            }}
        />
    );
}
