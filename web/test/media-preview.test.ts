import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("作品示例保持原始比例，悬停预览与原生手动播放互不抢占", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/media-preview.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
});
