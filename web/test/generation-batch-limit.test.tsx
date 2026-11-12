import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageParameterFields } from "../src/components/image-parameter-fields";
import { buildNodeConfig } from "../src/components/canvas/canvas-node-prompt-config";
import { buildGenerationConfig } from "../src/lib/canvas/canvas-project-generation";
import { defaultImageCapabilityConfig } from "../src/lib/model-capabilities";
import { projectImageParameters } from "../src/lib/image-parameters";
import { defaultConfig, createModelChannel, type AiConfig } from "../src/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import { useUserStore } from "../src/stores/use-user-store";
import { generationBatchCount, currentGenerationBatchLimit, generationBatchQuote } from "../src/lib/generation-batch-limit";
import { modelQuoteDescription, modelQuoteRequest } from "../src/lib/model-pricing";
import { modelRequestOptions, resolveModelGenerationDefaults } from "../src/lib/model-selection";
import { imageParameterRequest } from "../src/lib/image-parameters";
import { executeImageGeneration } from "../src/pages/canvas/canvas-image-generation-executor";
import { createCanvasStateWriter } from "../src/lib/canvas/canvas-editor-state";
import type { CanvasConnection } from "../src/types/canvas";

const originalLimits = useUserStore.getState().runtimeLimits;
afterEach(() => useUserStore.getState().setRuntimeLimits(originalLimits));

function fixture(maxOutputs = 1) {
    const base = defaultImageCapabilityConfig();
    const image = projectImageParameters({ ...base, size: { ...base.size, parameter: "aspect_ratio" } }, [
        { name: "size", label: "画幅", type: "string", values: ["1:1"], default: "1:1", enabled: true },
        { name: "count", label: "生成张数", type: "integer", min: 1, max: maxOutputs, default: 1, description: "单次只能一张", enabled: true },
    ]);
    const channel = createModelChannel({ id: "single", scope: "system", models: ["image"], modelCosts: [{ model: "image", logicalModelId: "logical-image", capability: "image", billingMode: "fixed_request", unitPriceMicrocredits: 500_000, capabilityConfig: { version: 1, image } }] });
    const config: AiConfig = { ...defaultConfig, channels: [channel], model: "single::image", imageModel: "single::image", imageModels: ["single::image"], canvasImageCount: "4", count: "4" };
    const node: CanvasNodeData = { id: "image", type: CanvasNodeType.Image, title: "图片", position: { x: 0, y: 0 }, width: 300, height: 300, metadata: { model: config.model, count: 4 } };
    return { image, config, node };
}

