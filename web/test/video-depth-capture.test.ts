import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("深度动作捕捉面板、草稿、连线及重试边界（模拟上游）", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/video-depth-capture.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
}, 35_000);
