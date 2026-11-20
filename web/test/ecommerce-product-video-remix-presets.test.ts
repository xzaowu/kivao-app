import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyVideoRemixPreset, buildVideoRemixStory, matchVideoRemixPreset, setVideoRemixAspects, videoRemixPresets } from "@/pages/ecommerce/product-video-remix-presets";
import { productShotScript, productVideoPrompt } from "@/pages/ecommerce/product-video";
import { presenterVoicePrompt, videoPlanningPrompt } from "@/pages/ecommerce/product-video-planning";
import { ProductVideoStoryboard } from "@/pages/ecommerce/product-video-storyboard";
import { isProductVideoReference } from "@/pages/ecommerce/product-video-version";
import { emptyEcommerceDraft } from "@/services/api/ecommerce";

const source = { resourceId: "own-video", name: "参考片", durationMs: 12000, instruction: "结尾留两秒给瓶身。" };

test("both shooting presets reach the real generation brief, and changing presets preserves handwritten directions", () => {
    const close = applyVideoRemixPreset(source, "close");
    const adapt = applyVideoRemixPreset(close, "adapt");
    for (const [id, reference] of [
        ["close", close],
        ["adapt", adapt],
    ] as const) {
        expect(matchVideoRemixPreset(reference)).toBe(id);
        expect(reference).toMatchObject({ resourceId: source.resourceId, durationMs: source.durationMs, aspects: videoRemixPresets[id].aspects });
        expect(isProductVideoReference(reference)).toBe(true);
        expect(reference.instruction).toBe(videoRemixPresets[id].instruction + "\n" + source.instruction);
        const prompt = productVideoPrompt({ productName: "香薰", audience: "", language: "zh-CN" }, "", "", "", reference);
        expect(prompt).toContain(reference.instruction!);
        expect(prompt).toContain("不沿用参考片中的人物身份、商品、品牌、文案或声音");
    }
    expect(applyVideoRemixPreset(adapt, "adapt")).toEqual(adapt);
    expect(matchVideoRemixPreset({ ...adapt, aspects: ["framing", "camera"] })).toBeUndefined();
    expect(matchVideoRemixPreset(source)).toBeUndefined();
});

test("applying a preset never truncates a full user note or exceeds the reference metadata limit", () => {
    const note = "镜".repeat(239) + "🎥";
    const result = applyVideoRemixPreset({ ...source, instruction: note }, "close");
    expect(result.instruction).toBe(note);
    expect(isProductVideoReference(result)).toBe(true);
    expect(matchVideoRemixPreset(result)).toBe("close");
});

test("reference windows map the source duration to the three output beats and honor the selected aspects", () => {
    const draft = { productName: "保温杯", scene: "办公室" };
    const close = buildVideoRemixStory(applyVideoRemixPreset(source, "close"), draft, "杯盖有提环");
    expect(close.approachId).toBe("reference-remix");
    expect(close.shots).toHaveLength(3);
    expect(close.shots[0]).toContain("0–2.4 秒");
    expect(close.shots[0]).toContain("办公室");
    expect(close.shots[0]).toContain("保温杯");
    expect(close.shots[0]).toContain("主体在画面中的位置和景别");
    expect(close.shots[1]).toContain("2.4–7.2 秒");
    expect(close.shots[1]).toContain("杯盖有提环");
    expect(close.shots[1]).toContain("原片机位的移动方向");
    expect(close.shots[2]).toContain("7.2–12 秒");
    const adapt = buildVideoRemixStory(applyVideoRemixPreset({ ...source, durationMs: 7500 }, "adapt"), draft, "", "最后带到桌面的全景");
    expect(adapt.shots[0]).toContain("0–1.5 秒");
    expect(adapt.shots[0]).toContain("重新安排开场构图");
    expect(adapt.shots[1]).not.toContain("原片机位");
    expect(adapt.shots[2]).toContain("4.5–7.5 秒");
    expect(adapt.shots[2]).toContain("最后带到桌面的全景");
    expect(buildVideoRemixStory({ ...source, durationMs: 410 }, draft, "").shots.join("")).not.toContain("0–0 秒");
});

test("custom aspect selection removes only the superseded preset instruction, including when reopening an older reference", () => {
    const draft = { ...emptyEcommerceDraft(), productName: "保温杯", region: "日本", language: "ja" };
    const close = applyVideoRemixPreset(source, "close");
    const custom = setVideoRemixAspects(close, ["framing"]);
    expect(custom.instruction).toBe(source.instruction);
    expect(setVideoRemixAspects(custom, [])).toBe(custom);
    const old = { ...close, aspects: custom.aspects };
    const story = buildVideoRemixStory(custom, draft, "手持位置有凹槽");
    story.shots[1] = "对照原片 4–6 秒，把杯子握在手心。";
    const prompt = productVideoPrompt(draft, "", productShotScript(story.shots), "看看杯身", old);
    for (const text of ["15 秒", "原片时长 12 秒", "仅借鉴参考视频的构图", source.instruction, story.shots[1], "日本", "看看杯身"]) expect(prompt).toContain(text);
    expect(prompt).not.toContain(videoRemixPresets.close.instruction);
    for (const text of [videoPlanningPrompt(draft, "", story, 1, "", undefined, "", false, undefined, old), presenterVoicePrompt(draft, "", story, "", undefined, "", "", false, undefined, old)]) {
        expect(text).toContain("参考片时长秒");
        expect(text).toContain('"借鉴重点":"构图"');
        expect(text).toContain(source.instruction);
        expect(text).not.toContain(videoRemixPresets.close.instruction);
        expect(text).toContain(story.shots[1]);
    }
});

test("a reopened remix edits the original shots directly and does not bind the product photo to the first shot", () => {
    const draft = emptyEcommerceDraft();
    const noop = () => {};
    const props = {
        active: true,
        draft,
        frame: { resourceId: "product", name: "商品照片" },
        projectImages: [],
        canReadFrame: async () => true,
        facts: "",
        closing: "",
        purpose: "showcase" as const,
        onPurpose: noop,
        candidateId: "reveal",
        onCandidate: noop,
        picking: true,
        onPicking: noop,
        onChange: noop,
        onAssist: noop,
        disabled: false,
    };
    const story = { ...buildVideoRemixStory(source, draft, ""), approachId: "reveal", edited: true, shots: ["手写开场", "手写中段", "手写收尾"] };
    const output = renderToStaticMarkup(createElement(ProductVideoStoryboard, { ...props, story, remix: true }));
    for (const text of ["复刻分镜", "手写开场", "手写中段", "手写收尾", "按脚本构图", "仅供预演"]) expect(output).toContain(text);
    for (const text of ["选择视频拍法", "更换拍法", "商品首帧", "video-approaches/reveal", "生成时使用分镜参考图"]) expect(output).not.toContain(text);
    expect(renderToStaticMarkup(createElement(ProductVideoStoryboard, { ...props, story: null, remix: true }))).not.toContain("选择视频拍法");
    expect(renderToStaticMarkup(createElement(ProductVideoStoryboard, { ...props, story: null }))).toContain("选择视频拍法");
});
