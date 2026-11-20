import { useId } from "react";
import { workbenchRatioUsage } from "@/pages/workbench/workbench-presets";
import type { productVideoRatio } from "./product-video";

function ratioLabel(value: string) {
    if (value === "auto") return "由模型决定";
    if (value === "adaptive") return "自适应（跟随素材）";
    const usage = workbenchRatioUsage("video", value);
    return usage ? `${value} · ${usage.label}` : value;
}

export function ProductVideoRatioField({ selection, disabled, onChange, emptyLabel = "选择视频模型后显示" }: { selection: ReturnType<typeof productVideoRatio>; disabled: boolean; onChange: (value: string) => void; emptyLabel?: string }) {
    const id = useId();
    const { options, value, unavailable } = selection;
    return (
        <div className="ec-video-ratio-field">
            <label htmlFor={id}>视频比例</label>
            <select
                id={id}
                name="videoRatio"
                value={value}
                disabled={disabled || !options.length || (options.length === 1 && !unavailable)}
                aria-invalid={Boolean(unavailable) || undefined}
                aria-describedby={unavailable ? id + "-error" : undefined}
                onChange={(event) => onChange(event.currentTarget.value)}
            >
                {!options.length && <option value="">{emptyLabel}</option>}
                {unavailable && (
                    <option value="" disabled>
                        请重新选择比例
                    </option>
                )}
                {options.map((ratio) => (
                    <option key={ratio} value={ratio}>
                        {ratioLabel(ratio)}
                    </option>
                ))}
            </select>
            {unavailable && (
                <small id={id + "-error"} role="status">
                    当前模型不支持原画幅「{ratioLabel(unavailable)}」，请选择可用比例。
                </small>
            )}
        </div>
    );
}
