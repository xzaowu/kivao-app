import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("插件分组与分类数量遵循现有可见性，并保留搜索及分类筛选", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/plugin-visibility.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
});
