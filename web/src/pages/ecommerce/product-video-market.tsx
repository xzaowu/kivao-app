import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { languages } from "./catalog";
import "./product-video-market.css";

const markets = ["中国大陆", "中国香港", "中国台湾", "美国", "英国", "法国", "德国", "西班牙", "日本", "韩国", "新加坡", "马来西亚", "印度尼西亚", "泰国", "巴西", "墨西哥", "阿联酋"];

export function ProductVideoMarket({
    region,
    language,
    ratioSummary,
    disabled,
    onRegion,
    onLanguage,
    children,
}: {
    region: string;
    language: string;
    ratioSummary: string;
    disabled: boolean;
    onRegion: (region: string) => void;
    onLanguage: (language: string) => void;
    children: ReactNode;
}) {
    const id = useId();
    const [expanded, setExpanded] = useState(false);
    const [custom, setCustom] = useState(Boolean(region && !markets.includes(region)));
    const other = custom || Boolean(region && !markets.includes(region));
    const summary = [region || "不限地区", languages.find(([key]) => key === language)?.[1] || language, ratioSummary].filter(Boolean).join(" · ");
    return (
        <div className="ec-video-market-panel">
            <button type="button" className="ec-video-market-toggle" aria-expanded={expanded} aria-controls={id + "-fields"} onClick={() => setExpanded(!expanded)}>
                <ChevronDown size={15} aria-hidden />
                <strong>投放设置</strong>
                <small title={summary}>{summary}</small>
            </button>
            <fieldset className="ec-video-market" id={id + "-fields"} disabled={disabled}>
                <legend>投放设置</legend>
                <div>
                    <label htmlFor={id + "-region"}>市场地区</label>
                    <select
                        name="marketRegion"
                        id={id + "-region"}
                        value={other ? "other" : region}
                        onChange={(event) => {
                            const value = event.currentTarget.value;
                            setCustom(value === "other");
                            onRegion(value === "other" ? "" : value);
                        }}
                    >
                        <option value="">不限地区</option>
                        {markets.map((name) => (
                            <option key={name}>{name}</option>
                        ))}
                        <option value="other">其他地区…</option>
                    </select>
                </div>
                <div>
                    <label htmlFor={id + "-language"}>成片语言</label>
                    <select name="outputLanguage" id={id + "-language"} value={language} onChange={(event) => onLanguage(event.currentTarget.value)}>
                        {language && !languages.some(([key]) => key === language) && <option value={language}>{language}</option>}
                        {languages.map(([key, name]) => (
                            <option key={key} value={key}>
                                {name}
                            </option>
                        ))}
                    </select>
                </div>
                {other && (
                    <div className="ec-video-market-custom">
                        <label htmlFor={id + "-custom"}>国家或地区名称</label>
                        <input id={id + "-custom"} value={region} maxLength={80} onChange={(event) => onRegion(event.currentTarget.value)} />
                    </div>
                )}
                {children}
            </fieldset>
        </div>
    );
}
