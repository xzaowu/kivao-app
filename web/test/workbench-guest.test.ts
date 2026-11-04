import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("游客可浏览图片和视频工作台，生成前要求登录且不读取个人任务", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/workbench-guest.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
});
