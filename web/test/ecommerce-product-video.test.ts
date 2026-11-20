import { expect, test } from "bun:test";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { systemModelQuoteRequest } from "@/lib/model-pricing";
import {
    productClaimSuggestions,
    productShotScript,
    productVideoConfig,
    productVideoModels,
    productVideoPresenterModels,
    productVideoPrompt,
    productVideoRatio,
    productVideoRequirements,
    productVideoRequirementsFor,
    productVideoShotImages,
} from "@/pages/ecommerce/product-video";
import type { ProductVideoBoards } from "@/pages/ecommerce/product-video-board";
import { isProductVideoReference, isProductVideoVersion } from "@/pages/ecommerce/product-video-version";
import { productVideoApproaches } from "@/pages/ecommerce/product-video-approaches";
import { videoPlanningPrompt } from "@/pages/ecommerce/product-video-planning";
import { emptyEcommerceDraft } from "@/services/api/ecommerce";
import { createModelChannel, defaultConfig } from "@/stores/use-config-store";

test("a single first frame and the full 15 seconds must be supported on the quoted channel", () => {
    const profiles = Array.from({ length: 5 }, () => defaultModelCapabilityConfig("newapi"));
    profiles[1].video!.duration = { selection: "enum", values: [5, 10], default: 5 };
    profiles[2].video!.operations = ["text_to_video"];
    profiles[3].video!.references.minImages = 2;
    profiles[4].video!.durationSupported = false;
    const models = ["full", "short", "text-only", "pair", "automatic-duration"];
    const channel = createModelChannel({
        id: "shop",
        name: "门店",
        scope: "system",
        models,
        modelCosts: models.map((model, i) => ({ model, capability: "video", capabilityConfig: profiles[i], protocol: "newapi", billingMode: "per_second", unitPriceMicrocredits: 10000 })),
    });
    const config = { ...defaultConfig, channels: [channel, { ...channel, id: "personal", scope: "user" as const }] };
    expect(productVideoModels(config)).toEqual(["shop::full"]);
    const selected = productVideoConfig({ ...config, taskWorkflowProvider: "runninghub" }, "shop::full", false);
    expect(selected).toMatchObject({ model: "shop::full", taskWorkflowProvider: "model", videoSeconds: "15", size: "9:16" });
    expect(systemModelQuoteRequest(selected, selected.model, "video", productVideoRequirements)).toMatchObject({
        channelId: "shop",
        modelKey: "full",
        intent: { operation: "image_to_video", inputs: { image: 1, video: 0 }, options: { videoSeconds: 15, size: "9:16" } },
    });
});

test("the video brief uses edited shots and confirmed claims, preserving an optional voiceover", () => {
    const draft = { productName: "收纳包", scene: "通勤", audience: "上班族", language: "zh-CN", claims: "过期卖点", description: "未经证实的功效" };
    const template = productShotScript(productVideoApproaches("lifestyle", draft)[0].shots);
    expect(template).toContain("9–15 秒");
    expect(template).toContain("通勤");
    const prompt = productVideoPrompt(draft, "双层拉链", "0–15 秒：拉开拉链展示隔层", "看看里面的隔层");
    for (const text of ["收纳包", "上班族", "双层拉链", "拉开拉链", "看看里面的隔层"]) expect(prompt).toContain(text);
    for (const text of ["过期卖点", "未经证实的功效", template]) expect(prompt).not.toContain(text);
    expect(productVideoPrompt(draft, "", template, " ")).toContain("无需口播");
});

test("sales clips generate spoken recommendations in the selected language with or without supplied copy", () => {
    const draft = { productName: "折叠杯", audience: "通勤族", language: "ja" };
    const prompt = (mode: "host" | "voiceover" | "silent", voice = "") => productVideoPrompt(draft, "杯盖带挂环", "举起杯盖给观众看挂环", voice, undefined, undefined, undefined, false, 1, mode);
    for (const mode of ["host", "voiceover"] as const) {
        expect(prompt(mode)).toContain("日文");
        expect(prompt(mode)).toContain("用成片语言生成听得见的");
        expect(prompt(mode)).not.toContain("无需口播");
        expect(prompt(mode, "ふたのリングを見てください。")).toContain("ふたのリングを見てください。");
        expect(prompt(mode, "ふたのリングを見てください。")).not.toContain("生成听得见的两三句");
    }
    expect(prompt("host")).toContain("口型和手上演示同步");
    expect(prompt("voiceover")).toContain("由画外音讲解");
    expect(prompt("silent", "保留给下一次的手写台词")).toContain("全片无口播、无旁白");
    expect(prompt("silent", "保留给下一次的手写台词")).not.toContain("保留给下一次的手写台词");
});

