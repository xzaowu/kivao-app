import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("商品视频工作台的选拍法、手改保护与草稿恢复", () => {
    const run = Bun.spawnSync([process.execPath, "test", "./test/fixtures/ecommerce-product-video-workspace.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60_000 });
    expect(run.exitCode, new TextDecoder().decode(run.stderr)).toBe(0);
}, 65_000);
