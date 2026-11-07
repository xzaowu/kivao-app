import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("视频预览保留加载后的原始比例，切换素材不沿用旧比例", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/inspiration-media.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
});
