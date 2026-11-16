import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("灵感目录渐进加载、封面优先和视频按需播放", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/inspiration-loading.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 45000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 50000);
