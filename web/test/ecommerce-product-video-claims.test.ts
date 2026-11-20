import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("卖点分析付费提交前登记回执，刷新后只核对原任务", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/ecommerce-product-video-claims.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
}, 35000);
