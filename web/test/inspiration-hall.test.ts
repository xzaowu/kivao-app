import { expect, test } from "bun:test";
import { filterInspirationHall } from "../src/lib/inspiration-hall";
import type { InspirationEntry } from "../src/services/api/inspirations";

const base = { version: 1, type: "prompt", title: "", description: "", mode: "image", category: "商品", prompt: "", sortOrder: 0, enabled: true } as const;
const entries: InspirationEntry[] = [
    { ...base, id: "1", title: "B", prompt: "蓝色花瓶", sortOrder: 2 },
    { ...base, id: "2", title: "A", mode: "video", category: "镜头", sortOrder: 1 },
    { ...base, id: "3", title: "C", mode: "text", description: "LOCAL 文本", sortOrder: 3 },
];

test("灵感大厅只按类型、分类和搜索筛选，兼容文本与工具条目", () => {
    expect(filterInspirationHall(entries, "all", "all", "", "default").map((item) => item.id)).toEqual(["2", "1", "3"]);
    expect(filterInspirationHall(entries, "image", "商品", "蓝色", "default").map((item) => item.id)).toEqual(["1"]);
    expect(filterInspirationHall(entries, "video", "商品", "", "default")).toEqual([]);
    expect(filterInspirationHall(entries, "text", "all", " local ", "default").map((item) => item.id)).toEqual(["3"]);
    const tool: InspirationEntry = { ...base, id: "tool", type: "tool", toolId: "existing", title: "工具", prompt: "" };
    expect(filterInspirationHall([tool], "image", "all", "工具", "default")).toEqual([tool]);
});

test("标题排序不改写原始列表，空目录保持空白", () => {
    const original = entries.map((item) => item.id);
    expect(filterInspirationHall(entries, "all", "all", "", "title").map((item) => item.title)).toEqual(["A", "B", "C"]);
    expect(entries.map((item) => item.id)).toEqual(original);
    expect(filterInspirationHall([], "all", "all", "", "default")).toEqual([]);
});
