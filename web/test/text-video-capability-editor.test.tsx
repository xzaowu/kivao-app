import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelCapabilityEditor } from "../src/components/model-capability-editor";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";

test("text video understanding is off by default in both editor layouts", () => {
    for (const section of ["all", "references"] as const) {
        const markup = renderToStaticMarkup(<ModelCapabilityEditor capability="text" section={section} />);
        expect(markup).toContain("支持视频识别");
        expect(markup).toContain('aria-checked="false"');
        expect(markup).not.toContain("最多识别视频数");
        expect(markup).not.toContain("单个视频上限 MB");
    }
});

test("saved nonzero video limits enable the control without a separate boolean", () => {
    const value = defaultModelCapabilityConfig();
    value.text!.references.maxVideos = 3;
    value.text!.references.maxVideoBytes = 5 * 1024 ** 2;
    for (const section of ["all", "references"] as const) {
        const markup = renderToStaticMarkup(<ModelCapabilityEditor capability="text" section={section} value={value} disabled />);
        expect(markup).toContain('aria-checked="true"');
        expect(markup).toContain("最多识别视频数");
        expect(markup).toContain('value="3"');
        expect(markup).toContain('value="5"');
        expect(markup).toContain("disabled");
    }
});
