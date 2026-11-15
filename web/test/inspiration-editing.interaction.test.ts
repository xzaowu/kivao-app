import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("灵感编辑支持明确清空并保持本地持久化和权限边界", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/inspiration-editing.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 45000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 50000);
