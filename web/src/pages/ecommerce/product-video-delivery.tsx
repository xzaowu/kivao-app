import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { Download, Workflow } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AppModal } from "@/components/ui/product/app-modal";
import { parseAssetRecord } from "@/lib/asset-record";
import { assertCurrentUserSession, captureUserSession, getActiveUserScope } from "@/lib/user-scope";
import { workbenchDownloadName, type WorkbenchOutput } from "@/pages/workbench/workbench-batches";
import { refreshResource, resourceIdFromStorageKey, resourceStorageKey } from "@/services/api/resources";
import { getCanvasSyncStatus, getRemoteAsset, listRemoteCanvasProjectsPage } from "@/services/api/user-data";
import { resolveBrowserMediaDownloadHref, startBrowserDownload } from "@/services/browser-download";
import { materializeEffectKey } from "@/services/generation-task-materializer";
import { generationAssetId } from "@/stores/use-asset-store";

type DeliveredVideo = WorkbenchOutput & { resourceId: string };

export function ProductVideoDelivery({ output, title }: { output: DeliveredVideo; title: string }) {
    const [canvas, setCanvas] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [failed, setFailed] = useState(false);
    const active = useRef(true);
    useEffect(() => {
        active.current = true;
        return () => {
            active.current = false;
        };
    }, []);

    async function download() {
        if (downloading) return;
        setDownloading(true);
        setFailed(false);
        try {
            const session = captureUserSession();
            const fileName = workbenchDownloadName(output, title, output.index + 1);
            const href = await resolveBrowserMediaDownloadHref({ storageKey: resourceStorageKey(output.resourceId), fileName });
            assertCurrentUserSession(session);
            if (active.current) startBrowserDownload(href, fileName);
        } catch {
            if (active.current) setFailed(true);
        } finally {
            if (active.current) setDownloading(false);
        }
    }
    return (
        <div className="ec-video-work-actions ec-video-delivery">
            <Button size="small" loading={downloading} icon={<Download size={15} aria-hidden />} onClick={() => void download()}>
                下载原片
            </Button>
            <Button size="small" aria-haspopup="dialog" icon={<Workflow size={15} aria-hidden />} onClick={() => setCanvas(true)}>
                送到画布
            </Button>
            {failed && <span role="alert">原片暂时无法下载，请重试。</span>}
            {canvas && <CanvasDestination output={output} onClose={() => setCanvas(false)} />}
        </div>
    );
}

export async function verifyVideoForCanvas(output: DeliveredVideo, canvasId: string, signal: AbortSignal) {
    const session = captureUserSession();
    if (session.scope === "guest" || !canvasId.trim()) throw new Error("请登录后选择已有画布。");
    const effectKey = materializeEffectKey(output.taskId, output.index);
    const assetId = await generationAssetId(effectKey);
    signal.throwIfAborted();
    assertCurrentUserSession(session);
    const [entry, resource] = await Promise.all([getRemoteAsset(assetId), refreshResource(output.resourceId), getCanvasSyncStatus(canvasId, signal)]);
    signal.throwIfAborted();
    assertCurrentUserSession(session);
    const asset = parseAssetRecord(entry.asset);
    if (
        asset.id !== assetId ||
        asset.kind !== "video" ||
        asset.status === "archived" ||
        resourceIdFromStorageKey(asset.data.storageKey) !== output.resourceId ||
        resource.id !== output.resourceId ||
        resource.userId !== session.scope ||
        resource.kind !== "video" ||
        resource.status !== "ready"
    )
        throw new Error("素材库中的成片已失效或已归档。");
    return `/canvas/${encodeURIComponent(canvasId)}?${new URLSearchParams({ mode: "handoff", asset: assetId })}`;
}

function CanvasDestination({ output, onClose }: { output: DeliveredVideo; onClose: () => void }) {
    const navigate = useNavigate();
    const [scope] = useState(getActiveUserScope);
    const [selected, setSelected] = useState("");
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");
    const controller = useRef<AbortController | null>(null);
    useEffect(() => () => controller.current?.abort(), []);
    const library = useInfiniteQuery({
        queryKey: ["ecommerce-video-canvas-destinations", scope],
        enabled: scope !== "guest",
        initialPageParam: 1,
        queryFn: ({ pageParam, signal }) => listRemoteCanvasProjectsPage({ page: pageParam, pageSize: 40, sort: "updated", signal }),
        getNextPageParam: (page) => (page.hasMore ? page.page + 1 : undefined),
        retry: false,
    });
    const canvases = library.data?.pages.flatMap((page) => page.projects) || [];
    const chosen = canvases.find((item) => item.id === selected);
    async function send() {
        if (controller.current || !chosen) return;
        const request = new AbortController();
        controller.current = request;
        setSending(true);
        setError("");
        try {
            if (scope !== captureUserSession().scope) throw new Error("账号已切换。");
            const path = await verifyVideoForCanvas(output, chosen.id, request.signal);
            if (!request.signal.aborted) navigate(path);
        } catch {
            if (!request.signal.aborted) setError("暂时无法转入。请确认原片仍在素材库中，且目标画布可用后重试。");
        } finally {
            if (!request.signal.aborted) setSending(false);
            controller.current = null;
        }
    }
    return (
        <AppModal title="送到已有画布" open onCancel={close} footer={null} width={430}>
            <div className="ec-video-destination">
                {library.isLoading ? (
                    <p role="status">正在读取画布…</p>
                ) : library.isError ? (
                    <p role="alert">
                        画布读取失败。{" "}
                        <Button size="small" onClick={() => void library.refetch()}>
                            重新读取
                        </Button>
                    </p>
                ) : !canvases.length ? (
                    <p role="status">还没有可选的画布。可以先下载原片。</p>
                ) : (
                    <label>
                        目标画布
                        <select
                            value={selected}
                            disabled={sending}
                            onChange={(event) => {
                                setSelected(event.target.value);
                                setError("");
                            }}
                        >
                            <option value="">选择一个已有画布</option>
                            {canvases.map((canvas) => (
                                <option key={canvas.id} value={canvas.id}>
                                    {canvas.title || "未命名画布"}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
                {library.hasNextPage && (
                    <Button size="small" loading={library.isFetchingNextPage} disabled={sending} onClick={() => void library.fetchNextPage()}>
                        更多画布
                    </Button>
                )}
                {error && <p role="alert">{error}</p>}
                <div className="ec-video-work-actions">
                    <Button onClick={close}>取消</Button>
                    <Button type="primary" loading={sending} disabled={!chosen || library.isError} onClick={() => void send()}>
                        打开画布并添加成片
                    </Button>
                </div>
            </div>
        </AppModal>
    );
    function close() {
        controller.current?.abort();
        onClose();
    }
}
