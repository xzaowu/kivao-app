import { expect, test } from "bun:test";
import { defaultModelCapabilityConfig, VOLCENGINE_MEDIAKIT_VIDEO_DEPTH_PROTOCOL, VOLCENGINE_MEDIAKIT_ENHANCE_VIDEO_PROTOCOL } from "../src/lib/model-capabilities";
import { createModelChannel, defaultConfig, type AiConfig } from "../src/stores/use-config-store";
import { listVideoEnhanceModels, videoEnhanceSourceReference } from "../src/lib/canvas/canvas-video-enhance";
import { VIDEO_DEPTH_CAPTURE_OPERATION, videoDepthMaxSeconds, videoDepthQuoteRequest, videoDepthSourceError, videoDepthTaskInput } from "../src/lib/canvas/canvas-video-depth";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import { resolve } from "node:path";

const depth = defaultModelCapabilityConfig(VOLCENGINE_MEDIAKIT_VIDEO_DEPTH_PROTOCOL, "standard");
const channel = createModelChannel({
    id: "system-depth",
    name: "测试",
    scope: "system",
    models: ["standard", "enhance"],
    modelCosts: [
        { model: "standard", capability: "video", protocol: VOLCENGINE_MEDIAKIT_VIDEO_DEPTH_PROTOCOL, capabilityConfig: depth, billingMode: "per_second", unitPriceMicrocredits: 100 },
        { model: "enhance", capability: "video", protocol: VOLCENGINE_MEDIAKIT_ENHANCE_VIDEO_PROTOCOL, capabilityConfig: defaultModelCapabilityConfig(VOLCENGINE_MEDIAKIT_ENHANCE_VIDEO_PROTOCOL), billingMode: "per_second", unitPriceMicrocredits: 100 },
    ],
});
const config: AiConfig = { ...defaultConfig, channels: [channel] };
const model = "system-depth::standard";
const node: CanvasNodeData = {
    id: "source",
    title: "原片",
    type: CanvasNodeType.Video,
    position: { x: 0, y: 0 },
    width: 360,
    height: 240,
    metadata: { storageKey: "resource:source", content: "/source.mp4", durationMs: 18_625, naturalWidth: 1080, naturalHeight: 1920 },
};

test("节点确认面板与画布 Hook 的报价、草稿、连线及重试边界（模拟上游）", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/video-depth-capture.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
}, 35_000);

test("深度动作捕捉与画质增强模型互相隔离，默认无规格控制", () => {
    expect(listVideoEnhanceModels(config, VIDEO_DEPTH_CAPTURE_OPERATION)).toEqual([model]);
    expect(listVideoEnhanceModels(config)).toEqual(["system-depth::enhance"]);
    expect(depth.video?.resolutions).toEqual([]);
    expect(depth.video?.ratios).toEqual([]);
    expect(videoDepthMaxSeconds(config, model)).toBe(60);
});

test("源视频必须已保存且具有有效尺寸和时长", () => {
    expect(videoDepthSourceError(node, 60)).toBe("");
    for (const metadata of [{ storageKey: "video:local" }, { durationMs: 60_001 }, { durationMs: 0 }, { naturalWidth: 3840, naturalHeight: 2160 }, { naturalWidth: 0 }]) {
        expect(videoDepthSourceError({ ...node, metadata: { ...node.metadata, ...metadata } }, 60)).not.toBe("");
    }
});

test("报价保持独立 operation，请求不携带增强参数或泄露其他参考素材", () => {
    const quote = videoDepthQuoteRequest(config, model, 18_625)!;
    expect(quote.intent.operation).toBe(VIDEO_DEPTH_CAPTURE_OPERATION);
    expect(quote.intent.options).toEqual({ videoSeconds: 19 });
    const input = videoDepthTaskInput({ config, model, source: videoEnhanceSourceReference(node), projectId: "canvas", nodeId: "new-video" });
    expect(input.referenceVideos).toHaveLength(1);
    expect(input.metadata.videoEditOperation).toBe(VIDEO_DEPTH_CAPTURE_OPERATION);
    expect(input.config.vquality).toBe("");
    expect(input.config.size).toBe("");
    expect(input.metadata).not.toHaveProperty("providerOptions");
    expect(node.metadata?.videoDepthCapture).toBeUndefined();
});
