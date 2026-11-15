import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("视频地址恢复保留暂停意图，重新激活继续自动播放", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-video-recovery.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 35000);
