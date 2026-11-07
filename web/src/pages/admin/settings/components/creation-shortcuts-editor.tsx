import { Button, Form, Input, Select } from "antd";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { CREATION_SHORTCUT_ICONS, type CreationShortcut } from "@/lib/creation-shortcuts";

export function CreationShortcutsEditor({ value, onChange, disabled }: { value: CreationShortcut[]; onChange: (value: CreationShortcut[]) => void; disabled: boolean }) {
    const update = (index: number, key: keyof CreationShortcut, next: string) => onChange(value.map((item, i) => (i === index ? { ...item, [key]: next } : item)));
    const move = (index: number, delta: number) => {
        const next = [...value];
        [next[index], next[index + delta]] = [next[index + delta], next[index]];
        onChange(next);
    };
    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">最多 10 个。相同分组自动合并，按首次出现顺序展示；清空后不显示入口。编辑完成后点击页面顶部的保存。</p>
            {value.map((item, index) => (
                <div key={index} className="rounded-xl border border-border p-4" role="group" aria-label={`创作入口 ${index + 1}`}>
                    <div className="mb-3 flex items-center justify-between">
                        <strong>入口 {index + 1}</strong>
                        <div className="flex gap-1">
                            <Button type="text" icon={<ArrowUp className="size-4" />} aria-label={`上移入口 ${index + 1}`} disabled={disabled || index === 0} onClick={() => move(index, -1)} />
                            <Button type="text" icon={<ArrowDown className="size-4" />} aria-label={`下移入口 ${index + 1}`} disabled={disabled || index === value.length - 1} onClick={() => move(index, 1)} />
                            <Button type="text" danger icon={<Trash2 className="size-4" />} aria-label={`删除入口 ${index + 1}`} disabled={disabled} onClick={() => onChange(value.filter((_, i) => i !== index))} />
                        </div>
                    </div>
                    <Form layout="vertical" requiredMark={false} disabled={disabled}>
                        <div className="grid gap-x-4 sm:grid-cols-2">
                            <Form.Item label="分组">
                                <Input aria-label={`入口 ${index + 1} 分组`} maxLength={20} value={item.group} onChange={(e) => update(index, "group", e.target.value)} placeholder="例如：作图、做视频" />
                            </Form.Item>
                            <Form.Item label="标题">
                                <Input aria-label={`入口 ${index + 1} 标题`} maxLength={20} value={item.title} onChange={(e) => update(index, "title", e.target.value)} />
                            </Form.Item>
                            <Form.Item label="图标">
                                <Select
                                    aria-label={`入口 ${index + 1} 图标`}
                                    value={item.icon}
                                    onChange={(next) => update(index, "icon", next)}
                                    options={Object.entries(CREATION_SHORTCUT_ICONS).map(([value, option]) => ({
                                        value,
                                        label: (
                                            <span className="flex items-center gap-2">
                                                <option.icon className="size-4" />
                                                {option.label}
                                            </span>
                                        ),
                                    }))}
                                />
                            </Form.Item>
                            <Form.Item label="站内链接" extra="工作台：/toolbox/image 或 /toolbox/video，可追加 ?tool=工具ID；画布：/canvas 或 /canvas/画布ID；也支持 / 和 /skills。">
                                <Input aria-label={`入口 ${index + 1} 链接`} maxLength={512} value={item.target} onChange={(e) => update(index, "target", e.target.value)} placeholder="/toolbox/video?tool=工具ID" />
                            </Form.Item>
                        </div>
                    </Form>
                </div>
            ))}
            <Button icon={<Plus className="size-4" />} disabled={disabled || value.length >= 10} onClick={() => onChange([...value, { group: "创作工具", title: "", icon: "image", target: "/toolbox/image" }])}>
                添加入口（{value.length}/10）
            </Button>
        </div>
    );
}
