import { expect, test } from "bun:test";

test("素材包在目标账号重建资源、保留 KIVAO/旧包格式并在损坏或切号时拒绝导入", async () => {
    const child = Bun.spawn([process.execPath, "run", "./test/helpers/asset-transfer.worker.ts"], { cwd: import.meta.dir + "/..", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(stdout).toContain("asset transfer regression passed");
});
