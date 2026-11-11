import { strict as assert } from "node:assert";
import localforage from "localforage";
import { createZip } from "../../src/lib/zip";
import { setActiveUserScope } from "../../src/lib/user-scope";

const stores = new Map<string, Map<string, unknown>>();
let writes = 0;
let onWrite = () => {};
localforage.createInstance = ((options: { storeName: string }) => {
    const values = new Map<string, unknown>();
    stores.set(options.storeName, values);
    return {
        getItem: async (key: string) => values.get(key) ?? null,
        setItem: async (key: string, value: unknown) => {
            writes++;
            values.set(key, value);
            onWrite();
            return value;
        },
    } as never;
}) as typeof localforage.createInstance;
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "window", { value: { addEventListener: () => {}, removeEventListener: () => {}, setTimeout, clearTimeout, localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } } });
setActiveUserScope("target");
const { readAssetPackage } = await import("../../src/pages/assets/asset-transfer");
const { apiClient } = await import("../../src/services/api/request");
apiClient.defaults.adapter = async () => { throw new Error("Import must not request source account resources"); };

const kinds = ["image", "video", "audio", "model"];
const assets = kinds.map((kind) => ({
    id: kind, kind, title: kind, tags: [], createdAt: "", updatedAt: "", folderId: "source-folder", primaryVersionId: "source-version",
    coverUrl: `/api/resources/${kind}/file`,
    data: { storageKey: `resource:${kind}`, ...(kind === "image" ? { dataUrl: `/api/resources/${kind}/file`, width: 640, height: 480 } : { url: `/api/resources/${kind}/file` }) },
}));
const text = { id: "text", kind: "text", folderId: "source-folder", primaryVersionId: "source-version", data: { content: "Keep me" } };
const entity = { id: "entity", kind: "entity", data: { definition: { name: "Character" } } };
const files = kinds.map((kind) => ({ storageKey: `resource:${kind}`, path: `files/${kind}`, mimeType: kind === "model" ? "model/gltf-binary" : `${kind}/${kind === "image" ? "png" : kind === "video" ? "mp4" : "mpeg"}`, bytes: kind.length }));
async function archive(app: string, index = files) {
    const blob = await createZip([
        { name: "assets.json", data: JSON.stringify({ app, version: 1, assets: [...assets, { ...assets[0], id: "shared-image" }, text, entity], files: index }) },
        ...kinds.map((kind) => ({ name: `files/${kind}`, data: kind })),
    ]);
    return new File([blob], "assets.zip");
}
for (const app of ["kivao", "yingce"]) {
    const oldImageStore = stores.get("image_files")!;
    oldImageStore.set("resource:image", new Blob(["existing image"]));
    const imported = await readAssetPackage(await archive(app));
    for (const asset of imported) {
        assert.equal(asset.folderId, undefined);
        assert.equal(asset.primaryVersionId, undefined);
        if (asset.kind === "text" || asset.kind === "entity") continue;
        const key = asset.data.storageKey!;
        assert.match(key, /^(image|video|audio|file):target:/);
        assert.notEqual(key, `resource:${asset.kind}`);
        const blob = (asset.kind === "image" ? oldImageStore : stores.get("media_files")!).get(key) as Blob;
        assert.equal(await blob.text(), asset.kind);
        assert.match(asset.kind === "image" ? asset.data.dataUrl : asset.data.url, /^blob:/);
        assert.equal(asset.coverUrl, asset.kind === "image" ? asset.data.dataUrl : "");
    }
    assert.equal(await (oldImageStore.get("resource:image") as Blob).text(), "existing image");
    assert.deepEqual(imported[4]!.data, imported[0]!.data);
    assert.deepEqual(imported[5]!.data, text.data);
    assert.deepEqual(imported[6]!.data, entity.data);
    const again = await readAssetPackage(await archive(app));
    assert.notEqual((again[0]!.data as { storageKey: string }).storageKey, (imported[0]!.data as { storageKey: string }).storageKey);
}
const beforeInvalid = writes;
await assert.rejects(readAssetPackage(await archive("kivao", [...files, { ...files[0]!, path: "missing" }])), /缺少文件/);
await assert.rejects(readAssetPackage(await archive("kivao", files.map((file) => ({ ...file, bytes: 999 })))), /大小不匹配/);
assert.equal(writes, beforeInvalid);
onWrite = () => setActiveUserScope("other-account");
await assert.rejects(readAssetPackage(await archive("kivao")), /账号已切换/);
console.log("asset transfer regression passed");
