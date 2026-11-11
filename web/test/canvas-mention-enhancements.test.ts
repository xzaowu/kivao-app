import { expect, test } from "bun:test";

test("真实引用组件的边界、选区、延迟悬停、手机与节点开关回归", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-mention-enhancements.harness.tsx"], { cwd: import.meta.dir + "/..", timeout: 15000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
}, 20000);
