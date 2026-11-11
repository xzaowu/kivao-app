import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { GenerationTask } from "../src/services/api/task-center";
import { WorkbenchImageResults, workbenchImageResults } from "../src/pages/workbench/workbench-image-results";

test("同一任务的多张结果全部可见，列表预览和单图保留原行为", () => {
    const task = { previewUrl: "/first.png", resultJson: JSON.stringify({ images: [{ url: "/first.png" }, { dataUrl: "data:image/png;base64,AA==" }, { url: "https://example.test/third.png" }] }) } as GenerationTask;
    expect(workbenchImageResults(task)).toHaveLength(3);
    const html = renderToStaticMarkup(<WorkbenchImageResults task={task} src={task.previewUrl!} />);
    expect(html).toContain('aria-label="本任务 3 张图片"');
    expect(html.match(/<img /g)).toHaveLength(3);
    expect(html).toContain('alt="生成结果 3"');
    const summary = { previewUrl: "/first.png" } as GenerationTask;
    expect(renderToStaticMarkup(<WorkbenchImageResults task={summary} src={summary.previewUrl!} />)).not.toContain("workbench-result-images");
    expect(workbenchImageResults({ ...summary, resultJson: "invalid-json" })).toEqual(["/first.png"]);
    expect(workbenchImageResults({ resultJson: JSON.stringify({ images: [{ url: "javascript:alert(1)" }] }) } as GenerationTask)).toEqual([]);
});
