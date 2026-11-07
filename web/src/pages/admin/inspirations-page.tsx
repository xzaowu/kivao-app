import { App, Button, Form, Input, InputNumber, Popconfirm, Select, Upload } from "antd";
import { ArrowDown, ArrowUp, Edit3, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppModal } from "@/components/ui/product/app-modal";
import { AdminPageFrame } from "./components/admin-shell";
import { AdminDataTable, AdminStatusBadge } from "./components/admin-ui";
import { Switch } from "./ui/controls";
import { deleteInspiration, fetchInspirations, saveInspiration, type InspirationEntry, type InspirationExampleView, type InspirationInput } from "@/services/api/inspirations";
import { listWorkbenchTools, resolveWorkbenchResourceURL } from "@/services/api/workbench";
import { uploadResourceFile } from "@/services/api/resources";
import { InspirationMedia } from "@/pages/inspirations";
import { workbenchCategoryLabel } from "@/pages/workbench/workbench-catalog";

const empty: InspirationInput = { version: 0, type: "prompt", title: "", description: "", mode: "image", category: "", prompt: "", sortOrder: 0, enabled: false };
const modes = { image: "图片", video: "视频", text: "文本" };

export default function InspirationsPage() {
    const { message } = App.useApp();
    const client = useQueryClient();
    const query = useQuery({ queryKey: ["admin-inspirations"], queryFn: ({ signal }) => fetchInspirations(true, signal) });
    const tools = useQuery({
        queryKey: ["admin-inspiration-tools"],
        queryFn: async ({ signal }) => {
            const results = await Promise.all([listWorkbenchTools("image", signal, true), listWorkbenchTools("video", signal, true)]);
            return results.flatMap((item) => item.tools);
        },
    });
    const [search, setSearch] = useState("");
    const [editing, setEditing] = useState<InspirationEntry | null | undefined>();
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [examples, setExamples] = useState<InspirationExampleView[]>([]);
    const examplesRef = useRef<InspirationExampleView[]>([]);
    const uploadQueue = useRef(Promise.resolve());
    const pendingUploads = useRef(0);
    const [form] = Form.useForm<InspirationInput>();
    const type = Form.useWatch("type", form);
    useEffect(() => {
        if (editing === undefined) return;
        form.resetFields();
        form.setFieldsValue(editing || empty);
        examplesRef.current = editing?.examples || [];
        setExamples(examplesRef.current);
    }, [editing, form]);
    const refresh = async () => {
        await Promise.all([client.invalidateQueries({ queryKey: ["admin-inspirations"] }), client.invalidateQueries({ queryKey: ["inspiration-hall"] })]);
    };
    const update = async (input: InspirationInput, id?: string) => {
        setSaving(true);
        try {
            await saveInspiration(input, id);
            await refresh();
            message.success("灵感已保存");
            return true;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
            return false;
        } finally {
            setSaving(false);
        }
    };
    const submit = async () => {
        const values = await form.validateFields().catch(() => null);
        const media = examplesRef.current;
        if (
            values &&
            (await update({ ...empty, ...editing, ...values, resourceId: media[0]?.resourceId || "", mediaKind: media[0]?.mediaKind, additionalExamples: media.slice(1).map(({ resourceId, mediaKind }) => ({ resourceId, mediaKind })) }, editing?.id))
        )
            setEditing(undefined);
    };
    const changeExamples = (next: InspirationExampleView[]) => {
        examplesRef.current = next;
        setExamples(next);
    };
    const moveExample = (index: number, offset: number) => {
        const next = [...examplesRef.current];
        [next[index], next[index + offset]] = [next[index + offset], next[index]];
        changeExamples(next);
    };
    const remove = async (item: InspirationEntry) => {
        setSaving(true);
        try {
            await deleteInspiration(item);
            await refresh();
            message.success("灵感已删除");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除失败");
        } finally {
            setSaving(false);
        }
    };
    const rows = (query.data || []).filter((item) => [item.title, item.category, item.description, item.toolId].join(" ").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
    return (
        <AdminPageFrame
            title="灵感管理"
            description="发布提示词灵感，或关联已有创作工具；未上架条目仅后台可见。"
            actions={
                <>
                    <Button icon={<RefreshCw className="size-4" />} onClick={() => void refresh()}>
                        刷新
                    </Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setEditing(null)}>
                        新增灵感
                    </Button>
                </>
            }
        >
            {query.isError ? <p role="alert">灵感读取失败，请刷新重试。</p> : null}
            <AdminDataTable
                toolbar={<Input aria-label="搜索后台灵感" placeholder="搜索标题、分类或工具" prefix={<Search className="size-4" />} value={search} onChange={(event) => setSearch(event.target.value)} allowClear />}
                table={{
                    rowKey: "id",
                    dataSource: rows,
                    loading: query.isPending,
                    pagination: { pageSize: 20 },
                    columns: [
                        {
                            title: "标题",
                            dataIndex: "title",
                            render: (_, item: InspirationEntry) => (
                                <div className="flex items-center gap-3">
                                    <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg">
                                        <InspirationMedia key={item.mediaUrl} item={item} />
                                    </div>
                                    <div>
                                        <strong>{item.title || "关联工具不存在"}</strong>
                                        <div className="mt-1 text-xs text-foreground/55">{item.description}</div>
                                        {item.toolUnavailable ? <AdminStatusBadge label="工具已停用或不存在" tone="warning" /> : null}
                                    </div>
                                </div>
                            ),
                        },
                        { title: "内容", dataIndex: "type", render: (value: string) => (value === "tool" ? "创作工具" : "提示词灵感") },
                        { title: "类型", dataIndex: "mode", render: (value: keyof typeof modes) => modes[value] || "—" },
                        { title: "分类", dataIndex: "category", render: (value: string, item: InspirationEntry) => (value ? workbenchCategoryLabel(value) : item.type === "tool" ? "跟随工具" : "—") },
                        { title: "排序", dataIndex: "sortOrder" },
                        {
                            title: "上架",
                            dataIndex: "enabled",
                            render: (_, item: InspirationEntry) => <Switch aria-label={`上架灵感：${item.title || item.id}`} checked={item.enabled} disabled={saving} onChange={(enabled) => void update({ ...item, enabled }, item.id)} />,
                        },
                        {
                            title: "操作",
                            key: "actions",
                            render: (_, item: InspirationEntry) => (
                                <div className="flex gap-2">
                                    <Button aria-label={`编辑灵感：${item.title || item.id}`} icon={<Edit3 className="size-4" />} disabled={saving} onClick={() => setEditing(item)} />
                                    <Popconfirm title="删除此灵感？关联的工具和资源文件会保留。" onConfirm={() => remove(item)}>
                                        <Button danger aria-label={`删除灵感：${item.title || item.id}`} icon={<Trash2 className="size-4" />} disabled={saving} />
                                    </Popconfirm>
                                </div>
                            ),
                        },
                    ],
                }}
            />
            <AppModal
                title={editing ? "编辑灵感" : "新增灵感"}
                open={editing !== undefined}
                onCancel={() => {
                    if (!saving && !uploading) setEditing(undefined);
                }}
                onOk={() => void submit()}
                confirmLoading={saving}
                okButtonProps={{ disabled: uploading }}
                closable={!saving && !uploading}
                mask={{ closable: !saving && !uploading }}
                keyboard={!saving && !uploading}
                styles={{ body: { maxHeight: "min(70dvh, 720px)", overflowY: "auto" } }}
                width={680}
            >
                <Form form={form} layout="vertical" initialValues={empty} disabled={saving || uploading}>
                    <Form.Item name="type" label="内容来源" rules={[{ required: true }]}>
                        <Select
                            options={[
                                { value: "prompt", label: "提示词灵感" },
                                { value: "tool", label: "关联创作工具" },
                            ]}
                        />
                    </Form.Item>
                    {type === "tool" ? (
                        <Form.Item name="toolId" label="创作工具" rules={[{ required: true, message: "请选择创作工具" }]} extra="标题、封面和前 10 个作品示例自动跟随工具；工具停用后大厅隐藏该卡片。">
                            <Select showSearch optionFilterProp="label" loading={tools.isPending} options={(tools.data || []).map((tool) => ({ value: tool.id, label: `${tool.name} · ${modes[tool.kind]}${tool.enabled ? "" : "（已停用）"}` }))} />
                        </Form.Item>
                    ) : (
                        <>
                            <Form.Item name="title" label="标题" rules={[{ required: true, whitespace: true }]}>
                                <Input maxLength={120} />
                            </Form.Item>
                            <Form.Item name="description" label="说明">
                                <Input.TextArea maxLength={2000} rows={2} />
                            </Form.Item>
                            <Form.Item name="mode" label="创作类型" rules={[{ required: true }]}>
                                <Select options={Object.entries(modes).map(([value, label]) => ({ value, label }))} />
                            </Form.Item>
                            <Form.Item name="prompt" label="提示词" rules={[{ required: true, whitespace: true }]}>
                                <Input.TextArea rows={6} maxLength={32000} showCount />
                            </Form.Item>
                            <Form.Item label={`图片 / 视频示例（${examples.length} / 10）`} extra="第一个示例作为大厅封面，可混合上传图片和视频并调整顺序。">
                                <Upload
                                    accept="image/*,video/*"
                                    multiple
                                    fileList={[]}
                                    showUploadList={false}
                                    disabled={saving || uploading || examples.length >= 10}
                                    beforeUpload={(file, batch) => {
                                        const kind = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "image" : null;
                                        if (!kind) {
                                            message.error("请上传图片或视频");
                                            return false;
                                        }
                                        if (batch.length + examplesRef.current.length > 10) {
                                            if (file.uid === batch[0].uid) message.warning("每条灵感最多上传 10 个示例，请减少选择的文件。");
                                            return false;
                                        }
                                        if (examplesRef.current.length + pendingUploads.current >= 10) return false;
                                        pendingUploads.current++;
                                        setUploading(true);
                                        uploadQueue.current = uploadQueue.current.then(async () => {
                                            try {
                                                const resource = await uploadResourceFile(file, kind, { fileName: file.name });
                                                const mediaUrl = await resolveWorkbenchResourceURL(resource.id, "original");
                                                changeExamples([...examplesRef.current, { resourceId: resource.id, mediaKind: kind, mediaUrl }]);
                                            } catch (error) {
                                                message.error(error instanceof Error ? error.message : "上传失败");
                                            } finally {
                                                pendingUploads.current--;
                                                setUploading(pendingUploads.current > 0);
                                            }
                                        });
                                        return false;
                                    }}
                                >
                                    <Button loading={uploading} disabled={saving || uploading || examples.length >= 10}>
                                        上传示例
                                    </Button>
                                </Upload>
                                <div className="mt-3 grid grid-cols-2 gap-3">
                                    {examples.map((item, index) => (
                                        <div key={item.resourceId} className="min-w-0">
                                            <div className="h-28 overflow-hidden rounded-lg">
                                                <InspirationMedia item={item} controls />
                                            </div>
                                            <div className="mt-1 flex flex-wrap items-center gap-1">
                                                <span className="mr-auto text-xs">{index === 0 ? "封面" : `示例 ${index + 1}`}</span>
                                                <Button type="text" size="small" aria-label={`上移示例 ${index + 1}`} icon={<ArrowUp className="size-3" />} disabled={saving || uploading || index === 0} onClick={() => moveExample(index, -1)} />
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    aria-label={`下移示例 ${index + 1}`}
                                                    icon={<ArrowDown className="size-3" />}
                                                    disabled={saving || uploading || index === examples.length - 1}
                                                    onClick={() => moveExample(index, 1)}
                                                />
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    danger
                                                    aria-label={`移除示例 ${index + 1}`}
                                                    icon={<Trash2 className="size-3" />}
                                                    disabled={saving || uploading}
                                                    onClick={() => changeExamples(examplesRef.current.filter((_, position) => position !== index))}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </Form.Item>
                        </>
                    )}
                    <Form.Item name="category" label="分类" extra="可直接输入分类名称；工具留空时沿用工具分类。">
                        <Input maxLength={64} />
                    </Form.Item>
                    <Form.Item name="sortOrder" label="排序（越小越靠前）">
                        <InputNumber min={0} max={1000000} />
                    </Form.Item>
                    <Form.Item name="enabled" label="上架" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                </Form>
            </AppModal>
        </AdminPageFrame>
    );
}
