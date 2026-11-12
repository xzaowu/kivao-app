import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("游客素材与 Agent 登录前置、草稿及异步回调隔离", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/creation-guest-login.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
});
