import { expect, test } from "bun:test";

test("图片结果按真实任务摘要补读详情，隔离切换、错误重试和卸载", () => {
    const run = Bun.spawnSync([process.execPath, "test", "./test/fixtures/workbench-image-results-load.harness.tsx"], { cwd: import.meta.dir + "/..", timeout: 30000 });
    const output = new TextDecoder().decode(run.stdout) + new TextDecoder().decode(run.stderr);
    expect(run.exitCode, output).toBe(0);
}, 35000);
