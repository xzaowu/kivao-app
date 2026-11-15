import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const readProjectFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

// 首屏使用 KIVAO 默认图标；外观解析后继续由 use-appearance-store
// 应用后台自定义 Logo 和主题，不回退到上游的 /logo.svg。
describe("app icon bootstrap", () => {
    const indexHtml = readProjectFile("index.html");
    const appearanceStore = readProjectFile("src/stores/use-appearance-store.ts");

    test("index.html declares the KIVAO icon before the configured appearance is resolved", () => {
        expect(indexHtml).toContain('<link rel="icon" href="/kivao-mark.png" />');
        expect(indexHtml).not.toContain('<link rel="icon" href="/logo.svg"');
    });

    test("the appearance store remains the single writer of the favicon", () => {
        expect(appearanceStore).toContain('link[rel~="icon"]');
        expect(appearanceStore).toContain("favicon.href = appearanceLogoURL(");
    });
});