test("shopping storyboard keeps the product first and assigns each shot its actual reference number", () => {
    const product = { resourceId: "product", name: "商品" };
    const close = { resourceId: "detail", name: "商品" };
    const scene = { resourceId: "scene", name: "场景" };
    const boards: ProductVideoBoards = [{ frame: close, framing: "detail" }, { frame: scene }, { frame: { ...close, name: "再次选取" } }];
    const images = productVideoShotImages(product, boards);
    expect(images).toEqual([product, close, scene]);
    const shots = ["拍纹理", "展示场景", "回到纹理"];
    const script = productShotScript(shots, boards, images);
    expect(script.split("\n")).toEqual(["0–3 秒｜开场：【参考图2 · 特写】拍纹理", "3–9 秒｜细节：【参考图3】展示场景", "9–15 秒｜收尾：【参考图2】回到纹理"]);
    const prompt = productVideoPrompt(emptyEcommerceDraft(), "细纹", script, "", undefined, undefined, undefined, false, images.length);
    expect(prompt).toContain("参考图1是商品主图");
    expect(prompt).toContain(script);
    expect(prompt).not.toContain("首帧");
    expect(productVideoShotImages(undefined, boards)).toEqual([]);
    const mainOnly: ProductVideoBoards = [{}, { frame: product, framing: "wide" }, {}];
    expect(productVideoShotImages(product, mainOnly)).toEqual([product]);
    expect(productShotScript(shots, mainOnly, [product])).toEqual(productShotScript(shots, mainOnly));
    const mixed: ProductVideoBoards = [{}, { frame: product }, { frame: close }];
    expect(productShotScript(shots, mixed, productVideoShotImages(product, mixed)).match(/参考图\d/g)).toEqual(["参考图1", "参考图1", "参考图2"]);
});

test("shopping multi-image quotes and model selection enforce the exact reference count, zero clips and 15 seconds", () => {
    const models = ["full", "frame-only", "too-few", "needs-three", "short", "automatic", "unverified-wire"];
    const profiles = models.map(() => defaultModelCapabilityConfig("volcengine-ark-video"));
    for (const profile of profiles.slice(0, -1)) profile.video!.numberedImageReferences = true;
    profiles[1].video!.operations = ["image_to_video"];
    profiles[2].video!.references.maxImages = 1;
    profiles[3].video!.references.minImages = 3;
    profiles[4].video!.duration = { selection: "enum", values: [5, 10], default: 5 };
    profiles[5].video!.durationSupported = false;
    const channel = createModelChannel({
        id: "shop",
        name: "视频",
        scope: "system",
        models,
        modelCosts: models.map((model, i) => ({ model, capability: "video", capabilityConfig: profiles[i], protocol: "volcengine-ark-video", billingMode: "per_second", unitPriceMicrocredits: 10000 })),
    });
    const config = { ...defaultConfig, channels: [channel, { ...channel, id: "personal", scope: "user" as const }] };
    expect(productVideoModels(config, undefined, 2)).toEqual(["shop::full"]);
    expect(productVideoModels(config, undefined, 3)).toEqual(["shop::full", "shop::needs-three"]);
    expect(productVideoModels(config)).toContain("shop::unverified-wire");
    expect(productVideoModels(config, undefined, 1, false, true)).toEqual(["shop::full", "shop::too-few"]);
    expect(productVideoModels(config, undefined, 0, false, true)).toEqual(["shop::full", "shop::too-few"]);
    const requirements = productVideoRequirementsFor(undefined, 3);
    expect(requirements.input).toMatchObject({ imageCount: 3, referenceImageCount: 3, videoCount: 0 });
    const selected = productVideoConfig(config, "shop::full", false);
    expect(systemModelQuoteRequest(selected, selected.model, "video", productVideoRequirementsFor(undefined, 1, false, true))).toMatchObject({
        intent: { operation: "reference_to_video", inputs: { image: 1, video: 0, audio: 0 }, options: { videoSeconds: 15, videoGenerateAudio: false } },
    });
    const quote = systemModelQuoteRequest(selected, selected.model, "video", requirements);
    expect(quote).toMatchObject({ intent: { operation: "reference_to_video", inputs: { image: 3, video: 0 }, options: { videoSeconds: 15 } } });
    expect(quote?.intent.referenceVideoDurationsMs).toBeUndefined();
});

