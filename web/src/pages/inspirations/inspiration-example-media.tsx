import { useCallback, useEffect, useRef, useState } from "react";

import { MediaPlaceholder } from "@/components/ui/product/media-placeholder";
import type { InspirationPreview } from "@/lib/inspirations/examples";

export function InspirationImage(props: { src: string; fallbackSrc?: string; priority?: boolean; alt?: string }) {
    return <CoverImage key={`${props.src}:${props.fallbackSrc}`} {...props} />;
}

function CoverImage({ src, fallbackSrc, priority = false, alt = "作品封面" }: { src: string; fallbackSrc?: string; priority?: boolean; alt?: string }) {
    const [fallback, setFallback] = useState(false);
    const [failed, setFailed] = useState(false);
    if (failed) return <MediaPlaceholder failed />;
    return (
        <img
            src={fallback ? fallbackSrc : src}
            alt={alt}
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => {
                if (!fallback && fallbackSrc && fallbackSrc !== src) setFallback(true);
                else setFailed(true);
            }}
        />
    );
}

/** List videos download only after desktop hover; touch devices open the detail player. */
export function InspirationExampleMedia({
    example,
    preview = false,
    controls = false,
    showSourceLink = false,
    coverURL,
    priority = false,
}: {
    example: InspirationPreview;
    preview?: boolean;
    controls?: boolean;
    showSourceLink?: boolean;
    coverURL?: string;
    priority?: boolean;
}) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [failed, setFailed] = useState(false);
    const [requested, setRequested] = useState(controls);
    const [playing, setPlaying] = useState(false);
    const [videoRatio, setVideoRatio] = useState("16 / 9");
    const [playbackError, setPlaybackError] = useState<string | null>(null);
    const retrying = useRef(false);
    const playPreview = useCallback(() => {
        const video = videoRef.current;
        if (!video || controls || failed || !preview || !window.matchMedia("(min-width: 721px)").matches || document.visibilityState === "hidden") return;
        video.muted = true;
        video.defaultMuted = true;
        setPlaybackError(null);
        void video.play().catch((error: unknown) => {
            const name = error instanceof Error ? error.name : "PlaybackError";
            if (name === "AbortError") return;
            setPlaying(false);
            setPlaybackError(["NotAllowedError", "NotSupportedError"].includes(name) ? name : "PlaybackError");
        });
    }, [controls, failed, preview]);
    useEffect(() => {
        if (controls) return;
        const shouldPlay = preview && window.matchMedia("(min-width: 721px)").matches;
        if (shouldPlay && failed && !retrying.current) {
            retrying.current = true;
            setFailed(false);
            videoRef.current?.load();
            return;
        }
        if (shouldPlay && !requested) {
            setRequested(true);
            return;
        }
        const video = videoRef.current;
        if (!video) return;
        if (shouldPlay && !failed) playPreview();
        else {
            video.pause();
            setPlaying(false);
            if (!shouldPlay) retrying.current = false;
        }
        return () => video.pause();
    }, [preview, controls, requested, failed, example.mediaUrl, playPreview]);
    useEffect(() => {
        if (controls) return;
        const media = window.matchMedia("(min-width: 721px)");
        const pauseWhenUnavailable = () => {
            if (!media.matches || document.visibilityState === "hidden") {
                videoRef.current?.pause();
                setPlaying(false);
                if (!media.matches) setRequested(false);
            }
        };
        media.addEventListener("change", pauseWhenUnavailable);
        document.addEventListener("visibilitychange", pauseWhenUnavailable);
        return () => {
            media.removeEventListener("change", pauseWhenUnavailable);
            document.removeEventListener("visibilitychange", pauseWhenUnavailable);
        };
    }, [controls]);
    if (example.type === "image") return example.mediaUrl ? <InspirationImage src={coverURL || example.mediaUrl} fallbackSrc={example.mediaUrl} priority={priority} alt={example.title || "作品示例"} /> : <MediaPlaceholder failed />;
    const poster = coverURL || example.posterUrl;
    if (!example.mediaUrl) return poster ? <InspirationImage src={poster} fallbackSrc={example.posterUrl} priority={priority} /> : <MediaPlaceholder failed />;
    const video = (
        <video
            ref={videoRef}
            src={requested ? example.mediaUrl : undefined}
            poster={controls ? example.posterUrl : undefined}
            controls={controls}
            muted={!controls}
            playsInline
            loop={!controls}
            preload={controls ? "metadata" : "none"}
            aria-label={example.title || "视频作品示例"}
            data-preview-error={playbackError || undefined}
            onCanPlay={playPreview}
            onPlaying={() => {
                if (!controls && (!preview || !window.matchMedia("(min-width: 721px)").matches || document.visibilityState === "hidden")) videoRef.current?.pause();
                else setPlaying(true);
            }}
            onWaiting={() => setPlaying(false)}
            onPause={() => setPlaying(false)}
            onLoadedMetadata={(event) => {
                const target = event.currentTarget;
                if (target.videoWidth && target.videoHeight) setVideoRatio(`${target.videoWidth} / ${target.videoHeight}`);
            }}
            onError={() => {
                setFailed(true);
                setPlaying(false);
            }}
        />
    );
    if (!controls)
        return (
            <span className={`inspiration-video-preview${playing ? " is-playing" : ""}`} style={poster ? undefined : { aspectRatio: videoRatio }}>
                <span className="inspiration-video-poster">{poster ? <InspirationImage src={poster} fallbackSrc={example.posterUrl} priority={priority} /> : <MediaPlaceholder failed={failed} />}</span>
                {video}
            </span>
        );
    return (
        <>
            {failed ? (
                <p className="inspiration-example-error" role="alert">
                    此示例暂时无法加载。
                    <button
                        type="button"
                        onClick={() => {
                            setFailed(false);
                            videoRef.current?.load();
                        }}
                    >
                        重新加载
                    </button>
                    {showSourceLink && example.sourceUrl ? (
                        <a href={example.sourceUrl} target="_blank" rel="noreferrer">
                            查看原作品
                        </a>
                    ) : null}
                </p>
            ) : null}
            {video}
        </>
    );
}
