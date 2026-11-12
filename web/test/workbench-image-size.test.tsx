import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageSizePicker } from "../src/components/image-size-picker";
import { ImageParameterFields } from "../src/components/image-parameter-fields";
import { projectImageParameters, type ImageParameter } from "../src/lib/image-parameters";
import { defaultImageCapabilityConfig } from "../src/lib/model-capabilities";
import type { AiConfig } from "../src/stores/use-config-store";
import { imageDeclaredSizePresets, imagePresetForRatio } from "../src/lib/image-size-presets";

const ratios = ["1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "21:9"];
const parameters: ImageParameter[] = [
    { name: "size", label: "画面比例", type: "string", values: ratios, default: "1:1", binding: "aspectRatio", enabled: true },
    { name: "imageResolution", label: "分辨率", type: "string", values: ["1K", "2K", "4K"], default: "1K", binding: "resolution", pricing: true, enabled: true },
    { name: "count", label: "生成张数", type: "integer", min: 1, max: 1, default: 1, binding: "imageCount", enabled: true },
];

function profile(fields = parameters) {
    const base = defaultImageCapabilityConfig();
    return projectImageParameters({ ...base, size: { ...base.size, parameter: "aspect_ratio" } }, fields);
}

describe("工作台声明式图片尺寸", () => {
    test("没有像素预设时显示声明的比例与大写分辨率", () => {
        const html = renderToStaticMarkup(<ImageSizePicker profile={profile()} size="16:9" imageResolution="2K" declaredSizeOptions onChange={() => {}} />);
        expect((html.match(/class="image-size-ratio-icon"/g) || []).length).toBe(10);
        for (const ratio of ratios) expect(html).toContain(`<span>${ratio}</span>`);
        expect(html).toMatch(/title="16:9 · 2752 × 1536" aria-pressed="true"/);
        expect(html).not.toContain("未配置预设尺寸");
    });

    test("精确声明的非约分和超宽比例均可选择", () => {
        const custom = profile([{ ...parameters[0], values: ["auto", "9:21", "4:1", "8:1"] }, parameters[1]]);
        const html = renderToStaticMarkup(<ImageSizePicker profile={custom} size="9:21" imageResolution="2K" declaredSizeOptions onChange={() => {}} />);
        for (const ratio of ["9:21", "4:1", "8:1"]) expect(html).toContain(`<span>${ratio}</span>`);
        expect(html).toContain(">自动尺寸<");
        expect(html).not.toContain("<span>3:7</span>");
    });

    test("等价比例的声明枚举只高亮实际选择的一项", () => {
        const custom = profile([{ ...parameters[0], values: ["9:21", "3:7"] }, parameters[1]]);
        const html = renderToStaticMarkup(<ImageSizePicker profile={custom} size="9:21" imageResolution="2K" declaredSizeOptions onChange={() => {}} />);
        expect(html.match(/title="9:21[^\"]*" aria-pressed="true"/g)).toHaveLength(1);
        expect(html).toMatch(/title="3:7[^\"]*" aria-pressed="false"/);
    });

    test("未启用工作台选项的组件保留原逐字段行为", () => {
        const plain = renderToStaticMarkup(<ImageSizePicker profile={profile()} size="16:9" imageResolution="2K" onChange={() => {}} />);
        expect(plain).toContain("未配置预设尺寸");
        const fields = renderToStaticMarkup(<ImageParameterFields profile={profile()} config={{} as AiConfig} onChange={() => {}} />);
        expect(fields).toContain('role="group" aria-label="画面比例"');
        expect(fields).not.toContain("未配置预设尺寸");
    });

    test("禁用比例、未知档位和已有预设不会被合成规则扩展", () => {
        const disabled = profile([{ ...parameters[0], enabled: false }, parameters[1]]);
        expect(imageDeclaredSizePresets(disabled)).toEqual([]);
        const unknown = profile([parameters[0], { ...parameters[1], values: ["large"], default: "large" }]);
        expect(imageDeclaredSizePresets(unknown)).toEqual([]);
        const explicit = profile();
        explicit.size.presets = [imagePresetForRatio("2k", "1:1")];
        expect(imageDeclaredSizePresets(explicit)).toEqual([]);
        const html = renderToStaticMarkup(<ImageSizePicker profile={explicit} size="1:1" imageResolution="2K" declaredSizeOptions onChange={() => {}} />);
        expect((html.match(/class="image-size-ratio-icon"/g) || []).length).toBe(1);
    });
});
