import { Button } from "antd";
import { Check, ChevronDown, X } from "lucide-react";
import { GlobeIcon } from "@/components/ui/ecommerce-icons";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { commercePlatformGroups, labelOf, languageVisuals, languages, platforms } from "./catalog";
import { commerceKnowledgeFor, commercePlatformKnowledge } from "./platform-knowledge";
import "./market-picker.css";

export function PlatformMark({ platform }: { platform: string }) {
    return <img className="commerce-platform-logo" data-monochrome={["amazon", "tiktok", "douyin", "ozon", "dewu"].includes(platform)} src={`/commerce/platforms/${platform}.svg`} alt="" width={28} height={28} />;
}

export function LanguageFlag({ language }: { language: string }) {
    const flag = languageVisuals[language]?.flag;
    return flag ? <img className="commerce-language-flag" src={`/commerce/flags/${flag}.svg`} alt="" width={20} height={15} /> : <GlobeIcon size={16} />;
}

const groups = [
    ["domestic", "中文电商"],
    ["crossBorder", "跨境电商"],
] as const;

export function CommerceMarketPicker({
    platform,
    language,
    region,
    onPlatform,
    onLanguage,
    onRegion,
    onClose,
}: {
    platform: string;
    language: string;
    region: string;
    onPlatform: (value: string) => void;
    onLanguage: (value: string) => void;
    onRegion: (value: string) => void;
    onClose: () => void;
}) {
    const [languageOpen, setLanguageOpen] = useState(false);
    const optionsId = useId();
    const languageTrigger = useRef<HTMLButtonElement>(null);
    const languageOptions = useRef<HTMLDivElement>(null);
    const knowledge = commerceKnowledgeFor(platform);
    const [placement, setPlacement] = useState<CSSProperties>();

    useLayoutEffect(() => {
        const trigger = document.getElementById("ec-photo-market-trigger");
        if (!trigger) return;
        const updatePlacement = () => {
            const rect = trigger.getBoundingClientRect();
            const above = rect.top - 20;
            const below = window.innerHeight - rect.bottom - 20;
            if (window.innerWidth < 720 || !rect.height || Math.max(above, below) < 300) {
                setPlacement(undefined);
                return;
            }
            const opensAbove = above >= below;
            setPlacement({
                position: "fixed",
                left: Math.max(12, Math.min(rect.left, window.innerWidth - 496 - 12)),
                top: opensAbove ? "auto" : rect.bottom + 8,
                bottom: opensAbove ? window.innerHeight - rect.top + 8 : "auto",
                margin: 0,
                padding: 0,
                "--ec-market-room": `${opensAbove ? above : below}px`,
            } as CSSProperties);
        };
        updatePlacement();
        window.addEventListener("resize", updatePlacement);
        return () => window.removeEventListener("resize", updatePlacement);
    }, []);

    function dismiss() {
        onClose();
        document.getElementById("ec-photo-market-trigger")?.focus({ preventScroll: true });
    }

    function closeLanguageOptions() {
        setLanguageOpen(false);
        languageTrigger.current?.focus({ preventScroll: true });
    }

    useEffect(() => {
        if (!languageOpen) return;
        languageOptions.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
        const closeOnOutsideClick = (event: MouseEvent) => {
            const target = event.target;
            if (target instanceof Node && !languageTrigger.current?.contains(target) && !languageOptions.current?.contains(target)) setLanguageOpen(false);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.isComposing) return;
            event.preventDefault();
            event.stopPropagation();
            closeLanguageOptions();
        };
        document.addEventListener("click", closeOnOutsideClick);
        document.addEventListener("keydown", closeOnEscape, true);
        return () => {
            document.removeEventListener("click", closeOnOutsideClick);
            document.removeEventListener("keydown", closeOnEscape, true);
        };
    }, [languageOpen]);

    return (
        <AppModal
            open
            flush
            closable={false}
            keyboard={!languageOpen}
            footer={null}
            width="min(496px, calc(100vw - 24px))"
            onCancel={dismiss}
            centered={!placement}
            style={placement}
            styles={placement ? { mask: { background: "transparent", backdropFilter: "none" } } : undefined}
            className="commerce-market-modal"
        >
            <section className="commerce-market" role="dialog" aria-label="电商平台与语言" data-canvas-no-zoom>
                <header className="commerce-market-head">
                    <h2>投放平台</h2>
                    <button type="button" className="commerce-market-close" aria-label="关闭参数" onClick={dismiss}>
                        <X size={16} />
                    </button>
                </header>
                <div className="commerce-market-body" data-canvas-wheel-scroll>
                    <div className="commerce-market-fields">
                        <div className="commerce-market-field">
                            <h3>输出语言</h3>
                            <button
                                ref={languageTrigger}
                                className="commerce-language-trigger"
                                type="button"
                                aria-haspopup="listbox"
                                aria-label={`输出语言 · ${labelOf(languages, language)}`}
                                aria-expanded={languageOpen}
                                aria-controls={languageOpen ? optionsId : undefined}
                                onClick={() => setLanguageOpen((open) => !open)}
                                onKeyDown={(event) => {
                                    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                                    event.preventDefault();
                                    setLanguageOpen(true);
                                }}
                            >
                                <LanguageFlag language={language} />
                                <strong>{languageVisuals[language]?.label || labelOf(languages, language)}</strong>
                                <ChevronDown size={14} className={languageOpen ? "is-open" : ""} />
                            </button>
                        </div>
                        <label className="commerce-market-field">
                            <h3>目标地区（可选）</h3>
                            <input aria-label="目标国家或地区" value={region} maxLength={80} placeholder="例如：美国、日本" onChange={(event) => onRegion(event.target.value)} />
                        </label>
                    </div>
                    {languageOpen ? (
                        <div
                            ref={languageOptions}
                            id={optionsId}
                            className="commerce-language-options"
                            role="listbox"
                            aria-label="输出语言"
                            onKeyDown={(event) => {
                                const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
                                let next = options.indexOf(event.target as HTMLButtonElement);
                                switch (event.key) {
                                    case "ArrowDown":
                                        next++;
                                        break;
                                    case "ArrowUp":
                                        next--;
                                        break;
                                    case "Home":
                                        next = 0;
                                        break;
                                    case "End":
                                        next = options.length - 1;
                                        break;
                                    default:
                                        return;
                                }
                                event.preventDefault();
                                options[(next + options.length) % options.length]?.focus();
                            }}
                        >
                            {languages.map(([id, label]) => (
                                <button
                                    type="button"
                                    key={id}
                                    role="option"
                                    aria-selected={language === id}
                                    onClick={() => {
                                        onLanguage(id);
                                        closeLanguageOptions();
                                    }}
                                >
                                    <LanguageFlag language={id} />
                                    <strong>{languageVisuals[id]?.label || label}</strong>
                                    {language === id ? <Check size={14} /> : null}
                                </button>
                            ))}
                        </div>
                    ) : null}
                    {groups.map(([group, title]) => (
                        <section key={group} className="commerce-market-group">
                            <h3>{title}</h3>
                            <div className="commerce-market-grid">
                                {commercePlatformGroups[group].map((id) => (
                                    <button
                                        type="button"
                                        key={id}
                                        className={platform === id ? "is-selected" : ""}
                                        aria-pressed={platform === id}
                                        title={labelOf(platforms, id)}
                                        onClick={() => {
                                            onPlatform(id);
                                            dismiss();
                                        }}
                                    >
                                        <span className="commerce-market-logo" aria-hidden="true">
                                            <PlatformMark platform={id} />
                                        </span>
                                        <span className="commerce-market-name">{labelOf(platforms, id)}</span>
                                    </button>
                                ))}
                            </div>
                        </section>
                    ))}
                    {knowledge ? (
                        <details className="commerce-market-rules" aria-label="所选平台图片规则">
                            <summary>{labelOf(platforms, platform)} 的图片与内容要求</summary>
                            <div>
                                {[knowledge.style, knowledge.risk, knowledge.scope].filter(Boolean).map((text) => (
                                    <p key={text}>{text}</p>
                                ))}
                                {knowledge.officialRules.length ? (
                                    <ul>
                                        {knowledge.officialRules.map((rule) => (
                                            <li key={rule}>{rule}</li>
                                        ))}
                                    </ul>
                                ) : null}
                                <p className="commerce-market-source">
                                    {knowledge.reviewStatus === "pending" ? "详细规则待官方后台核实" : `已核对部分公开资料 · ${knowledge.checkedAt}`}
                                    {knowledge.sources.map((url, index) => (
                                        <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                                            官方资料 {index + 1}
                                        </a>
                                    ))}
                                </p>
                                <p className="commerce-market-source">
                                    通用风险词示例：{commercePlatformKnowledge.restrictedPhrases.join("、")}（非完整官方禁词表）。{commercePlatformKnowledge.boundary}
                                </p>
                            </div>
                        </details>
                    ) : null}
                </div>
                <footer className="commerce-market-foot">
                    <span>
                        当前：{labelOf(platforms, platform)} · {languageVisuals[language]?.label || labelOf(languages, language)}
                        {region.trim() ? ` · ${region.trim()}` : ""}
                    </span>
                    <Button type="primary" onClick={dismiss}>
                        完成
                    </Button>
                </footer>
            </section>
        </AppModal>
    );
}