test("one to three product views inform the whole video and explicit board images share the same ordered bindings", () => {
    const images = ["front", "side", "label", "in-use"].map((resourceId) => ({ resourceId, name: resourceId }));
    const shots = ["从人的使用场景入场", "手指标签", "切回演示"];
    const boards: ProductVideoBoards = [{}, { frame: images[2] }, { frame: images[3] }];
    expect(productVideoShotImages([], boards)).toEqual([]);
    for (const count of [1, 2, 3]) {
        const products = images.slice(0, count);
        const input = productVideoShotImages(products, boards);
        expect(input).toEqual([...new Set([...products, images[2], images[3]])]);
        const script = productShotScript(shots, boards, input, count);
        expect(script.split("\n")[0]).not.toContain("参考图");
        expect(script.split("\n")[1]).toContain(`参考图${input.indexOf(images[2]) + 1}`);
        const prompt = productVideoPrompt(emptyEcommerceDraft(), "", script, "", undefined, undefined, undefined, false, input.length, "host", count);
        expect(new Set(prompt.match(/参考图\d+/g))).toEqual(new Set(input.map((_, i) => `参考图${i + 1}`)));
        expect(prompt).toContain("开场按分镜重新构图");
        expect(prompt).not.toContain("首帧");
        expect(productVideoRequirementsFor(undefined, count, true, true)).toMatchObject({ videoOperation: "reference_to_video", input: { imageCount: count, referenceImageCount: count }, options: { videoGenerateAudio: true } });
    }
    const productViews = images.slice(0, 3);
    const version = {
        schema: 1,
        frame: images[0],
        productImages: productViews,
        model: "video",
        purpose: "showcase",
        shots,
        facts: "",
        voice: "",
        productName: "",
        audience: "",
        language: "zh-CN",
        settings: { seconds: 15, ratio: "9:16", resolution: "720p", generateAudio: true },
    };
    expect(isProductVideoVersion(version)).toBe(true);
    expect(isProductVideoVersion({ ...version, productImages: [images[0]], boardInputs: true, boards: [{ frame: images[0] }, {}, {}] })).toBe(true);
    for (const change of [
        { productImages: [] },
        { productImages: images },
        { productImages: [images[0], images[0]] },
        { frame: images[1] },
        { referenceVideo: { resourceId: "ref", name: "video", durationMs: 5000 } },
        { boardInputs: true, boards: [{}, {}, {}] },
    ]) {
        expect(isProductVideoVersion({ ...version, ...change })).toBe(false);
    }
});

test("spoken sales presets require native audio even with multiple numbered product references", () => {
    const models = ["talk", "silent", "first-frame-only"];
    const profiles = models.map(() => defaultModelCapabilityConfig("volcengine-ark-video"));
    profiles.forEach((profile) => {
        profile.video!.numberedImageReferences = true;
    });
    profiles[1].video!.generateAudio = { supported: false, default: false };
    profiles[2].video!.operations = ["image_to_video"];
    const config = {
        ...defaultConfig,
        channels: [
            createModelChannel({
                id: "shop",
                name: "商品短片",
                scope: "system",
                models,
                modelCosts: models.map((model, i) => ({ model, capability: "video", capabilityConfig: profiles[i], protocol: "volcengine-ark-video", billingMode: "per_second", unitPriceMicrocredits: 50 })),
            }),
        ],
    };
    expect(productVideoModels(config, undefined, 1, true)).toEqual(["shop::talk", "shop::first-frame-only"]);
    expect(productVideoModels(config, undefined, 2, true)).toEqual(["shop::talk"]);
    expect(productVideoModels(config, undefined, 2)).toContain("shop::silent");
    const settings = productVideoConfig(config, "shop::talk", true);
    expect(systemModelQuoteRequest(settings, settings.model, "video", productVideoRequirementsFor(undefined, 2, true))).toMatchObject({
        intent: { operation: "reference_to_video", inputs: { image: 2, audio: 0 }, options: { videoGenerateAudio: true, videoSeconds: 15 } },
    });
});

