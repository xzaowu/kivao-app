import { Button, Input } from "antd";
import { BookOpen, ChevronDown, Plus, Check } from "lucide-react";
import { useId, useRef, useState } from "react";
import "./product-facts.css";

const lines = (text: string) =>
    text
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean);
const same = (left: string[], right: string[]) => left.length === right.length && left.every((item, index) => item === right[index]);
export type SaveProductFacts = (items: string[], original: string[]) => Promise<void>;

type Props = {
    saved?: string[];
    current: string;
    onUse: (value: string) => void;
    onSave: SaveProductFacts;
    disabled?: boolean;
};

export function ProductFactsPanel({ saved = [], current, onUse, onSave, disabled }: Props) {
    const id = useId();
    const [editor, setEditor] = useState<{ original: string[]; text: string } | null>(null);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const lock = useRef(false);
    const used = lines(current);
    const selected = lines(editor?.text || "");
    const candidates = [...new Set(used)].filter((item) => !editor?.original.includes(item) && Array.from(item).length <= 280);
    const issue = selected.length > 32 ? "每个商品项目最多保存 32 条卖点。" : selected.some((item) => Array.from(item).length > 280) ? "每条卖点最多 280 字。" : new Set(selected).size !== selected.length ? "有重复的卖点，请保留一条。" : "";
    async function save() {
        if (!editor || lock.current || disabled || issue) return;
        if (!same(saved, editor.original)) {
            setError("商品资料已更新，请取消编辑后重新打开。");
            return;
        }
        lock.current = true;
        setSaving(true);
        setMessage("");
        setError("");
        try {
            await onSave(selected, editor.original);
            setEditor(null);
            setMessage("商品资料已保存到项目。");
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "商品资料保存失败，请重试。");
        } finally {
            lock.current = false;
            setSaving(false);
        }
    }
    return (
        <details className="ec-product-facts">
            <summary>
                <BookOpen size={15} aria-hidden />
                <strong>商品资料</strong>
                {saved.length > 0 && <small>{saved.length} 条卖点</small>}
                <ChevronDown size={14} aria-hidden />
            </summary>
            {editor ? (
                <div className="ec-product-facts-body">
                    <label htmlFor={id}>
                        项目卖点 <small>每行一条</small>
                    </label>
                    <Input.TextArea
                        id={id}
                        value={editor.text}
                        disabled={saving || disabled}
                        autoSize={{ minRows: 2, maxRows: 6 }}
                        onChange={(event) => {
                            setEditor({ ...editor, text: event.target.value });
                            setError("");
                        }}
                        placeholder="例如：盒内有两个独立隔层"
                    />
                    {candidates.length > 0 && (
                        <fieldset disabled={saving || disabled}>
                            <legend>从本轮选入</legend>
                            {candidates.map((item) => (
                                <label key={item}>
                                    <input
                                        type="checkbox"
                                        checked={selected.includes(item)}
                                        onChange={(event) => setEditor({ ...editor, text: event.target.checked ? [...selected, item].join("\n") : selected.filter((value) => value !== item).join("\n") })}
                                    />
                                    <span>{item}</span>
                                </label>
                            ))}
                        </fieldset>
                    )}
                    {(issue || error) && <small role="alert">{issue || error}</small>}
                    <div className="ec-product-facts-actions">
                        <Button size="small" type="primary" loading={saving} disabled={disabled || Boolean(issue) || same(saved, selected)} onClick={() => void save()}>
                            保存到项目
                        </Button>
                        <Button
                            size="small"
                            type="text"
                            disabled={saving}
                            onClick={() => {
                                setEditor(null);
                                setError("");
                            }}
                        >
                            取消
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="ec-product-facts-body">
                    {saved.length ? (
                        <ul>
                            {saved.map((item) => {
                                const present = used.includes(item);
                                return (
                                    <li key={item}>
                                        <span>{item}</span>
                                        <Button
                                            size="small"
                                            type="text"
                                            aria-pressed={present}
                                            aria-label={`${present ? "从本轮移除" : "加入本轮"}：${item}`}
                                            disabled={disabled}
                                            icon={present ? <Check size={13} aria-hidden /> : <Plus size={13} aria-hidden />}
                                            onClick={() => {
                                                onUse(
                                                    present
                                                        ? current
                                                              .split(/\r?\n/)
                                                              .filter((line) => line.trim() !== item)
                                                              .join("\n")
                                                        : [current.trimEnd(), item].filter(Boolean).join("\n"),
                                                );
                                                setMessage("");
                                            }}
                                        >
                                            {present ? "本轮已用" : "加入本轮"}
                                        </Button>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <small>把已核实的商品卖点存在这里，做图片或视频时按需取用。</small>
                    )}
                    <div className="ec-product-facts-actions">
                        <Button
                            size="small"
                            disabled={disabled}
                            onClick={() => {
                                setEditor({ original: [...saved], text: saved.join("\n") });
                                setMessage("");
                                setError("");
                            }}
                        >
                            {saved.length ? "编辑商品资料" : "存入商品卖点"}
                        </Button>
                    </div>
                    {message && <small role="status">{message}</small>}
                </div>
            )}
        </details>
    );
}