describe("画布与创作页的图片拆单张数", () => {
    test.each([1, 4])("单次上限 %i 张的模型仍保留用户所选拆单数", (maxOutputs) => {
        const { config, node } = fixture(maxOutputs);
        expect(buildNodeConfig(config, node, "image", { capability: "image" }).count).toBe("4");
        expect(buildGenerationConfig(config, node, "image").count).toBe("4");
    });

    test("显式拆单控件显示账号允许的张数，不展示模型单次限制", () => {
        const { image, config } = fixture();
        const html = renderToStaticMarkup(<ImageParameterFields profile={image} config={{ ...config, count: "3" }} countLimit={3} onChange={() => {}} />);
        expect(html).toContain("生成张数");
        expect(html).toContain(">3</button>");
        expect(html).not.toContain("单次只能一张");
    });

    test("单任务组件没有显式拆单设置时保持模型上限", () => {
        const { image, config } = fixture();
        expect(renderToStaticMarkup(<ImageParameterFields profile={image} config={config} onChange={() => {}} />)).not.toContain("生成张数");
        expect(resolveModelGenerationDefaults(config, config.model, "image", { count: "4" }).count).toBe("1");
        expect(imageParameterRequest(image, config)?.count).toBe(1);
    });

    test("账号限额、无效旧偏好和退出登录均有明确边界", () => {
        useUserStore.getState().setRuntimeLimits({ ...originalLimits, activeTaskLimit: 3 });
        expect(currentGenerationBatchLimit()).toBe(3);
        expect(generationBatchCount("4", currentGenerationBatchLimit())).toBe(3);
        expect(generationBatchCount("-3", 5)).toBe(1);
        expect(generationBatchCount("NaN", 5)).toBe(1);
        expect(generationBatchCount("4.9", 5)).toBe(4);
        useUserStore.getState().setRuntimeLimits({ ...originalLimits, activeTaskLimit: 200 });
        expect(currentGenerationBatchLimit()).toBe(15);
        useUserStore.getState().setRuntimeLimits(undefined);
        expect(currentGenerationBatchLimit()).toBe(5);
    });

    test("未声明或禁用 count 的协议也可拆单，但请求不添加该参数", () => {
        const { image, config } = fixture();
        for (const parameters of [image.parameters!.filter((field) => field.name !== "count"), image.parameters!.map((field) => field.name === "count" ? { ...field, enabled: false } : field)]) {
            const profile = projectImageParameters(image, parameters);
            const html = renderToStaticMarkup(<ImageParameterFields profile={profile} config={config} countLimit={3} onChange={() => {}} />);
            expect(html).toContain(">3</button>");
            expect(imageParameterRequest(profile, { ...config, count: "1" })).not.toHaveProperty("count");
            const single = { ...config, count: "1", channels: config.channels.map(channel => ({ ...channel, modelCosts: channel.modelCosts.map(cost => ({ ...cost, capabilityConfig: { version: 1 as const, image: profile } })) })) };
            expect(modelQuoteRequest(single, config.model, "image")?.intent.options).not.toHaveProperty("count");
            expect(renderToStaticMarkup(<ImageParameterFields profile={profile} config={config} countLimit={1} onChange={() => {}} />)).not.toContain("生成张数");
        }
    });

    test("单张报价按拆单数合计，提示与数值一致，原报价不变", () => {
        const { config } = fixture();
        const singleConfig = { ...config, count: "1" };
        const requirements = { capability: "image" as const, options: modelRequestOptions(singleConfig, "image") };
        const request = modelQuoteRequest(singleConfig, config.model, "image", requirements);
        expect(request?.intent.options.count).toBe(1);
        const quote = { logicalModelId: "logical-image", billingMode: "fixed_request" as const, quantity: 1, amountMicrocredits: 500_000, estimated: true };
        const total = generationBatchQuote(quote, 3)!;
        expect(total).toMatchObject({ amountMicrocredits: 1_500_000, quantity: 3, estimated: true });
        expect(modelQuoteDescription(total)).toContain("预计消耗 1.5 积分");
        expect(quote.amountMicrocredits).toBe(500_000);
        expect(generationBatchQuote(null, 3)).toBeNull();
    });

    test("真实画布执行器受账号限制，四张选择拆成三个单张请求", async () => {
        useUserStore.getState().setRuntimeLimits({ ...originalLimits, activeTaskLimit: 3 });
        const { config, node } = fixture();
        const nodes = { current: [node] };
        const connections = { current: [] as CanvasConnection[] };
        const controller = new AbortController();
        const submitted: AiConfig[] = [];
        const noop = () => {};
        await executeImageGeneration({
            nodeId: node.id, sourceNode: node, canvasNodes: nodes.current, canvasConnections: connections.current,
            prompt: "隔离测试", effectivePrompt: "隔离测试", generationConfig: buildGenerationConfig(config, node, "image"),
            generationContext: { prompt: "隔离测试", referenceImages: [], referenceVideos: [], referenceAudios: [], referenceImageSlots: [], characterReferences: [], resolvedCharacterVersions: [], resolvedCharacterVoices: [], textCount: 1, imageCount: 0, videoCount: 0, audioCount: 0 },
            controller, projectId: "", editingTextNode: false, styleMetadata: {}, skillMetadata: {},
            setNodes: createCanvasStateWriter(nodes, noop), setConnections: createCanvasStateWriter(connections, noop),
            setSelectedNodeIds: noop, setSelectedConnectionId: noop, setDialogNodeId: noop,
            startGenerationRequest: () => controller, finishGenerationRequest: noop, bindGenerationTask: noop,
            applyGenerationTaskResult: async () => {}, showError: noop, registerPendingNodeIds: noop,
        }, async (options) => {
            submitted.push(options.config);
            // 模拟失败也必须保留完整拆单数量；不写素材、不访问后端或供应商。
            throw new Error("isolated failure");
        });
        expect(submitted).toHaveLength(3);
        expect(submitted.map((request) => request.count)).toEqual(["1", "1", "1"]);
    });
});