test("a reference remake quotes the clip duration and only offers models accepting a clip and a product image", () => {
    const models = ["remake", "frame-only", "no-clip", "short-clip", "no-image", "seedance-remake", "unverified-protocol"];
    const profiles = models.map(() => defaultModelCapabilityConfig("volcengine-ark-video"));
    for (const profile of profiles.slice(0, -1)) profile.video!.remixReferences = true;
    profiles[0].video!.remixGenerateAudio = true;
    profiles[1].video!.operations = ["image_to_video"];
    profiles[2].video!.references.maxVideos = 0;
    profiles[3].video!.references.maxVideoDurationSeconds = 5;
    profiles[4].video!.references.maxImages = 0;
    const channel = createModelChannel({
        id: "shop",
        name: "门店",
        scope: "system",
        models,
        modelCosts: models.map((model, i) => ({ model, capability: "video", capabilityConfig: profiles[i], protocol: "volcengine-ark-video", billingMode: "per_second", unitPriceMicrocredits: 10000 })),
    });
    const config = { ...defaultConfig, channels: [channel] };
    const reference = { resourceId: "clip-one", name: "运镜参考", durationMs: 5_125 };
    expect(productVideoModels(config, reference)).toEqual(["shop::remake", "shop::seedance-remake"]);
    expect(productVideoModels(config, reference, 1, true)).toEqual(["shop::remake"]);
    expect(productVideoModels(config, { durationMs: 1_000 })).not.toContain("shop::seedance-remake");
    const selected = productVideoConfig(config, "shop::remake", false);
    expect(systemModelQuoteRequest(selected, selected.model, "video", productVideoRequirementsFor(reference))).toMatchObject({
        intent: { operation: "reference_to_video", inputs: { image: 1, video: 1, audio: 0 }, referenceVideoDurationsMs: [5125], options: { videoSeconds: 15 } },
    });
    const prompt = productVideoPrompt({ productName: "香薰", audience: "", language: "" }, "玻璃瓶身", "跟拍镜头", "", { ...reference, aspects: ["framing"], instruction: "先全景再细节" });
    expect(prompt).toContain("商品参考图");
    expect(prompt).toContain("借鉴参考视频的构图");
    expect(prompt).toContain("先全景再细节");
    expect(prompt).not.toContain("首帧");
    expect(isProductVideoReference(reference)).toBe(true);
    for (const invalid of [{ durationMs: 0 }, { durationMs: 1.2 }, { durationMs: 3_600_001 }, { aspects: ["logo"] }, { aspects: ["camera", "camera"] }, { aspects: [] }, { instruction: "图".repeat(241) }]) {
        expect(isProductVideoReference({ ...reference, ...invalid })).toBe(false);
    }
});

test("vision recommendations only include individual visible observations", () => {
    expect(productClaimSuggestions(JSON.stringify({ category: "音箱", visibleDescription: "1. 圆形外壳。\n- 侧边有音量旋钮；圆形外壳", uncertainFacts: ["防水"] }))).toEqual(["圆形外壳", "侧边有音量旋钮"]);
    expect(productClaimSuggestions('{"visibleDescription":""}')).toEqual([]);
    expect(() => productClaimSuggestions('{"claims":["未验证"]}')).toThrow();
    expect(productClaimSuggestions('\x60\x60\x60json\n{"visibleDescription":"磁吸盖"}\n\x60\x60\x60')).toEqual(["磁吸盖"]);
});

