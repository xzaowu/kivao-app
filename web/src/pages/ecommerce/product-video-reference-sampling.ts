import { normalizeVideoFrameTimes } from "@/lib/canvas/canvas-video-frame";
import { getResourceAccess, resolveResourceAccessURL, resourceStorageKey } from "@/services/api/resources";

export type ReferenceSample = { timeMs: number; change: number; thumbnail: string };
export type ReferenceClip = { startMs: number; endMs: number; sample: ReferenceSample };
export type ReferenceBreakdown = { clips: ReferenceClip[]; byChange: boolean };
export class ReferenceReadError extends Error {}

export function referenceSampleTimes(durationMs: number) {
    const count = Math.min(25, Math.max(3, Math.ceil(durationMs / 500)));
    return normalizeVideoFrameTimes(
        Array.from({ length: count }, (_, index) => ((index + 0.5) * durationMs) / count),
        durationMs,
    );
}

export function groupReferenceSamples(samples: ReferenceSample[], durationMs: number): ReferenceBreakdown {
    if (!samples.length) throw new ReferenceReadError("参考片没有可读取的画面。");
    // Adjacent low-resolution frames can reveal large visual changes, but cannot identify camera moves or subjects.
    const candidates = samples.slice(1).map((sample, index) => ({ time: Math.round((samples[index].timeMs + sample.timeMs) / 2), score: sample.change }));
    const cuts: number[] = [];
    const spacing = Math.max(400, durationMs / 18);
    for (const { time, score } of candidates.sort((a, b) => b.score - a.score)) {
        if (score < 0.2 || cuts.length === 5) break;
        if (time >= spacing && durationMs - time >= spacing && cuts.every((cut) => Math.abs(cut - time) >= spacing)) cuts.push(time);
    }
    const byChange = cuts.length > 0;
    const fallbackCount = Math.min(3, samples.length);
    const breaks = byChange ? cuts.sort((a, b) => a - b) : Array.from({ length: fallbackCount - 1 }, (_, i) => Math.round((durationMs * (i + 1)) / fallbackCount));
    const edges = [0, ...breaks, durationMs];
    const clips = edges.slice(1).map((endMs, i) => {
        const startMs = edges[i];
        const middle = (startMs + endMs) / 2;
        const inside = samples.filter((s) => s.timeMs >= startMs && s.timeMs < endMs);
        const sample = (inside.length ? inside : samples).reduce((best, s) => (Math.abs(s.timeMs - middle) < Math.abs(best.timeMs - middle) ? s : best));
        return { startMs, endMs, sample };
    });
    return { clips, byChange };
}

export function referenceTime(ms: number) {
    const tenths = Math.round(ms / 100);
    return `${Math.floor(tenths / 600)}:${String(Math.floor((tenths % 600) / 10)).padStart(2, "0")}.${tenths % 10}`;
}

function mediaEvent(video: HTMLVideoElement, event: "loadedmetadata" | "seeked", signal: AbortSignal, start: () => void) {
    return new Promise<void>((resolve, reject) => {
        signal.throwIfAborted();
        const cleanup = () => {
            video.removeEventListener(event, done);
            video.removeEventListener("error", fail);
            signal.removeEventListener("abort", abort);
            clearTimeout(timeout);
        };
        const done = () => {
            cleanup();
            resolve();
        };
        const fail = () => {
            cleanup();
            reject(new ReferenceReadError("参考片读取超时或浏览器无法解码。可以重试，或继续手写分镜。"));
        };
        const abort = () => {
            cleanup();
            reject(signal.reason);
        };
        const timeout = window.setTimeout(fail, 12_000);
        video.addEventListener(event, done);
        video.addEventListener("error", fail);
        signal.addEventListener("abort", abort, { once: true });
        try {
            start();
        } catch {
            fail();
        }
    });
}

export async function readReferenceClips(resourceId: string, durationMs: number, signal: AbortSignal, progress: (percent: number) => void): Promise<ReferenceBreakdown> {
    const access = await getResourceAccess(resourceStorageKey(resourceId), "browser-process", "playback");
    signal.throwIfAborted();
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.crossOrigin = access.delivery === "platform-local" || access.delivery === "platform-proxy" ? "use-credentials" : "anonymous";
    try {
        await mediaEvent(video, "loadedmetadata", signal, () => {
            video.src = resolveResourceAccessURL(access.url);
            video.load();
        });
        const actualMs = Math.round(video.duration * 1000);
        if (!Number.isFinite(actualMs) || actualMs <= 0 || !video.videoWidth || !video.videoHeight) throw new ReferenceReadError("参考片缺少可读取的画面或时长。");
        if (Math.abs(actualMs - durationMs) > Math.max(500, durationMs * 0.01)) throw new ReferenceReadError("播放副本与参考片时长不一致，请重新选择视频。");
        const canvas = document.createElement("canvas");
        const scale = Math.min(220 / video.videoWidth, 150 / video.videoHeight, 1);
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const picture = canvas.getContext("2d");
        const grid = document.createElement("canvas");
        grid.width = 16;
        grid.height = 9;
        const pixels = grid.getContext("2d", { willReadFrequently: true });
        if (!picture || !pixels) throw new ReferenceReadError("此浏览器无法读取视频画面。可直接观看参考片并手写分镜。");
        const samples: ReferenceSample[] = [];
        let previous: Uint8ClampedArray | undefined;
        const times = referenceSampleTimes(actualMs);
        for (const timeMs of times) {
            await mediaEvent(video, "seeked", signal, () => {
                video.currentTime = timeMs / 1000;
            });
            signal.throwIfAborted();
            if (Math.abs(video.currentTime * 1000 - timeMs) > 150) throw new ReferenceReadError("播放副本无法定位到所选时间。请重新上传可定位的视频，或继续手写分镜。");
            picture.drawImage(video, 0, 0, canvas.width, canvas.height);
            pixels.drawImage(canvas, 0, 0, grid.width, grid.height);
            const current = pixels.getImageData(0, 0, grid.width, grid.height).data;
            let difference = 0;
            if (previous)
                for (let i = 0; i < current.length; i += 4) {
                    difference += Math.abs(current[i] - previous[i]) + Math.abs(current[i + 1] - previous[i + 1]) + Math.abs(current[i + 2] - previous[i + 2]);
                }
            previous = current;
            samples.push({ timeMs, change: difference / (grid.width * grid.height * 3 * 255), thumbnail: canvas.toDataURL("image/jpeg", 0.72) });
            progress(Math.round((100 * samples.length) / times.length));
        }
        return groupReferenceSamples(samples, actualMs);
    } finally {
        video.pause();
        video.removeAttribute("src");
        video.load();
    }
}
