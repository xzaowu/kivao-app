import { expect, test } from "bun:test";
import { resolve } from "node:path";

for (const fixture of ["asset-media-loading", "asset-picker-loading"]) {
    test(`${fixture}: 素材加载与回退交互`, () => {
        const result = Bun.spawnSync([process.execPath, "test", `./test/fixtures/${fixture}.harness.tsx`], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
        const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
        expect(result.exitCode, output).toBe(0);
        expect(output).toContain("0 fail");
    }, 35000);
}
