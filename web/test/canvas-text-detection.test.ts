import { expect, test } from "bun:test";

test("图片文字识别必须手动提交，能力与报价一致，切图后不接收旧结果", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-text-detection.harness.tsx"], { cwd: import.meta.dir + "/..", timeout: 15000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
}, 20000);
