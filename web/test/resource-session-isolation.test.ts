import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("上传、分片与媒体缓存绑定原会话，取消不补传", () => {
    // 模块和浏览器夹具仅在子进程替换，避免污染其他存储/画布测试。
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/resource-session-isolation.harness.ts"], { cwd: resolve(import.meta.dir, ".."), timeout: 60000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 65000);
