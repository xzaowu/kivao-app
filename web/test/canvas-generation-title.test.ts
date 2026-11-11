import { expect, test } from "bun:test";
import { buildGenerationNodeTitle, buildImageGenerationNodeTitle } from "@/lib/canvas/canvas-generation-title";
import { canvasPromptSummaryText, canvasToolMentionToken } from "@/lib/canvas/canvas-resource-references";
import { CanvasNodeType } from "@/types/canvas";

test("生成标题去掉内部引用编码，保留可读工具名称和普通引用", () => {
    const prompt = `@[node:private-node] @[asset:private-asset] ${canvasToolMentionToken(1, "柔和光影", "style", "Sun")} 用@图片1创作 @[skill:private-skill] @[attachment:private-file]`;
    expect(canvasPromptSummaryText(prompt)).toBe("柔和光影 用@图片1创作");
    expect(buildGenerationNodeTitle(prompt, "图片")).toBe("柔和光影 用@图片1创作");
    expect(buildGenerationNodeTitle("@[asset:private-asset]", "视频")).toBe("视频");
    expect(buildGenerationNodeTitle("a".repeat(60), "文本")).toHaveLength(32);
    expect(prompt).toContain("@[asset:private-asset]");
});

test("图片标题保留副本、版本与批次后缀", () => {
    const source = { id: "image", type: CanvasNodeType.Image, title: "Old_copy2 · B", position: { x: 0, y: 0 }, width: 100, height: 100 };
    expect(buildImageGenerationNodeTitle("@[node:id] New prompt", source, 1, 3)).toBe("New prompt_copy2 · B · 2");
});
