import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { BrandLogo } from "../src/components/brand/brand-logo";
import { DEFAULT_CANVAS_APPEARANCE } from "../src/lib/canvas/agent-appearance";
import { DEFAULT_CLASSIC_SKIN } from "../src/lib/skin-themes";
import { resolvePublicAppearance } from "../src/services/appearance-bootstrap";
import { appearanceLogoURL, brandStudioLabel, DEFAULT_PUBLIC_APPEARANCE, normalizePublicAppearance } from "../src/stores/use-appearance-store";

describe("KIVAO 默认品牌", () => {
    test("默认标题、Logo、英文标识和助手保持一致", () => {
        const appearance = normalizePublicAppearance();
        expect(appearance.brandName).toBe("KIVAO");
        expect(appearance.brandSlug).toBe("kivao");
        expect(appearance.seoTitle).toBe("KIVAO");
        expect(appearance.seoDescription).toContain("KIVAO");
        expect(appearance.footerCopyright).toContain("KIVAO");
        expect(appearanceLogoURL(appearance, "light")).toBe("/kivao-mark.png");
        expect(appearanceLogoURL(appearance, "dark")).toBe("/kivao-mark.png");
        expect(brandStudioLabel(appearance)).toBe("KIVAO STUDIO");
        expect(DEFAULT_CANVAS_APPEARANCE.agentName).toBe("KIVAO");
        expect(appearance.logoConfigured).toBe(false);
    });

    test("未上传自定义 Logo 时仍展示正式风筝图标", () => {
        const markup = renderToStaticMarkup(<BrandLogo alt="KIVAO" fallback={<span>neutral fallback</span>} />);
        expect(markup).toContain('src="/kivao-mark.png"');
        expect(markup).not.toContain("neutral fallback");
    });

    test("后台保存的品牌、深浅 Logo、SEO 和主题继续优先", () => {
        const appearance = normalizePublicAppearance({
            configured: true,
            brandName: "星野工作室",
            brandSlug: "xingye",
            logoConfigured: true,
            darkLogoConfigured: true,
            logoUrl: "/api/public/appearance/assets/logo?v=custom",
            darkLogoUrl: "/api/public/appearance/assets/logo-dark?v=custom",
            logoFrameEnabled: false,
            seoTitle: "星野 · 创作",
            seoDescription: "自定义站点描述",
            activeSkin: { ...DEFAULT_CLASSIC_SKIN, id: "custom-brand", name: "自定义主题" },
            canvas: { ...DEFAULT_CANVAS_APPEARANCE, agentName: "星野助手" },
        });
        expect(appearance.brandName).toBe("星野工作室");
        expect(appearance.brandSlug).toBe("xingye");
        expect(appearanceLogoURL(appearance, "light")).toContain("/assets/logo?");
        expect(appearanceLogoURL(appearance, "dark")).toContain("/assets/logo-dark?");
        expect(appearance.logoFrameEnabled).toBe(false);
        expect(appearance.seoTitle).toBe("星野 · 创作");
        expect(appearance.seoDescription).toBe("自定义站点描述");
        expect(appearance.skinId).toBe("custom-brand");
        expect(appearance.canvas.agentName).toBe("星野助手");
    });

    test("外观加载失败使用 KIVAO 默认值", async () => {
        const appearance = await resolvePublicAppearance(async () => {
            throw new Error("offline");
        });
        expect(appearance).toBe(DEFAULT_PUBLIC_APPEARANCE);
        expect(appearance.brandName).toBe("KIVAO");
    });
});
