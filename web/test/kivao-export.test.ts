import { expect, mock, test } from "bun:test";
import { createZip, readZip } from "../src/lib/zip";

let saved: Blob;
mock.module("file-saver", () => ({
    saveAs: (blob: Blob) => {
        saved = blob;
    },
}));
const { exportAssets, readAssetPackage } = await import("../src/pages/assets/asset-transfer");
const { exportCanvasProjects } = await import("../src/lib/canvas/canvas-export");

test("素材导出写入 kivao 且新包可重新导入", async () => {
    await exportAssets([]);
    const archive = await readZip(saved);
    const manifest = JSON.parse(await archive.get("assets.json")!.text());
    expect(manifest.app).toBe("kivao");
    expect(manifest.version).toBe(1);
    expect(await readAssetPackage(new File([saved], "assets.zip"))).toEqual([]);
});

test("原有素材包仍可读，未知应用标识被拒绝", async () => {
    for (const app of ["yingce", "unknown"]) {
        const zip = await createZip([{ name: "assets.json", data: JSON.stringify({ app, version: 1, assets: [], files: [] }) }]);
        const result = readAssetPackage(new File([zip], "assets.zip"));
        if (app === "yingce") expect(await result).toEqual([]);
        else await expect(result).rejects.toThrow("素材包格式或版本不受支持");
    }
});

test("画布导出写入 kivao 且保留当前版本", async () => {
    await exportCanvasProjects([]);
    const archive = await readZip(saved);
    const manifest = JSON.parse(await archive.get("projects.json")!.text());
    expect(manifest.app).toBe("kivao");
    expect(manifest.version).toBe(4);
    expect(manifest.projects).toEqual([]);
});
