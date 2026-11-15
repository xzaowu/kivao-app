import { expect, test } from "bun:test";
import { resolve } from "node:path";
test("工作台草稿、场景确认和引用在真实页面组件内恢复", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/workbench-draft-recovery.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("12 pass");
    expect(output).toContain("0 fail");
}, 65000);
