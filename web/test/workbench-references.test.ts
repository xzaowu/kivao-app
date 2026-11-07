import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as resources from "../src/services/api/resources";
import * as images from "../src/services/image-storage";
import * as userScope from "../src/lib/user-scope";
import { resolveWorkbenchAsset, selectWorkbenchReferences, type WorkbenchMediaAsset } from "../src/pages/workbench/workbench-references";

const limits = { maxImages: 4, maxVideos: 1, maxAudios: 1 };
const image = (resourceId: string, slotKey?: string) => ({ kind: "image" as const, resourceId, slotKey });
const asset = (storageKey = "resource:existing") => ({ kind: "image", title: "商品原图", data: { storageKey, dataUrl: "", width: 2, height: 2, mimeType: "image/png", bytes: 1 } }) as WorkbenchMediaAsset;
const mocks: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
    mocks.splice(0).forEach((mock) => mock.mockRestore());
});

describe("workbench reference selection", () => {
    test("enforces slot type and capacity for both uploads and library references", () => {
        expect(selectWorkbenchReferences([image("b"), image("c"), { kind: "video", resourceId: "v" }], [image("a", "product")], ["image"], 2, limits, "product")).toEqual([image("b")]);
    });
    test("deduplicates one slot but allows the same image in another slot", () => {
        expect(selectWorkbenchReferences([image("a"), image("b"), image("b")], [image("a", "product")], ["image"], 4, limits, "product")).toEqual([image("b")]);
        expect(selectWorkbenchReferences([image("a")], [image("a", "product")], ["image"], 1, limits, "scene")).toEqual([image("a")]);
    });
    test("shares model limits across slots and enforces the total limit", () => {
        expect(selectWorkbenchReferences([image("b"), { kind: "video", resourceId: "v" }, { kind: "audio", resourceId: "s" }], [image("a", "other")], ["image", "video", "audio"], 5, { maxImages: 1, maxVideos: 1, maxAudios: 0 })).toEqual([
            { kind: "video", resourceId: "v" },
        ]);
        const current = Array.from({ length: 19 }, (_, i) => image(String(i)));
        expect(selectWorkbenchReferences([image("a"), image("b")], current, ["image"], 50, { ...limits, maxImages: 50 })).toHaveLength(1);
        expect(selectWorkbenchReferences([image("a")], [], ["image"], 0, limits)).toEqual([]);
    });
});

describe("workbench library resource identity", () => {
    test("reuses a saved resource without re-uploading or importing", async () => {
        const upload = spyOn(resources, "uploadResourceFile");
        const importing = spyOn(resources, "importResourceFromUrl");
        mocks.push(upload, importing);
        expect(await resolveWorkbenchAsset(asset())).toEqual({ resourceId: "existing", previewUrl: "/api/resources/existing/file" });
        expect(upload).not.toHaveBeenCalled();
        expect(importing).not.toHaveBeenCalled();
    });
    test("materializes a legacy local image through the existing upload service", async () => {
        const blob = new Blob(["image"], { type: "image/png" });
        const read = spyOn(images, "getImageBlob").mockResolvedValue(blob);
        const upload = spyOn(resources, "uploadResourceFile").mockResolvedValue({ id: "uploaded" } as resources.RemoteResource);
        mocks.push(read, upload);
        expect(await resolveWorkbenchAsset(asset("local-image"))).toEqual({ resourceId: "uploaded", previewUrl: "/api/resources/uploaded/file" });
        expect(upload.mock.calls[0]).toEqual([blob, "image", { width: 2, height: 2, durationMs: undefined, fileName: "商品原图" }]);
    });
    test("does not write after an account switch while reading local media", async () => {
        const read = spyOn(images, "getImageBlob").mockResolvedValue(new Blob(["image"]));
        const scope = spyOn(userScope, "getActiveUserScope").mockReturnValueOnce("user:a").mockReturnValue("user:b");
        const upload = spyOn(resources, "uploadResourceFile");
        mocks.push(read, scope, upload);
        await expect(resolveWorkbenchAsset(asset("local-image"))).rejects.toThrow("账号已切换");
        expect(upload).not.toHaveBeenCalled();
    });
    test("reports missing files instead of adding an empty resource ID", async () => {
        await expect(resolveWorkbenchAsset(asset(""))).rejects.toThrow("素材文件不可用");
    });
});
