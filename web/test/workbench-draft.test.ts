import { afterEach, expect, test } from "bun:test";
import { setActiveUserScope } from "../src/lib/user-scope";
import { getWorkbenchDraft, hasMissingWorkbenchMentions, withoutRemovedWorkbenchMentions } from "../src/pages/workbench/workbench-draft";
import type { WorkbenchReference } from "../src/pages/workbench/workbench-composer";

const reference: WorkbenchReference = { id: "image-one", name: "hello", kind: "image", previewUrl: "", uploading: true, progress: 0, role: "reference" };
afterEach(() => setActiveUserScope(null));

test("本标签页的图片与视频草稿分别保存内容、素材及参数", () => {
    setActiveUserScope("draft-test-one");
    const image = getWorkbenchDraft("image");
    image.setField("prompt", "图片草稿");
    image.setField("references", [reference]);
    image.setField("ratio", "3:4");
    image.setField("count", 4);
    const video = getWorkbenchDraft("video");
    video.setField("prompt", "视频草稿");
    video.setField("seconds", "15");
    expect(getWorkbenchDraft("image").store.getState()).toMatchObject({ prompt: "图片草稿", references: [reference], ratio: "3:4", count: 4 });
    expect(getWorkbenchDraft("video").store.getState()).toMatchObject({ prompt: "视频草稿", seconds: "15" });
});

test("离开期间上传完成仅补对应素材，不覆盖返回后编辑的描述或复活已删素材", () => {
    setActiveUserScope("draft-test-two");
    const prior = getWorkbenchDraft("image");
    prior.setField("references", [reference]);
    const reopened = getWorkbenchDraft("image");
    reopened.setField("prompt", "返回后编辑");
    prior.setField("references", (items) => items.map((item) => (item.id === reference.id ? { ...item, uploading: false, resourceId: "uploaded" } : item)));
    expect(reopened.store.getState()).toMatchObject({ prompt: "返回后编辑", references: [{ resourceId: "uploaded", uploading: false }] });
    reopened.setField("references", []);
    prior.setField("references", (items) => items.map((item) => (item.id === reference.id ? { ...item, resourceId: "late" } : item)));
    expect(reopened.store.getState().references).toEqual([]);
});

test("切换账号清空草稿，旧上传回调不能写入新账号，返回旧账号也不带回旧草稿", () => {
    setActiveUserScope("draft-test-a");
    const previous = getWorkbenchDraft("image");
    previous.setField("prompt", "账号 A");
    setActiveUserScope("draft-test-b");
    const current = getWorkbenchDraft("image");
    previous.setField("prompt", "迟到内容");
    previous.setField("references", [reference]);
    expect(current.store.getState()).toMatchObject({ prompt: "", references: [] });
    expect(previous.store.getState().prompt).toBe("账号 A");
    setActiveUserScope("draft-test-a");
    expect(getWorkbenchDraft("image").store.getState().prompt).toBe("");
});

test("移除仅清理对应结构化引用，普通 @文字和其它素材引用保留", () => {
    const prompt = "联系 @hello 看 @[node:image-one]，对比 @[node:image-two] 与 @hello-world";
    expect(withoutRemovedWorkbenchMentions(prompt, [reference])).toBe("联系 @hello 看 ，对比 @[node:image-two] 与 @hello-world");
    expect(hasMissingWorkbenchMentions(prompt, [reference])).toBe(true);
    expect(hasMissingWorkbenchMentions("@[node:image-one] 与 @hello", [reference])).toBe(false);
    expect(hasMissingWorkbenchMentions("@hello @[skill:skill]", [])).toBe(false);
});
