import { expect, spyOn, test } from "bun:test";
import { workbenchExamples, listWorkbenchTools, saveDefaultWorkbenchExamples } from "../src/services/api/workbench";
import { http } from "../src/services/api/request";

test("each example keeps its own caption; old examples are preserved and explicit empty lists stay empty", () => {
    const items = [
        { resourceId: "v1", kind: "video" as const, title: "同城到店", description: "独立说明" },
        { resourceId: "v2", kind: "video" as const, title: "另一作品" },
    ];
    expect(workbenchExamples({ items })).toEqual(items);
    expect(workbenchExamples({ title: "旧标题", description: "旧说明", imageResourceIds: ["image"], imageUrls: ["/image"], videoResourceId: "video", videoUrl: "/video" })).toEqual([
        { resourceId: "image", kind: "image", title: "旧标题", description: "旧说明", url: "/image" },
        { resourceId: "video", kind: "video", title: "旧标题", description: "旧说明", url: "/video" },
    ]);
    expect(workbenchExamples({ items: [], videoResourceId: "old" })).toEqual([]);
    expect(workbenchExamples()).toEqual([]);
});

test("default examples use their own workbench kind and persist resource identities without display URLs", async () => {
    const examples = { items: [{ resourceId: "default-video", kind: "video" as const, title: "默认示例", url: "/display" }] };
    const get = spyOn(http, "get").mockResolvedValue({ tools: [], defaultExamples: examples });
    const put = spyOn(http, "put").mockResolvedValue({ defaultExamples: examples });
    try {
        expect((await listWorkbenchTools("video")).defaultExamples).toEqual(examples);
        expect(await saveDefaultWorkbenchExamples("video", examples.items)).toEqual(examples);
        expect(put.mock.calls[0]).toEqual(["/admin/workbench/examples/video", { items: [{ resourceId: "default-video", kind: "video", title: "默认示例" }] }]);
    } finally {
        get.mockRestore();
        put.mockRestore();
    }
});
