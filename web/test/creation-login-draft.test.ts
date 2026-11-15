import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("游客登录草稿交接与账号隔离", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/creation-login-draft.harness.ts"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("9 pass");
    expect(output).toContain("0 fail");
}, 35000);
