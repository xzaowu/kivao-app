import { afterEach, expect, spyOn, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getActiveUserScope, setActiveUserScope } from "@/lib/user-scope";
import { comparableProductVideos } from "@/pages/ecommerce/product-video-comparison";
import { ProductVideoWorkCard } from "@/pages/ecommerce/product-video-works";
import { productShotArtwork } from "@/pages/ecommerce/product-video-shot-preview";
import { verifyVideoForCanvas } from "@/pages/ecommerce/product-video-delivery";
import * as resources from "@/services/api/resources";
import * as library from "@/services/api/user-data";
import type { GenerationTask, ProductVideoVersion } from "@/services/api/task-center";
import { generationAssetId, type VideoAsset } from "@/stores/use-asset-store";

const scope = "review-owner";
const projectId = "product-project";
const oldScope = getActiveUserScope();
afterEach(() => setActiveUserScope(oldScope));
const version: ProductVideoVersion = {
    schema: 1,
    frame: { resourceId: "first-frame", name: "商品照" },
    model: "test::video",
    facts: "",
    purpose: "demo",
    shots: ["开场", "细节", "收尾"],
    voice: "",
    productName: "示例",
    audience: "",
    language: "zh-CN",
    settings: { seconds: 15, ratio: "9:16", resolution: "720p", generateAudio: false },
};
const task: GenerationTask = {
    id: "sample",
    projectId,
    type: "canvas_video",
    status: "succeeded",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "",
    attempts: 1,
    progress: 100,
    prompt: "",
    previewKind: "video",
    previewUrl: "/api/resources/output-video/file",
    clientContext: { ecommerceVideoVersion: version },
};

test("商品图只定义商品外观，明确的分镜配图可复用任意商品图", () => {
    const a = productShotArtwork(0, "reveal", undefined, version.frame, "商品参考图", true);
    expect(a.hasImage).toBe(false);
    expect(a.label).toBe("按脚本构图");
    expect(productShotArtwork(0, "reveal", version.frame, version.frame, "商品参考图", true)).toMatchObject({ hasImage: true, label: "分镜参考" });
    expect(productShotArtwork(0, "reveal", undefined, version.frame)).toMatchObject({ hasImage: true, label: "商品首帧" });
});

test("作品原稿保留每张商品参考图的名称和顺序，历史首帧稿保持原标签", () => {
    const render = (snapshot: ProductVideoVersion) =>
        renderToStaticMarkup(createElement(ProductVideoWorkCard, { task: { ...task, status: "failed", previewUrl: undefined, clientContext: { ecommerceVideoVersion: snapshot } }, projectId, disabled: false, onDerive: () => {} }));
    const productImages = [version.frame, { resourceId: "label", name: "瓶身背标" }, { resourceId: "handle", name: "手柄细节" }];
    const output = render({ ...version, productImages });
    expect(output).toContain("商品参考图 · 3 张");
    for (const [index, image] of productImages.entries()) expect(output).toContain(`${index + 1}. ${image.name}`);
    expect(output).not.toContain("提交时的首帧");
    expect(render(version)).toContain("提交时的首帧");
});

test("只有当前项目带有效脚本和成片的已完成视频进入对比", () => {
    const tasks: GenerationTask[] = [
        task,
        { ...task, id: "second" },
        { ...task, id: "foreign", projectId: "other-project" },
        { ...task, id: "running", status: "running" },
        { ...task, id: "old", clientContext: undefined },
        { ...task, id: "incomplete", previewUrl: undefined },
        { ...task, id: "photo", previewKind: "image" },
        { ...task, id: "bad", type: "canvas_image" },
    ];
    expect(comparableProductVideos(tasks, projectId).map(({ id }) => id)).toEqual(["sample", "second"]);
    expect(comparableProductVideos(tasks, "")).toEqual([]);
    expect(comparableProductVideos([task, { ...task, id: "newest", createdAt: "2026-01-01T00:00:00Z" }], projectId).map(({ id }) => id)).toEqual(["newest", "sample"]);
});

test("送画布复用授权素材与目标画布，拒绝错误资源、归档、账号切换和关闭后迟到的请求", async () => {
    setActiveUserScope(scope);
    const assetId = await generationAssetId("materialize:sample:0");
    const asset: VideoAsset = { id: assetId, title: "示例", kind: "video", createdAt: "", updatedAt: "", tags: [], coverUrl: "", data: { storageKey: "resource:output-video", url: "", width: 0, height: 0, bytes: 12, mimeType: "video/mp4" } };
    const resource: resources.RemoteResource = {
        id: "output-video",
        userId: scope,
        status: "ready",
        kind: "video",
        createdAt: "",
        updatedAt: "",
        size: 12,
        provider: "local",
        endpoint: "",
        bucket: "",
        objectKey: "output-video",
        publicUrl: "",
        mimeType: "video/mp4",
    };
    const getAsset = spyOn(library, "getRemoteAsset").mockResolvedValue({ asset });
    const getResource = spyOn(resources, "refreshResource").mockResolvedValue(resource);
    const status = spyOn(library, "getCanvasSyncStatus").mockResolvedValue({ revision: 2, serverTime: "", leases: [] });
    const output = { ...comparableProductVideos([task], projectId)[0].output, resourceId: resource.id };
    const send = () => verifyVideoForCanvas(output, "selected-canvas", new AbortController().signal);
    try {
        expect(await send()).toBe(`/canvas/selected-canvas?mode=handoff&asset=${assetId}`);
        expect(getAsset).toHaveBeenCalledWith(assetId);
        expect(status.mock.calls[0][0]).toBe("selected-canvas");
        getAsset.mockResolvedValueOnce({ asset: { ...asset, status: "archived" } });
        await expect(send()).rejects.toThrow();
        getAsset.mockResolvedValueOnce({ asset: { ...asset, data: { ...asset.data, width: undefined } } });
        await expect(send()).rejects.toThrow();
        getAsset.mockResolvedValueOnce({ asset: { ...asset, data: { ...asset.data, storageKey: "resource:old-video" } } });
        await expect(send()).rejects.toThrow();
        getResource.mockResolvedValueOnce({ ...resource, userId: "other" });
        await expect(send()).rejects.toThrow();
        getResource.mockResolvedValueOnce({ ...resource, status: "deleted" });
        await expect(send()).rejects.toThrow();
        status.mockRejectedValueOnce(new Error("404"));
        await expect(send()).rejects.toThrow();
        getAsset.mockImplementationOnce(async () => {
            setActiveUserScope("other");
            return { asset };
        });
        await expect(send()).rejects.toThrow();
        setActiveUserScope(scope);
        const stopped = new AbortController();
        getAsset.mockImplementationOnce(async () => {
            stopped.abort();
            return { asset };
        });
        await expect(verifyVideoForCanvas(output, "selected-canvas", stopped.signal)).rejects.toThrow();
    } finally {
        getResource.mockRestore();
        getAsset.mockRestore();
        status.mockRestore();
    }
});
