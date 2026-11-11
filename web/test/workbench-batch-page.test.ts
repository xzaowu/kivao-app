import { expect, test } from "bun:test";

test("真实工作台组件验证批量计数、回执恢复和续提，禁止真实网络调用", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/workbench-batch-page.harness.tsx"], { cwd: import.meta.dir + "/..", timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
}, 35000);
