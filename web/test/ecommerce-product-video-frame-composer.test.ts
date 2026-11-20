import { expect, test } from "bun:test";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { systemModelQuoteRequest } from "@/lib/model-pricing";
import { composerProduct, compositeOutput, compositePrompt, compositeReviewKey, frameModels, frameRequirements } from "@/pages/ecommerce/product-video-frame-composer";
import { privateCastingPhoto, projectCastingPhotos } from "@/pages/ecommerce/product-video-frame-composer-casting";
import { castingImageSettings, castingModels, castingOutput, portraitRequirements } from "@/pages/ecommerce/casting-image-task";
import { appearanceFields, portraitLooks, portraitPrompt, restorePortraitBrief } from "@/pages/ecommerce/casting-portrait-brief";
import type { Asset } from "@/stores/use-asset-store";
import type { EcommerceReference } from "@/services/api/ecommerce";
import { isProductVideoFrame } from "@/pages/ecommerce/product-video-version";
import type { GenerationTask } from "@/services/api/task-center";
import { createModelChannel, defaultConfig } from "@/stores/use-config-store";

test("AI 模特允许所有外观由模型决定；每个明确选择都改变报价绑定的实际定妆提示", () => {
    const natural = restorePortraitBrief();
    const prompt = portraitPrompt(natural);
    expect(prompt).toContain("成年");
    for (const field of appearanceFields) {
        expect(natural[field.key]).toBe("");
        expect(prompt).not.toContain(field.label);
        for (const option of field.options) {
            expect(portraitPrompt({ ...natural, [field.key]: option })).toContain(`${field.label}：${option}。`);
        }
    }
    for (const item of portraitLooks) expect(portraitPrompt({ ...natural, look: item.name })).toContain(item.direction);
    const custom = restorePortraitBrief({ look: "专业讲解员", age: "中年（35–59 岁）", detail: "  黑色短发与浅色衬衫  " });
    expect(portraitPrompt(custom)).toEndWith("黑色短发与浅色衬衫");
    expect(restorePortraitBrief(JSON.parse(JSON.stringify(custom)))).toEqual(custom);
    expect(restorePortraitBrief({ look: "已删除的旧风格", presentation: "未知", age: "未知" })).toEqual(natural);
});

test("项目主模特和主商品图各自排首位，不把人台、模特、标志、风格或竞品当成商品原图", () => {
    const refs: EcommerceReference[] = [
        { resourceId: "detail", role: "detail", name: "包装细节" },
        { resourceId: "other-person", role: "model" },
        { resourceId: "hero", role: "primary" },
        { resourceId: "model", role: "primary" },
        { resourceId: "model", role: "model", catalogId: "cn-woman" },
        { resourceId: "other-person", role: "model" },
        { resourceId: "mannequin", role: "model", catalogId: "mannequin-woman" },
        { resourceId: "logo", role: "logo" },
        { resourceId: "style", role: "style" },
        { resourceId: "competitor", role: "competitor" },
    ];
    const photos = projectCastingPhotos(refs, "model", { resourceId: "adhoc", name: "本次上传" });
    expect(photos.person.map(({ resourceId }) => resourceId)).toEqual(["model", "other-person"]);
    expect(photos.person[0]).toMatchObject({ name: "中国 · 成熟女模", primary: true });
    expect(photos.product.map(({ resourceId }) => resourceId)).toEqual(["hero", "detail", "adhoc"]);
    expect(projectCastingPhotos(refs, undefined, { resourceId: "style", name: "风格" }).product.map(({ resourceId }) => resourceId)).toEqual(["hero", "detail"]);
    expect(projectCastingPhotos([])).toEqual({ person: [], product: [] });
});

test("合成人货同框图只提供可接收两张图片的系统模型，并按双图编辑报价", () => {
    const models = ["single", "pair"];
    const channel = createModelChannel({
        id: "studio",
        scope: "system",
        models,
        modelCosts: models.map((model, i) => {
            const profile = defaultModelCapabilityConfig("openai-image");
            profile.image!.references.maxImages = i + 1;
            return { model, protocol: "openai-image", capability: "image", capabilityConfig: profile, billingMode: "fixed_request", unitPriceMicrocredits: 2_000_000 };
        }),
    });
    const config = { ...defaultConfig, model: "studio::pair", imageModel: "studio::pair", channels: [channel, { ...channel, id: "private", scope: "user" as const }] };
    expect(frameModels(config)).toEqual(["studio::pair"]);
    expect(systemModelQuoteRequest(config, config.model, "image", frameRequirements)).toMatchObject({ channelId: "studio", modelKey: "pair", intent: { operation: "image_to_image", inputs: { image: 2, video: 0, audio: 0 }, options: { count: 1 } } });
});

