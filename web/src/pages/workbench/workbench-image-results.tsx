import { MediaPreview } from "@/components/media-preview";
import { useEffect, useState } from "react";
import { queryGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { useUserStore } from "@/stores/use-user-store";

export function workbenchImageResults(task: GenerationTask) {
    try {
        const result = task.resultJson ? JSON.parse(task.resultJson) : null;
        const images: unknown[] = Array.isArray(result?.images) ? result.images : [];
        const urls = images
            .map((image) => {
                if (typeof image === "string") return image;
                if (!image || typeof image !== "object") return "";
                const item = image as { url?: unknown; dataUrl?: unknown };
                return typeof item.url === "string" && item.url ? item.url : typeof item.dataUrl === "string" ? item.dataUrl : "";
            })
            .filter((url) => /^(https?:\/\/|data:image\/|blob:|\/)/i.test(url));
        if (urls.length) return urls.slice(0, 20);
    } catch {
        /* List summaries can omit the full result. */
    }
    return task.previewUrl ? [task.previewUrl] : [];
}

export function WorkbenchImageResults({ task, src }: { task: GenerationTask; src: string }) {
    const userId = useUserStore((state) => state.user?.id);
    const key = JSON.stringify([userId, task.id, task.updatedAt]);
    const [detail, setDetail] = useState<{ key: string; resultJson: string } | null>(null);
    const [loadingKey, setLoadingKey] = useState("");
    const [errorKey, setErrorKey] = useState("");
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        // Task lists intentionally contain only a preview. Read the selected
        // result once per version instead of mistaking that preview for all outputs.
        if (!userId || !task.id || task.status !== "succeeded" || task.resultJson) return;
        const controller = new AbortController();
        const current = () => !controller.signal.aborted && useUserStore.getState().user?.id === userId;
        setLoadingKey(key);
        setErrorKey("");
        void queryGenerationTask(task.id, { signal: controller.signal })
            .then((full) => {
                if (!current()) return;
                if (!full.resultJson) {
                    setErrorKey(key);
                    return;
                }
                setDetail({ key, resultJson: full.resultJson });
            })
            .catch(() => {
                if (current()) setErrorKey(key);
            })
            .finally(() => {
                if (current()) setLoadingKey("");
            });
        return () => controller.abort();
    }, [key, userId, task.id, task.status, task.resultJson, retry]);
    const needsDetail = !task.resultJson;
    const images = workbenchImageResults(needsDetail && detail?.key === key ? { ...task, resultJson: detail.resultJson } : task);
    return (
        <>
            {images.length <= 1 ? (
                <MediaPreview src={images[0] || src} kind="image" alt="生成结果" className="size-full object-contain" fallbackLabel="结果暂不可用" />
            ) : (
                <div className="workbench-result-images" aria-label={`本任务 ${images.length} 张图片`}>
                    {images.map((url, index) => (
                        <MediaPreview key={`${index}:${url}`} src={url} kind="image" alt={`生成结果 ${index + 1}`} className="workbench-result-image" loading="lazy" fallbackLabel="结果暂不可用" />
                    ))}
                </div>
            )}
            {needsDetail && loadingKey === key ? (
                <p className="workbench-result-caption workbench-result-load" role="status">
                    正在加载完整图片…
                </p>
            ) : null}
            {needsDetail && errorKey === key ? (
                <div className="workbench-result-caption workbench-result-load" role="status">
                    <span>完整图片暂时无法读取</span>
                    <button type="button" className="workbench-result-reload" onClick={() => setRetry((value) => value + 1)}>
                        重新加载图片
                    </button>
                </div>
            ) : null}
        </>
    );
}
