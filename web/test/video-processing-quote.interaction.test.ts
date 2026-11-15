import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("视频处理报价失败、重试、迟到响应及模型替换边界", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/video-processing-quote.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 45000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 50000);