test("同框默认素材跟随当前主图，手选和提交回执优先，采用合成品后保留用于合成的原图", () => {
    const a = { resourceId: "A", name: "主图 A", primary: true };
    const b = { resourceId: "B", name: "上传 B" };
    const c = { resourceId: "C", name: "手选 C" };
    const automatic = { productPicked: false };
    const chosen = { productPicked: true, product: c };
    expect(composerProduct(automatic, [])).toBeUndefined();
    expect(composerProduct(automatic, [a])).toEqual(a);
    expect(composerProduct(automatic, [b], b.resourceId)).toEqual(b);
    expect(composerProduct({ ...automatic, product: a }, [a, b], b.resourceId)).toEqual(b);
    expect(composerProduct(chosen, [a, b], b.resourceId)).toEqual(c);
    expect(composerProduct(chosen, [a, b], b.resourceId, a)).toEqual(a);
    expect(composerProduct({ ...automatic, product: b }, [a])).toEqual(b);
    expect(composerProduct({ ...automatic, person: b }, [a, b], b.resourceId)).toBeUndefined();
    const quoteFor = (main: string, inputs = automatic) => compositeReviewKey("reference", { product: composerProduct(inputs, [a, b], main) }, "", "image-model");
    expect(quoteFor(b.resourceId)).not.toEqual(quoteFor(a.resourceId));
    expect(quoteFor(b.resourceId, chosen)).toEqual(quoteFor(a.resourceId, chosen));
});

test("复刻的同框图保留商品和模特外形，使用参考片的动作；口播首帧仍是正对镜头", () => {
    const presenter = compositePrompt("presenter", "手持展示");
    const reference = compositePrompt("reference", "在货架前转身");
    expect(presenter).toContain("人物面向镜头");
    expect(presenter).toEndWith("手持展示");
    expect(reference).toContain("第一张参考图是出镜人物，第二张是商品");
    expect(reference).toContain("复刻");
    expect(reference).not.toMatch(/口播|面向镜头/);
    expect(reference).toEndWith("在货架前转身");
});

test("只从同一项目同一回执的成功任务采用一张已登记的原图", () => {
    const receipt = { projectId: "project", operationId: "attempt" };
    const task: GenerationTask = { id: "task", type: "canvas_image", prompt: "同框", status: "succeeded", projectId: receipt.projectId, clientOperationId: receipt.operationId, resultJson: JSON.stringify({ images: [{ storageKey: "resource:frame" }] }) };
    expect(compositeOutput(task, receipt)).toEqual({ resourceId: "frame", name: "人物与商品同框图" });
    for (const changes of [
        { status: "running" as const },
        { type: "canvas_video" },
        { projectId: "other" },
        { clientOperationId: "other" },
        { resultJson: "{" },
        { resultJson: JSON.stringify({ images: [{ url: "https://example.invalid/example.png" }] }) },
        { resultJson: JSON.stringify({ images: [{ storageKey: "resource:frame" }, { storageKey: "resource:second" }] }) },
    ])
        expect(compositeOutput({ ...task, ...changes }, receipt)).toBeUndefined();
    expect(isProductVideoFrame({ resourceId: "frame", name: "首帧", source: "composite" })).toBe(true);
    expect(isProductVideoFrame({ resourceId: "frame", name: "首帧", source: "unknown" })).toBe(false);
});

test("自建模特只按纯文本生成一张图片报价，同框与自建的回执不可互换", () => {
    const profile = defaultModelCapabilityConfig("openai-image");
    const model = "casting";
    const channel = createModelChannel({ id: "photos", scope: "system", models: [model], modelCosts: [{ model, capability: "image", capabilityConfig: profile, protocol: "openai-image", billingMode: "fixed_request", unitPriceMicrocredits: 2000000 }] });
    const config = { ...defaultConfig, imageModel: "photos::casting", channels: [channel, { ...channel, id: "personal", scope: "user" as const }] };
    expect(castingModels(config, portraitRequirements)).toEqual(["photos::casting"]);
    const settings = castingImageSettings(config, config.imageModel)!;
    expect(systemModelQuoteRequest(settings, config.imageModel, "image", portraitRequirements)).toMatchObject({ intent: { operation: "text_to_image", inputs: { image: 0, video: 0, audio: 0 }, options: { count: 1 } } });
    const task: GenerationTask = { id: "t", projectId: "p", clientOperationId: "portrait", type: "canvas_image", status: "succeeded", prompt: "", resultJson: JSON.stringify({ images: [{ storageKey: "resource:person" }] }) };
    expect(castingOutput(task, { projectId: "p", operationId: "portrait", taskId: "t" }, "自建模特")).toEqual({ resourceId: "person", name: "自建模特" });
    expect(castingOutput(task, { projectId: "p", operationId: "other", taskId: "t" }, "自建模特")).toBeUndefined();
    expect(castingOutput(task, { projectId: "p", operationId: "portrait", taskId: "other" }, "自建模特")).toBeUndefined();
});

test("我的模特只复用可读取的私人模特图，用户改名后保留归类", () => {
    const image: Asset = {
        id: "a",
        kind: "image",
        title: "小夏",
        coverUrl: "",
        createdAt: "",
        updatedAt: "",
        data: { dataUrl: "", storageKey: "resource:img", width: 1, height: 1, bytes: 10, mimeType: "image/png" },
        tags: [],
        metadata: { ecommerceStage: "product-video-casting" },
    };
    expect(privateCastingPhoto(image)).toEqual({ resourceId: "img", name: "小夏" });
    expect(privateCastingPhoto({ ...image, metadata: {}, tags: ["AI 模特"] })).toEqual({ resourceId: "img", name: "小夏" });
    expect(privateCastingPhoto({ ...image, metadata: {}, title: "AI 模特 · 只有同名" })).toBeUndefined();
    expect(privateCastingPhoto({ ...image, status: "archived" })).toBeUndefined();
    expect(privateCastingPhoto({ ...image, data: { ...image.data, storageKey: "https://example.invalid/preview" } })).toBeUndefined();
});
