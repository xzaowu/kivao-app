import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("积分中心复用短期配置并隔离账号，慢渠道和失败不阻塞套餐展示", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/wallet-payment-catalog.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 45000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 50000);
