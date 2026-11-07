import { afterEach, expect, spyOn, test } from "bun:test";
import { http } from "../src/services/api/request";
import { saveInspiration, type InspirationExampleView } from "../src/services/api/inspirations";

const post = spyOn(http, "post");
afterEach(() => post.mockRestore());

test("保存多个示例时保留顺序，展示 URL 不进入持久化请求", async () => {
    post.mockResolvedValue({ item: { id: "saved" } });
    const examples: InspirationExampleView[] = [
        { resourceId: "second", mediaKind: "video", mediaUrl: "/display-only" },
        { resourceId: "third", mediaKind: "image" },
    ];
    await saveInspiration({ version: 0, type: "prompt", title: "测试", description: "", mode: "image", prompt: "商品图", category: "", sortOrder: 0, enabled: false, resourceId: "cover", mediaKind: "image", additionalExamples: examples });
    expect(post).toHaveBeenCalledTimes(1);
    const payload = post.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.resourceId).toBe("cover");
    expect(payload.additionalExamples).toEqual([
        { resourceId: "second", mediaKind: "video" },
        { resourceId: "third", mediaKind: "image" },
    ]);
    expect(JSON.stringify(payload)).not.toContain("display-only");
});
