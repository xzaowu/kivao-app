import { describe, expect, test } from "bun:test";
import { DEFAULT_CREATION_SHORTCUTS, normalizeCreationShortcuts, validCreationShortcut } from "../src/lib/creation-shortcuts";

describe("创作首页快捷入口", () => {
    test("缺省使用四个导航入口，显式清空不恢复默认", () => {
        expect(normalizeCreationShortcuts(undefined)).toEqual(DEFAULT_CREATION_SHORTCUTS);
        expect(normalizeCreationShortcuts([])).toEqual([]);
        expect(DEFAULT_CREATION_SHORTCUTS.every(validCreationShortcut)).toBe(true);
    });

    test("支持站内工作区与指定工具，拒绝外站及管理接口", () => {
        for (const target of ["/", "/create", "/toolbox/image?tool=product", "/toolbox/video?tool=ad", "/canvas", "/canvas/test", "/skills", "/ecommerce", "/projects", "/projects/test/e/episode", "/assets", "/tasks"]) {
            expect(validCreationShortcut({ group: "创作", title: "入口", icon: "image", target })).toBe(true);
        }
        for (const target of ["https://example.com", "//example.com", "javascript:alert(1)", "/\\example.com", "/%2fexample.com", "/canvas/../admin", "/projects/%2e%2e/admin", "/canvas/%0a", "/admin", "/api/auth/logout", ""]) {
            expect(validCreationShortcut({ group: "创作", title: "入口", icon: "image", target })).toBe(false);
        }
    });

    test("保留顺序与分组，限制数量并过滤无效项", () => {
        const items = Array.from({ length: 11 }, (_, index) => ({ group: index % 2 ? "视频" : "图片", title: `入口 ${index + 1}`, icon: "image", target: "/canvas" }));
        expect(normalizeCreationShortcuts(items)).toEqual(items.slice(0, 10));
        expect(normalizeCreationShortcuts([{ ...items[0], title: "" }, { ...items[0], icon: "unknown" }, { ...items[0], group: "分\n组" }, { ...items[0], title: "字".repeat(21) }, items[1]])).toEqual([items[1]]);
    });
});