test("presenter clips quote a single confirmed first frame with native audio and preserve the spoken script", () => {
    const models = ["talk", "silent", "short", "text-only", "drops-audio"];
    const profiles = models.map(() => defaultModelCapabilityConfig("volcengine-ark-video"));
    for (const profile of profiles.slice(0, -1)) profile.video!.presenterFirstFrameAudio = true;
    profiles[1].video!.generateAudio = { supported: false, default: false };
    profiles[2].video!.duration = { selection: "enum", values: [5], default: 5 };
    profiles[3].video!.operations = ["text_to_video"];
    const channel = createModelChannel({
        id: "shop",
        name: "门店",
        scope: "system",
        models,
        modelCosts: models.map((model, i) => ({ model, capability: "video", capabilityConfig: profiles[i], protocol: "volcengine-ark-video", billingMode: "per_second", unitPriceMicrocredits: 50 })),
    });
    const config = { ...defaultConfig, channels: [channel, { ...channel, id: "personal", scope: "user" as const }] };
    expect(productVideoPresenterModels(config)).toEqual(["shop::talk"]);
    for (const protocol of ["volcengine-ark-seedance-25", "minimax-video"] as const) {
        const adaptive = defaultModelCapabilityConfig(protocol);
        adaptive.video!.ratios = ["9:16", "adaptive"];
        const firstFrameChannel = createModelChannel({ ...channel, modelCosts: [{ ...channel.modelCosts![0], protocol, capabilityConfig: adaptive }] });
        const firstFrameConfig = { ...config, channels: [firstFrameChannel] };
        expect(productVideoRatio(firstFrameConfig, "shop::talk", undefined, true).value).toBe("adaptive");
        expect(productVideoRatio(firstFrameConfig, "shop::talk", "9:16", true).unavailable).toBe("9:16");
        expect(productVideoConfig(firstFrameConfig, "shop::talk", true, undefined, true).size).toBe("adaptive");
    }
    const selected = productVideoConfig(config, "shop::talk", true);
    const quote = systemModelQuoteRequest(selected, selected.model, "video", productVideoRequirements);
    expect(quote).toMatchObject({ intent: { operation: "image_to_video", inputs: { image: 1, video: 0, audio: 0 }, options: { videoGenerateAudio: true, videoSeconds: 15 } } });
    expect(quote?.intent.referenceVideoDurationsMs).toBeUndefined();
    const presenter = { frameResourceId: "my-frame", delivery: "demonstrate" } as const;
    const script = {
        schema: 1,
        frame: { resourceId: "my-frame", name: "同框图" },
        model: "shop::talk",
        facts: "玻璃瓶身",
        purpose: "demo",
        shots: ["开场", "演示", "收尾"],
        voice: "看瓶身的刻度。",
        productName: "水瓶",
        audience: "通勤",
        language: "zh-CN",
        settings: { seconds: 15, ratio: "9:16", resolution: "720p", generateAudio: true },
        presenter,
    };
    expect(isProductVideoVersion(script)).toBe(true);
    for (const changes of [
        { frame: { resourceId: "other", name: "旧图" } },
        { voice: "   " },
        { settings: { ...script.settings, generateAudio: false } },
        { presenter: { ...presenter, delivery: "clone" } },
        { referenceVideo: { resourceId: "clip", name: "片段", durationMs: 1000 } },
    ]) {
        expect(isProductVideoVersion({ ...script, ...changes })).toBe(false);
    }
    const prompt = productVideoPrompt(script, script.facts, productShotScript(script.shots), script.voice, undefined, presenter);
    expect(prompt).toContain("边使用商品边讲解");
    expect(prompt).toContain("逐字说完下方台词一次");
    expect(prompt).toContain("口型");
    expect(prompt.endsWith("口播文案（zh-CN）：看瓶身的刻度。")).toBe(true);
    const planning = videoPlanningPrompt(emptyEcommerceDraft(), script.facts, { purpose: "demo", shots: script.shots, edited: true }, 1, "给瓶身刻度一个特写", { delivery: presenter.delivery, voice: script.voice });
    expect(JSON.parse(planning.split("\n").at(-1)!)).toMatchObject({ 口播方式: "边用边讲", 人物台词: script.voice });
    expect(planning).toContain("保留用户的原台词");
});
