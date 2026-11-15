import { useCallback, useEffect, useRef, useState } from "react";

import { MediaPlaceholder } from "@/components/ui/product/media-placeholder";
import type { InspirationPreview } from "@/lib/inspirations/examples";

/** A preview never starts a generation task. Touch devices always open the detail player. */
export function InspirationExampleMedia({ example, preview = false, controls = false, showSourceLink = false }: { example: InspirationPreview; preview?: boolean; controls?: boolean; showSourceLink?: boolean }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [failed, setFailed] = useState(false);
    const [requested, setRequested] = useState(controls);
    const [playbackError, setPlaybackError] = useState<string | null>(null);
    const playPreview = useCallback(() => {
        const video = videoRef.current;
        // The parent records mouse input and the visible switch. Hybrid devices
        // can report a coarse primary pointer even while a real mouse is in use.
        if (!video || controls || failed || !preview || !window.matchMedia("(min-width: 721px)").matches) return;
        video.muted = true;
        video.defaultMuted = true;
        setPlaybackError(null);
        void video.play().catch((error: unknown) => {
            const name = error instanceof Error ? error.name : "PlaybackError";
            if (name === "AbortError") return;
            setPlaybackError(["NotAllowedError", "NotSupportedError"].includes(name) ? name : "PlaybackError");
        });
    }, [controls, failed, preview]);
    useEffect(() => {
        if (requested || example.type !== "video") return;
        const video = videoRef.current;
        if (!video) return;
        if (typeof IntersectionObserver === "undefined") {
            setRequested(true);
            return;
        }
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry?.isIntersecting) {
                    setRequested(true);
                    observer.disconnect();
                }
            },
            { rootMargin: "200px" },
        );
        observer.observe(video);
        return () => observer.disconnect();
    }, [requested, example.type]);
    useEffect(() => {
        if (controls || failed) return;
        const shouldPlay = preview && window.matchMedia("(min-width: 721px)").matches;
        if (shouldPlay && !requested) {
            setRequested(true);
            return;
        }
        const video = videoRef.current;
        if (!video) return;
        if (shouldPlay) {
            playPreview();
        } else {
            video.pause();
        }
        return () => video.pause();
    }, [preview, controls, requested, failed, example.mediaUrl, playPreview]);
    if (failed || !example.mediaUrl)
        return (
            <>
                {controls ? (
                    <p className="inspiration-example-error">
                        此示例暂时无法加载。
                        {showSourceLink && example.sourceUrl ? (
                            <a href={example.sourceUrl} target="_blank" rel="noreferrer">
                                查看原作品
                            </a>
                        ) : null}
                    </p>
                ) : null}
                {example.posterUrl ? <img src={example.posterUrl} alt="作品封面" loading="lazy" /> : <MediaPlaceholder failed />}
            </>
        );
    if (example.type === "image") return <img src={example.mediaUrl} alt={example.title || "作品示例"} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
    return (
        <video
            ref={videoRef}
            src={requested ? example.mediaUrl : undefined}
            controls={controls}
            muted={!controls}
            playsInline
            loop={!controls}
            preload={requested ? "metadata" : "none"}
            aria-label={example.title || "视频作品示例"}
            data-preview-error={playbackError || undefined}
            onCanPlay={playPreview}
            onError={() => setFailed(true)}
        />
    );
}
