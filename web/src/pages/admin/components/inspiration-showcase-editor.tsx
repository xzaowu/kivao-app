import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Input, Select, Switch } from "antd";
import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { AppModal } from "@/components/ui/product/app-modal";
import { catalogIdOf } from "@/lib/inspirations/catalog";
import { getInspirationShowcases, inspirationExamplePreviewURL, inspirationShowcasesQueryKey, saveInspirationShowcase, uploadInspirationExample, type InspirationExample, type InspirationShowcase } from "@/services/api/inspiration-showcases";
import { loadInspirationCatalog } from "@/services/inspiration-catalog";

export function InspirationShowcaseEditor({ onClose }: { onClose: () => void }) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const catalog = useQuery({ queryKey: ["admin", "inspiration-catalog"], queryFn: () => loadInspirationCatalog() });
    const settings = useQuery({ queryKey: ["admin", "inspiration-showcases"], queryFn: ({ signal }) => getInspirationShowcases(true, signal) });
    const [draft, setDraft] = useState<InspirationShowcase | null>(null);
    const [busy, setBusy] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const options = useMemo(() => {
        const entries = new Map((catalog.data?.entries ?? []).map((item) => [catalogIdOf(item), item.title]));
        for (const item of settings.data ?? []) if (!entries.has(item.inspirationId)) entries.set(item.inspirationId, `${item.title}（目录中已移除）`);
        return [...entries].map(([value, title]) => ({ value, label: title }));
    }, [catalog.data, settings.data]);

    const changeExample = (index: number, patch: Partial<InspirationExample>) => {
        setDraft((current) => (current ? { ...current, examples: current.examples.map((item, i) => (i === index ? { ...item, ...patch } : item)) } : current));
    };
    const moveExample = (index: number, direction: -1 | 1) => {
        setDraft((current) => {
            if (!current || !current.examples[index + direction]) return current;
            const examples = [...current.examples];
            [examples[index], examples[index + direction]] = [examples[index + direction], examples[index]];
            return { ...current, examples };
        });
    };
    const upload = async (file: File) => {
        if (!draft || draft.examples.length >= 10) return;
        const type = file.type.startsWith("video/") || /\.(mp4|webm)$/i.test(file.name) ? "video" : "image";
        const limit = type === "video" ? 256 : 10;
        if (file.size > limit * 1024 * 1024) {
            message.error(`文件不能超过 ${limit} MB`);
            return;
        }
        setBusy(true);
        try {
            const resource = await uploadInspirationExample(type, file);
            setDraft((current) => (current ? { ...current, examples: [...current.examples, { resourceId: resource.id, type: resource.kind, title: "", description: "", mediaUrl: inspirationExamplePreviewURL(resource.id) }] } : current));
            message.success("上传成功，保存后生效");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "上传失败");
        } finally {
            setBusy(false);
        }
    };
    const save = async () => {
        if (!draft) return;
        setBusy(true);
        try {
            await saveInspirationShowcase(draft);
            await Promise.all([settings.refetch(), queryClient.invalidateQueries({ queryKey: inspirationShowcasesQueryKey })]);
            message.success("作品示例已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            setBusy(false);
        }
    };

    const loadError = catalog.error || settings.error;
    return (
        <AppModal
            open
            title="灵感作品示例"
            width={800}
            onCancel={busy ? undefined : onClose}
            maskClosable={!busy}
            closable={!busy}
            footer={
                <>
                    <Button disabled={busy} onClick={onClose}>
                        关闭
                    </Button>
                    <Button type="primary" disabled={!draft || Boolean(loadError) || (draft.enabled && !draft.examples.length)} loading={busy} onClick={() => void save()}>
                        保存
                    </Button>
                </>
            }
        >
            <div className="flex max-h-[65dvh] flex-col gap-4 overflow-y-auto">
                <p className="text-xs text-foreground/60">图片封面及上游视频自动作为示例。此处可上传自有作品，保存并开启公开显示后优先使用；关闭后恢复目录示例。首个自有示例用于瀑布流封面，每条最多 10 个，图片 ≤10 MB，视频 ≤256 MB。</p>
                {loadError ? (
                    <p role="alert">
                        {loadError instanceof Error ? loadError.message : "读取配置失败"}
                        <Button
                            onClick={() => {
                                void catalog.refetch();
                                void settings.refetch();
                            }}
                        >
                            重试
                        </Button>
                    </p>
                ) : null}
                <Select
                    aria-label="选择灵感"
                    placeholder="搜索灵感标题"
                    showSearch
                    optionFilterProp="label"
                    options={options}
                    loading={catalog.isPending || settings.isPending}
                    disabled={busy || settings.isPending || Boolean(loadError)}
                    value={draft?.inspirationId}
                    onChange={(id) => {
                        const saved = settings.data?.find((item) => item.inspirationId === id);
                        setDraft(saved ? structuredClone(saved) : { inspirationId: id, title: options.find((item) => item.value === id)?.label ?? id, enabled: false, examples: [] });
                    }}
                />
                {draft ? (
                    <>
                        <label className="flex items-center gap-3 text-sm">
                            <Switch aria-label="公开显示作品示例" checked={draft.enabled} disabled={busy} onChange={(enabled) => setDraft({ ...draft, enabled })} />
                            公开显示作品示例
                        </label>
                        {draft.enabled && !draft.examples.length ? (
                            <p role="status" className="text-xs text-foreground/60">
                                请先上传示例，或关闭公开显示后保存。
                            </p>
                        ) : null}
                        {draft.examples.map((item, index) => (
                            <article key={item.resourceId} className="flex flex-col gap-3 rounded-lg border border-foreground/10 p-3 sm:flex-row">
                                <div className="w-full shrink-0 sm:w-36">
                                    {item.type === "video" ? (
                                        <video className="max-h-48 w-full rounded-lg object-contain" src={item.mediaUrl} controls playsInline preload="metadata" />
                                    ) : (
                                        <img className="max-h-48 w-full rounded-lg object-contain" src={item.mediaUrl} alt={item.title || `示例 ${index + 1}`} />
                                    )}
                                </div>
                                <div className="flex min-w-0 flex-1 flex-col gap-2">
                                    <Input aria-label={`示例 ${index + 1} 标题`} placeholder="示例标题（选填）" maxLength={80} disabled={busy} value={item.title} onChange={(event) => changeExample(index, { title: event.target.value })} />
                                    <Input.TextArea
                                        aria-label={`示例 ${index + 1} 说明`}
                                        placeholder="示例说明（选填）"
                                        maxLength={1000}
                                        autoSize={{ minRows: 2, maxRows: 4 }}
                                        disabled={busy}
                                        value={item.description}
                                        onChange={(event) => changeExample(index, { description: event.target.value })}
                                    />
                                    <div className="flex gap-2">
                                        <Button aria-label={`上移示例 ${index + 1}`} icon={<ArrowUp className="size-3.5" />} disabled={busy || index === 0} onClick={() => moveExample(index, -1)} />
                                        <Button aria-label={`下移示例 ${index + 1}`} icon={<ArrowDown className="size-3.5" />} disabled={busy || index === draft.examples.length - 1} onClick={() => moveExample(index, 1)} />
                                        <Button danger icon={<Trash2 className="size-3.5" />} disabled={busy} onClick={() => setDraft({ ...draft, examples: draft.examples.filter((_, i) => i !== index) })}>
                                            移除示例 {index + 1}
                                        </Button>
                                    </div>
                                </div>
                            </article>
                        ))}
                        <Button icon={<ImagePlus className="size-4" />} disabled={busy || draft.examples.length >= 10} onClick={() => inputRef.current?.click()}>
                            上传示例（{draft.examples.length}/10）
                        </Button>
                    </>
                ) : null}
                <input
                    ref={inputRef}
                    className="hidden"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,video/mp4,video/webm"
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void upload(file);
                    }}
                />
            </div>
        </AppModal>
    );
}
