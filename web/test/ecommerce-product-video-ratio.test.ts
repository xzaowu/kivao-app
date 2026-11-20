import { expect, test } from "bun:test";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { systemModelQuoteRequest } from "@/lib/model-pricing";
import { productVideoConfig, productVideoRatio, productVideoRequirements } from "@/pages/ecommerce/product-video";
import { prepareBackendGenerationTask } from "@/services/api/generation-task";
import { createModelChannel, defaultConfig } from "@/stores/use-config-store";

function ratioConfig(ratios: string[], defaultRatio: string, workflowFixed = false) {
    const capabilityConfig = defaultModelCapabilityConfig("newapi");
    const profile = capabilityConfig.video!;
    profile.ratios = ratios;
    profile.defaultRatio = defaultRatio;
    if (workflowFixed) profile.fixedScreenSpec = { ratios: [], defaultRatio: "", resolutions: profile.resolutions, defaultResolution: profile.defaultResolution };
    const channel = createModelChannel({ id: "studio", scope: "system", models: ["clip"], modelCosts: [{ model: "clip", capability: "video", protocol: "newapi", capabilityConfig }] });
    return { ...defaultConfig, channels: [channel] };
}

const model = "studio::clip";

test("电商画幅只显示目标模型的有效选项，新视频保留竖屏优先，单画幅模型用唯一值", () => {
    const wide = ratioConfig(["16:9", "1:1"], "1:1");
    expect(productVideoRatio(wide, undefined)).toEqual({ options: [], value: "", unavailable: "" });
    expect(productVideoRatio(wide, model)).toEqual({ options: ["16:9", "1:1"], value: "1:1", unavailable: "" });
    expect(productVideoRatio(ratioConfig(["16:9", "9:16"], "16:9"), model).value).toBe("9:16");
    expect(productVideoRatio(ratioConfig(["4:3"], "16:9"), model)).toEqual({ options: ["4:3"], value: "4:3", unavailable: "" });
});

test("恢复旧版本、切换模型或能力收窄时，明确选择的画幅须由用户重新确认", () => {
    const single = ratioConfig(["16:9"], "16:9");
    for (const previous of ["9:16", "auto", "adaptive"]) {
        expect(productVideoRatio(single, model, previous)).toEqual({ options: ["16:9"], value: "", unavailable: previous });
        expect(() => productVideoConfig(single, model, false, { ratio: previous })).toThrow("请重新选择");
    }
    expect(productVideoConfig(single, model, false, { ratio: "16:9" })).toMatchObject({ size: "16:9", videoSeconds: "15" });
});

test.each([
    { ratios: ["16:9", "1:1"], selected: "1:1", fixed: false, sent: "1:1" },
    { ratios: ["adaptive", "9:16"], selected: "adaptive", fixed: false, sent: "adaptive" },
    { ratios: ["16:9"], selected: "auto", fixed: true, sent: undefined },
])("15 秒商品视频报价与实际任务按同一画幅提交 $selected / fixed=$fixed", async ({ ratios, selected, fixed, sent }) => {
    const config = ratioConfig(ratios, ratios[0], fixed);
    if (fixed) {
        expect(productVideoRatio(config, model)).toEqual({ options: ["auto"], value: "auto", unavailable: "" });
        expect(() => productVideoConfig(config, model, false, { ratio: "16:9" })).toThrow("请重新选择");
    }
    const settings = productVideoConfig(config, model, false, { ratio: selected, resolution: "720p" });
    const quote = systemModelQuoteRequest(settings, model, "video", productVideoRequirements);
    const task = await prepareBackendGenerationTask({
        mode: "video",
        config: settings,
        prompt: "展示商品的纹理",
        referenceImages: [{ id: "frame", name: "商品", type: "image/png", url: "", storageKey: "resource:frame" }],
        metadata: { videoEditOperation: "image_to_video", videoStartFrameNodeId: "frame" },
    });
    expect(quote?.intent.options?.videoSeconds).toBe(15);
    expect(quote?.intent.options?.size).toBe(sent);
    expect(task.input.config.videoSeconds).toBe("15");
    expect(task.input.config.size).toBe(sent);
});
