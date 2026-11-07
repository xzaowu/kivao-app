import { ImageOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const DEFAULT_UNAVAILABLE_LABEL = "预览不可用，素材可能已删除";

export function MediaPreview({
    src,
    kind,
    alt = "",
    className,
    fallbackClassName,
    fallbackLabel = DEFAULT_UNAVAILABLE_LABEL,
    controls = false,
    loading,
    width,
    height,
    onUnavailable,
    hoverPreview = false,
    preserveVideoAspect = false,
}: {
    src: string;
    kind: "image" | "video";
    alt?: string;
    className?: string;
    fallbackClassName?: string;
    fallbackLabel?: string;
    controls?: boolean;
    loading?: "eager" | "lazy";
    width?: number;
    height?: number;
    onUnavailable?: () => void;
    hoverPreview?: boolean;
    preserveVideoAspect?: boolean;
}) {
    const [failedSrc, setFailedSrc] = useState("");
    const unavailable = failedSrc === src;
    const [videoAspect, setVideoAspect] = useState<{ src: string; ratio: string } | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const hoverPlayback = useRef(false);
    const previousMuted = useRef(false);
    const stopHover = useCallback(() => {
        const video = videoRef.current;
        if (!video || !hoverPlayback.current) return;
        hoverPlayback.current = false;
        video.pause();
        video.muted = previousMuted.current;
    }, []);

    useEffect(() => {
        if (!hoverPreview || kind !== "video" || unavailable) return;
        const policy = window.matchMedia("(any-hover: hover) and (any-pointer: fine)");
        const policyChanged = () => {
            if (!policy.matches) stopHover();
        };
        const visibilityChanged = () => {
            if (document.hidden) stopHover();
        };
        policy.addEventListener("change", policyChanged);
        document.addEventListener("visibilitychange", visibilityChanged);
        return () => {
            stopHover();
            policy.removeEventListener("change", policyChanged);
            document.removeEventListener("visibilitychange", visibilityChanged);
        };
    }, [hoverPreview, kind, src, unavailable, stopHover]);

    const handleUnavailable = () => {
        stopHover();
        setFailedSrc(src);
        onUnavailable?.();
    };

    if (unavailable) {
        return (
            <span className={cn("media-unavailable", fallbackClassName)} role="img" aria-label={fallbackLabel} title={fallbackLabel}>
                <ImageOff aria-hidden="true" />
                <span>{fallbackLabel}</span>
            </span>
        );
    }

    if (kind === "video") {
        return (
            <video
                ref={videoRef}
                src={src}
                width={width}
                height={height}
                muted={!controls}
                playsInline
                controls={controls}
                preload="metadata"
                className={className}
                loop={hoverPreview}
                style={preserveVideoAspect && videoAspect?.src === src ? { aspectRatio: videoAspect.ratio } : undefined}
                onLoadedMetadata={(event) => {
                    const { videoWidth, videoHeight } = event.currentTarget;
                    if (preserveVideoAspect && videoWidth > 0 && videoHeight > 0) setVideoAspect({ src, ratio: `${videoWidth} / ${videoHeight}` });
                }}
                onPointerEnter={(event) => {
                    const video = event.currentTarget;
                    if (!hoverPreview || event.pointerType !== "mouse" || document.hidden || !video.paused || !window.matchMedia("(any-hover: hover) and (any-pointer: fine)").matches) return;
                    previousMuted.current = video.muted;
                    hoverPlayback.current = true;
                    video.muted = true;
                    void video.play().catch(() => {
                        /* Keep native controls available if autoplay is blocked. */
                    });
                }}
                onPointerLeave={stopHover}
                onPointerDown={() => {
                    // Native controls take ownership from the hover preview.
                    if (hoverPlayback.current && videoRef.current) videoRef.current.muted = previousMuted.current;
                    hoverPlayback.current = false;
                }}
                onError={handleUnavailable}
            />
        );
    }

    return <img src={src} alt={alt} width={width} height={height} loading={loading} className={className} onError={handleUnavailable} />;
}
