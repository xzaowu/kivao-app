import { expect, test } from "bun:test";
import { DEFAULT_CREATION_SHORTCUTS, normalizeCreationShortcuts, validCreationShortcut } from "../src/lib/creation-shortcuts";

test("创作入口有默认值，显式清空保持为空，公开列表最多 10 个", () => {
    expect(normalizeCreationShortcuts(undefined)).toEqual(DEFAULT_CREATION_SHORTCUTS);
    expect(normalizeCreationShortcuts([])).toEqual([]);
    expect(normalizeCreationShortcuts(Array.from({ length: 11 }, () => DEFAULT_CREATION_SHORTCUTS[0]))).toHaveLength(10);
    expect(normalizeCreationShortcuts([{ ...DEFAULT_CREATION_SHORTCUTS[0], icon: {} }])).toEqual([]);
});

test("快捷入口只接受站内创作路由，不接受外链、脚本、越界路由或控制字符", () => {
    const item = DEFAULT_CREATION_SHORTCUTS[0];
    for (const target of ["/", "/toolbox/image?tool=product", "/toolbox/video?tool=ad", "/canvas", "/canvas/example", "/skills"]) expect(validCreationShortcut({ ...item, target })).toBe(true);
    for (const target of ["https://example.com", "//example.com", "javascript:alert(1)", "/\\example.com", "/%2fexample.com", "/canvas/../admin", "/canvas/%0a", "/admin", ""]) expect(validCreationShortcut({ ...item, target })).toBe(false);
    expect(validCreationShortcut({ ...item, title: "字".repeat(21) })).toBe(false);
    expect(validCreationShortcut({ ...item, group: "" })).toBe(false);
    expect(validCreationShortcut({ ...item, icon: "toString" })).toBe(false);
});

test("画布节点默认提示在所有生成模式及已有内容状态下保留引用提示", async () => {
    const { promptPlaceholder } = await import("../src/components/canvas/canvas-node-prompt-config");
    for (const mode of ["image", "video", "text", "audio"] as const) {
        expect(promptPlaceholder(mode, false, false)).toEndWith("@引用素材/技能");
        expect(promptPlaceholder(mode, true, true)).toEndWith("@引用素材/技能");
    }
});
