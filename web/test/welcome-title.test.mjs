import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("welcome entry loads configured appearance", async () => {
    let calls = 0;
    const imports = [];
    const main = source("../src/main.tsx")
        .replace(/^import .*;\n/gm, "")
        .replace(/import\.meta\.env\.DEV/g, "false")
        .replace(/import\(/g, "loadModule(");
    vm.runInNewContext(main, {
        window: { location: { pathname: "/welcome" } },
        installChunkRecovery() {},
        isIsolatedDirectorRepro: () => false,
        bootstrapAppearance: async () => {
            calls++;
        },
        loadModule: async (name) => {
            imports.push(name);
        },
    });
    await Promise.resolve();
    assert.equal(calls, 1, "welcome entry must bootstrap appearance");
    assert.deepEqual(imports, ["./welcome-application"]);
});

test("welcome effects preserve configured SEO title", () => {
    const page = source("../src/pages/welcome/index.tsx");
    // Run the actual mount effects with inert motion/scroll listeners.
    const effects = [...page.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n    \}, \[([^\]]*)\]\);/g)].filter((match) => match[2] === "");
    assert.ok(effects.length > 0);
    for (const title of ["Custom SEO Title", "Custom Site Name"]) {
        const document = { title };
        const cleanups = [];
        let dialogOpened = 0;
        let dialogClosed = 0;
        const dialogRef = {
            current: {
                showModal() {
                    dialogOpened++;
                },
                close() {
                    dialogClosed++;
                },
            },
        };
        for (const [, body] of effects) {
            const cleanup = vm.runInNewContext(`(() => {${body}\n})()`, {
                document,
                dialogRef,
                window: { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} },
                storyRef: { current: null },
                restorePickerFocus: { current: false },
                setReduced() {},
                setLook() {},
                getWelcomeLook() {},
            });
            if (typeof cleanup === "function") cleanups.push(cleanup);
            assert.equal(document.title, title, "welcome must preserve appearance metadata title");
        }
        assert.equal(dialogOpened, 1, "film dialog mount effect must be exercised");
        for (const cleanup of cleanups.reverse()) cleanup();
        assert.equal(dialogClosed, 1, "film dialog cleanup must be exercised");
        assert.equal(document.title, title, "welcome cleanup must preserve appearance metadata title");
    }
});
