import { expect, test } from "bun:test";
import { briefSuggestionPrompt, fillBriefGaps, parseShootBriefSuggestion, quickShootBrief } from "@/pages/ecommerce/product-video-brief-suggestions";
import { emptyEcommerceDraft } from "@/services/api/ecommerce";

test("简报快捷建议按商品给出，未知品类也可开始，不猜规格或优惠", () => {
    const draft = emptyEcommerceDraft();
    expect(quickShootBrief({ ...draft, productName: "无线耳机" }).scene).toContain("佩戴");
    expect(quickShootBrief({ ...draft, category: "美妆" }).scene).toContain("梳妆台");
    expect(quickShootBrief({ ...draft, productName: "雨量观察筒" }).audience).toContain("雨量观察筒");
    expect(quickShootBrief(draft).closing).not.toMatch(/限时|折扣|优惠/);
});
test("填入空白项保留采纳瞬间的手写内容，AI 缺少任何字段则完整拒绝", () => {
    const suggestion = { audience: "看尺寸的人", scene: "窗边书桌", closing: "对照商品大小" };
    expect(fillBriefGaps({ audience: "我刚改过的人群", scene: "", closing: "自己的收尾" }, suggestion)).toEqual({ audience: "我刚改过的人群", scene: "窗边书桌", closing: "自己的收尾" });
    expect(parseShootBriefSuggestion(JSON.stringify(suggestion))).toEqual(suggestion);
    for (const invalid of [{ ...suggestion, scene: " " }, { ...suggestion, closing: "长".repeat(241) }, { voice: "另一项任务的回复" }]) expect(() => parseShootBriefSuggestion(JSON.stringify(invalid))).toThrow();
    const prompt = briefSuggestionPrompt({ ...emptyEcommerceDraft(), productName: "旅行包" }, "双层内袋", JSON.stringify({ audience: "已有受众", scene: "", closing: "" }));
    for (const text of ["旅行包", "双层内袋", "已有受众", '"closing"']) expect(prompt).toContain(text);
});
