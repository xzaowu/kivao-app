import { createClientUUID } from "@/lib/client-id";
import { App, Button, Form, Input, InputNumber, Select, Switch, Upload } from "antd";
import { AdminModal } from "@/pages/admin/ui/overlays";
import type { ColumnsType } from "antd/es/table";
import { CloudUpload, Edit3, Plus, RefreshCw, Search, Trash2, Shapes } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import { invalidWorkbenchSlot, workbenchSlotReferences } from "@/lib/workbench-template";
import { workbenchSlots } from "@/lib/workbench-inputs";

import { AdminPageFrame } from "@/pages/admin/components/admin-shell";
import { AdminDataTable, AdminStatusBadge } from "@/pages/admin/components/admin-ui";
import { workbenchCategories, workbenchCategoryLabel, workbenchModeOptions } from "@/pages/workbench/workbench-catalog";
import { uploadResourceFile } from "@/services/api/resources";
import {
    capabilitySupportedModes,
    listWorkbenchTools,
    normalizeWorkbenchGuide,
    resolveWorkbenchResourceURL,
    saveAdminWorkbenchTool,
    saveDefaultWorkbenchExamples,
    setAdminWorkbenchToolEnabled,
    workbenchExamples,
    type WorkbenchInputContract,
    type WorkbenchKind,
    type WorkbenchReferenceSlot,
    type WorkbenchTool,
    type WorkbenchPromptPreset,
    type WorkbenchResultExample,
    type WorkbenchResultExampleItem,
} from "@/services/api/workbench";

import "./workbench-tools.css";

type ToolDraft = {
    processingOperation: "" | "depth_capture";
    id?: string;
    kind: WorkbenchKind;
    categoryId: string;
    name: string;
    subtitle: string;
    description: string;
    guideText: string;
    inputHint: string;
    iconResourceId?: string;
    iconUrl?: string;
    coverResourceId?: string;
    coverUrl?: string;
    sortOrder: number;
    enabled: boolean;
    supportedModes: string[];
    searchKeywords: string[];
    surfaces: string[];
    recommended: boolean;
    recommendationOrder: number;
    capability: Record<string, unknown>;
    guideConfig: Record<string, unknown>;
    inputContract: WorkbenchInputContract;
    resultExample: WorkbenchResultExample;
    presets: WorkbenchPromptPreset[];
    savedPresetIds: string[];
};

type MediaValue = { id?: string; url?: string };
type UploadMedia = (file: File, kind: "image" | "video") => Promise<MediaValue>;

const emptyDraft = (kind: WorkbenchKind = "image"): ToolDraft => ({
    processingOperation: "",
    kind,
    categoryId: "recommended",
    name: "",
    subtitle: "",
    description: "",
    guideText: "",
    inputHint: "",
    sortOrder: 0,
    enabled: false,
    supportedModes: [kind],
    searchKeywords: [],
    surfaces: ["workbench"],
    recommended: false,
    recommendationOrder: 0,
    capability: {},
    guideConfig: {},
    inputContract: { promptRequired: true, minTextReferences: 0, slots: [] },
    resultExample: { items: [] },
    presets: [],
    savedPresetIds: [],
});

function record(value: unknown): Record<string, unknown> {
    if (typeof value === "string") {
        try {
            return record(JSON.parse(value));
        } catch {
            return {};
        }
    }
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function makeDraft(tool: WorkbenchTool): ToolDraft {
    const capability = record(tool.capability);
    const contract = tool.inputContract || { promptRequired: true, minTextReferences: 0, slots: [] };
    return {
        ...emptyDraft(tool.kind),
        ...tool,
        processingOperation: tool.processingOperation || "",
        capability,
        guideConfig: record(tool.guide),
        guideText: normalizeWorkbenchGuide(tool.guide),
        inputHint: tool.inputHint || "",
        supportedModes: capabilitySupportedModes(tool).length ? capabilitySupportedModes(tool) : [tool.kind],
        searchKeywords: tool.searchKeywords || [],
        surfaces: tool.surfaces?.length ? tool.surfaces : ["workbench"],
        recommended: Boolean(tool.recommended),
        recommendationOrder: tool.recommendationOrder || 0,
        inputContract: { ...contract, slots: contract.slots.map((slot) => ({ ...slot })) },
        resultExample: { items: workbenchExamples(tool.resultExample).map((item) => ({ ...item })) },
        presets: tool.presets.map((preset) => ({ ...preset })),
        savedPresetIds: tool.presets.map((preset) => preset.id),
    };
}

function ResourceUpload({ label, value, kind = "image", disabled, upload, onChange }: { label: string; value: MediaValue; kind?: "image" | "video"; disabled: boolean; upload: UploadMedia; onChange: (value: MediaValue) => void }) {
    const [uploading, setUploading] = useState(false);
    return (
        <div className="admin-workbench-resource-upload">
            <div className="admin-workbench-resource-preview">{value.url ? kind === "video" ? <video src={value.url} controls preload="metadata" /> : <img src={value.url} alt={label} /> : <Shapes className="size-5" />}</div>
            <div className="admin-workbench-resource-actions">
                <strong>{label}</strong>
                <small>{value.id ? (value.url ? "已上传" : "已上传，预览暂不可用") : "选择文件上传"}</small>
                <div>
                    <Upload
                        disabled={disabled}
                        accept={`${kind}/*`}
                        showUploadList={false}
                        beforeUpload={async (file) => {
                            setUploading(true);
                            try {
                                onChange(await upload(file, kind));
                            } catch {
                                /* Upload errors are reported by the shared uploader. */
                            } finally {
                                setUploading(false);
                            }
                            return false;
                        }}
                    >
                        <Button size="small" disabled={disabled} loading={uploading} icon={<CloudUpload className="size-3.5" />}>
                            {value.id ? "替换文件" : "上传文件"}
                        </Button>
                    </Upload>
                    {value.id && (
                        <Button size="small" disabled={disabled} type="text" danger aria-label={`移除${label}`} icon={<Trash2 className="size-3.5" />} onClick={() => onChange({})}>
                            移除
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}

function SlotEditor({
    slot,
    index,
    kind,
    disabled,
    upload,
    onChange,
    onRemove,
}: {
    slot: WorkbenchReferenceSlot;
    index: number;
    kind: WorkbenchKind;
    disabled: boolean;
    upload: UploadMedia;
    onChange: (patch: Partial<WorkbenchReferenceSlot>) => void;
    onRemove: () => void;
}) {
    return (
        <div className="admin-workbench-slot-row">
            <div className="admin-workbench-slot-fields">
                <label>
                    输入名称
                    <Input aria-label={`输入 ${index + 1} 名称`} value={slot.name} placeholder="如模特、人脸、商品" onChange={(event) => onChange({ name: event.target.value })} />
                </label>
                <label>
                    媒体类型
                    <Select
                        mode="multiple"
                        aria-label={`输入 ${index + 1} 媒体类型`}
                        value={slot.mediaTypes}
                        options={(kind === "image" ? ["image"] : ["image", "video", "audio"]).map((value) => ({ value, label: value === "image" ? "图片" : value === "video" ? "视频" : "音频" }))}
                        onChange={(mediaTypes) => onChange({ mediaTypes })}
                    />
                </label>
                <label>
                    最少数量
                    <InputNumber min={0} max={slot.maxCount} aria-label={`输入 ${index + 1} 最少数量`} value={slot.minCount} onChange={(value) => onChange({ minCount: value || 0, required: Boolean(value) })} />
                </label>
                <label>
                    最多数量
                    <InputNumber min={Math.max(1, slot.minCount)} max={20} aria-label={`输入 ${index + 1} 最多数量`} value={slot.maxCount} onChange={(value) => onChange({ maxCount: value || 1 })} />
                </label>
                <label>
                    必填
                    <Switch aria-label={`输入 ${index + 1} 必填`} checked={slot.required} onChange={(required) => onChange({ required, minCount: required ? Math.max(1, slot.minCount) : 0 })} />
                </label>
                <label>
                    所有效果通用
                    <Switch aria-label={`输入 ${index + 1} 所有效果通用`} checked={slot.common !== false} onChange={(common) => onChange({ common })} />
                </label>
                <Button disabled={disabled} danger type="text" size="small" onClick={onRemove}>
                    移除输入
                </Button>
            </div>
            <label>
                素材说明（显示在上传框内）
                <Input.TextArea
                    aria-label={`输入 ${index + 1} 素材说明`}
                    value={slot.description || ""}
                    maxLength={1000}
                    rows={2}
                    placeholder="如：可选，上传后参考镜头运动，不上传则使用默认效果"
                    onChange={(event) => onChange({ description: event.target.value })}
                />
            </label>
            <div className="admin-workbench-resource-grid">
                <ResourceUpload label={`${slot.name || "输入"}封面`} value={{ id: slot.coverResourceId, url: slot.coverUrl }} disabled={disabled} upload={upload} onChange={(value) => onChange({ coverResourceId: value.id, coverUrl: value.url })} />
                <ResourceUpload
                    label={`${slot.name || "输入"}注意事项图片`}
                    value={{ id: slot.sampleResourceId, url: slot.sampleUrl }}
                    disabled={disabled}
                    upload={upload}
                    onChange={(value) => onChange({ sampleResourceId: value.id, sampleUrl: value.url })}
                />
            </div>
        </div>
    );
}

function ResultExamplesEditor({ items, disabled, upload, onChange }: { items: WorkbenchResultExampleItem[]; disabled: boolean; upload: UploadMedia; onChange: (items: WorkbenchResultExampleItem[]) => void }) {
    const update = (index: number, patch: Partial<WorkbenchResultExampleItem>) => onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    return (
        <>
            <div className="admin-workbench-result-examples">
                {items.map((item, index) => (
                    <div className="admin-workbench-result-example" key={index}>
                        <ResourceUpload
                            label={`示例 ${index + 1} ${item.kind === "video" ? "视频" : "图片"}`}
                            kind={item.kind}
                            value={{ id: item.resourceId, url: item.url }}
                            disabled={disabled}
                            upload={upload}
                            onChange={(value) => update(index, { resourceId: value.id || "", url: value.url })}
                        />
                        <label>
                            示例标题
                            <Input disabled={disabled} aria-label={`示例 ${index + 1} 标题`} maxLength={120} value={item.title || ""} onChange={(event) => update(index, { title: event.target.value })} />
                        </label>
                        <label>
                            示例说明
                            <Input.TextArea disabled={disabled} aria-label={`示例 ${index + 1} 说明`} rows={2} maxLength={2000} value={item.description || ""} onChange={(event) => update(index, { description: event.target.value })} />
                        </label>
                        <Button disabled={disabled} danger size="small" aria-label={`移除示例 ${index + 1}`} onClick={() => onChange(items.filter((_, i) => i !== index))}>
                            移除示例
                        </Button>
                    </div>
                ))}
            </div>
            <div className="admin-workbench-resource-grid">
                {(["image", "video"] as const).map((kind) => (
                    <Button key={kind} disabled={disabled || items.length >= 20} icon={<Plus className="size-3.5" />} onClick={() => onChange([...items, { resourceId: "", kind, title: "", description: "" }])}>
                        添加{kind === "image" ? "图片" : "视频"}示例
                    </Button>
                ))}
            </div>
        </>
    );
}

export default function WorkbenchToolsPage() {
    const { message } = App.useApp();
    const [kind, setKind] = useState<WorkbenchKind>("image");
    const [tools, setTools] = useState<WorkbenchTool[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState("");
    const [editorOpen, setEditorOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [uploadCount, setUploadCount] = useState(0);
    const [draft, setDraft] = useState<ToolDraft>(emptyDraft());
    const [defaultExamples, setDefaultExamples] = useState<WorkbenchResultExampleItem[]>([]);
    const [defaultDraft, setDefaultDraft] = useState<WorkbenchResultExampleItem[]>([]);
    const [defaultsOpen, setDefaultsOpen] = useState(false);
    const [defaultsSaving, setDefaultsSaving] = useState(false);
    const loadVersion = useRef(0);
    const [form] = Form.useForm();
    const editorBusy = saving || uploadCount > 0;

    const reload = useCallback(async () => {
        const version = ++loadVersion.current;
        setLoading(true);
        try {
            const result = await listWorkbenchTools(kind, undefined, true);
            if (version !== loadVersion.current) return;
            setTools(result.tools.sort((a, b) => a.sortOrder - b.sortOrder));
            setDefaultExamples(workbenchExamples(result.defaultExamples));
        } catch (error) {
            if (version === loadVersion.current) message.error(error instanceof Error ? error.message : "工作台工具加载失败");
        } finally {
            if (version === loadVersion.current) setLoading(false);
        }
    }, [kind, message]);
    useEffect(() => {
        void reload();
    }, [reload]);
    const visibleTools = useMemo(() => tools.filter((item) => !query.trim() || `${item.name} ${item.subtitle} ${item.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [query, tools]);

    const openEditor = async (tool?: WorkbenchTool) => {
        const next = tool ? makeDraft(tool) : emptyDraft(kind);
        if (tool) {
            [next.iconUrl, next.coverUrl] = await Promise.all([resolveWorkbenchResourceURL(next.iconResourceId), resolveWorkbenchResourceURL(next.coverResourceId)]);
            next.inputContract.slots = await Promise.all(next.inputContract.slots.map(async (slot) => ({ ...slot, coverUrl: await resolveWorkbenchResourceURL(slot.coverResourceId), sampleUrl: await resolveWorkbenchResourceURL(slot.sampleResourceId) })));
            next.resultExample.items = await Promise.all(workbenchExamples(next.resultExample).map(async (item) => ({ ...item, url: await resolveWorkbenchResourceURL(item.resourceId, "original") })));
        }
        setDraft(next);
        form.resetFields();
        form.setFieldsValue(next);
        setEditorOpen(true);
    };

    const upload: UploadMedia = async (file, mediaKind) => {
        if (!file.type.startsWith(`${mediaKind}/`)) {
            message.error(`请选择${mediaKind === "image" ? "图片" : "视频"}文件`);
            throw new Error("文件类型不匹配");
        }
        setUploadCount((count) => count + 1);
        try {
            const resource = await uploadResourceFile(file, mediaKind, { fileName: file.name });
            const url = await resolveWorkbenchResourceURL(resource.id);
            message.success("文件已上传");
            return { id: resource.id, url };
        } catch (error) {
            message.error(error instanceof Error ? error.message : "文件上传失败");
            throw error;
        } finally {
            setUploadCount((count) => count - 1);
        }
    };

    const save = async () => {
        if (editorBusy) return;
        let values: ToolDraft;
        try {
            values = await form.validateFields();
        } catch {
            return;
        }
        const slots = draft.inputContract.slots;
        if (workbenchExamples(draft.resultExample).some((item) => !item.resourceId)) {
            message.warning("请为每个作品示例上传文件，或移除空白示例");
            return;
        }
        if (slots.some((slot) => !slot.name.trim() || !slot.mediaTypes.length || slot.minCount > slot.maxCount)) {
            message.warning("请补齐输入名称、媒体类型和有效数量范围");
            return;
        }
        if (draft.presets.some((preset) => !preset.name.trim() || !preset.promptTemplate.trim())) {
            message.warning("请补齐预设名称和提示词");
            return;
        }
        const referenceError = draft.presets.map((preset) => invalidWorkbenchSlot(preset.promptTemplate, workbenchSlots(draft, preset))).find(Boolean);
        if (referenceError) {
            message.warning(referenceError);
            return;
        }
        setSaving(true);
        try {
            const saved = await saveAdminWorkbenchTool({
                id: draft.id,
                kind: draft.kind,
                categoryId: values.categoryId,
                name: values.name.trim(),
                subtitle: values.subtitle?.trim() || "",
                description: values.description.trim(),
                iconResourceId: draft.iconResourceId || "",
                coverResourceId: draft.coverResourceId || "",
                sortOrder: values.sortOrder || 0,
                enabled: values.enabled,
                capability: {
                    ...draft.capability,
                    processingOperation: draft.processingOperation,
                    supportedModes: values.supportedModes,
                    searchKeywords: values.searchKeywords,
                    surfaces: values.surfaces,
                    recommended: values.recommended,
                    recommendationOrder: values.recommendationOrder || 0,
                    inputContract: { ...draft.inputContract, slots: slots.map(({ coverUrl: _coverURL, sampleUrl: _sampleURL, ...slot }) => slot) },
                },
                guide: {
                    ...draft.guideConfig,
                    lines: values.guideText.trim().split("\n").filter(Boolean),
                    inputHint: values.inputHint.trim(),
                    resultExample: { items: workbenchExamples(draft.resultExample).map(({ url: _url, ...item }) => ({ ...item, title: item.title?.trim() || "", description: item.description?.trim() || "" })) },
                },
                presets: draft.presets.map((preset, index) => ({ ...preset, id: draft.savedPresetIds.includes(preset.id) ? preset.id : "", sortOrder: index })),
            });
            setEditorOpen(false);
            await reload();
            message.success(saved.enabled ? "工具已保存并开放" : "工具已保存为未开放");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "工具保存失败");
        } finally {
            setSaving(false);
        }
    };

    const toggle = async (tool: WorkbenchTool, enabled: boolean) => {
        try {
            await setAdminWorkbenchToolEnabled(tool.id, enabled);
            await reload();
            message.success(enabled ? "工具已开放" : "工具已下线");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "工具状态更新失败");
        }
    };
    const updateSlot = (key: string, patch?: Partial<WorkbenchReferenceSlot>) =>
        setDraft((current) => {
            const slots = patch ? current.inputContract.slots.map((slot) => (slot.key === key ? { ...slot, ...patch } : slot)) : current.inputContract.slots.filter((slot) => slot.key !== key);
            return {
                ...current,
                inputContract: { ...current.inputContract, slots },
                presets: current.presets.map((preset) => {
                    const settings = preset.defaultParameters?.workbenchInputs;
                    if (!settings) return preset;
                    const activeSlots = workbenchSlots({ inputContract: { ...current.inputContract, slots } }, preset);
                    return {
                        ...preset,
                        defaultParameters: {
                            ...preset.defaultParameters,
                            workbenchInputs: {
                                ...settings,
                                slotKeys: settings.slotKeys?.filter((key) => slots.some((slot) => slot.key === key)),
                                noticeSlotKeys: (settings.noticeSlotKeys || []).filter((key) => activeSlots.some((slot) => slot.key === key && slot.sampleResourceId)),
                            },
                        },
                    };
                }),
            };
        });
    const updatePreset = (id: string, patch: Partial<WorkbenchPromptPreset>) => setDraft((current) => ({ ...current, presets: current.presets.map((preset) => (preset.id === id ? { ...preset, ...patch } : preset)) }));
    const saveDefaults = async () => {
        if (defaultsSaving || uploadCount) return;
        if (defaultDraft.some((item) => !item.resourceId)) {
            message.warning("请上传示例文件或移除空白示例");
            return;
        }
        setDefaultsSaving(true);
        try {
            const saved = await saveDefaultWorkbenchExamples(kind, defaultDraft);
            setDefaultExamples(workbenchExamples(saved));
            setDefaultsOpen(false);
            message.success("默认状态示例已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存默认示例失败");
        } finally {
            setDefaultsSaving(false);
        }
    };
    const columns: ColumnsType<WorkbenchTool> = [
        {
            title: "工具",
            dataIndex: "name",
            render: (_, tool) => (
                <div className="admin-workbench-tool-main">
                    <span className="admin-workbench-tool-icon">{tool.iconUrl ? <img src={tool.iconUrl} alt="" /> : <Shapes className="size-4" />}</span>
                    <span>
                        <strong>{tool.name}</strong>
                        <small>{tool.subtitle || tool.description}</small>
                    </span>
                </div>
            ),
        },
        { title: "分类", dataIndex: "categoryId", width: 140, align: "center", render: workbenchCategoryLabel },
        { title: "预设", dataIndex: "presets", width: 90, align: "center", render: (value: WorkbenchPromptPreset[]) => `${value.filter((item) => item.enabled).length} 项启用` },
        { title: "排序", dataIndex: "sortOrder", width: 80, align: "center" },
        {
            title: "状态",
            dataIndex: "enabled",
            width: 120,
            align: "center",
            render: (enabled: boolean, tool) => (
                <div className="admin-workbench-tool-status">
                    <AdminStatusBadge label={enabled ? "已开放" : "未开放"} tone={enabled ? "success" : "neutral"} />
                    <Switch checked={enabled} aria-label={`${enabled ? "下线" : "开放"}${tool.name}`} onChange={(checked) => void toggle(tool, checked)} />
                </div>
            ),
        },
        {
            title: "操作",
            width: 120,
            align: "center",
            render: (_, tool) => (
                <Button size="small" icon={<Edit3 className="size-3.5" />} onClick={() => void openEditor(tool)}>
                    编辑
                </Button>
            ),
        },
    ];

    return (
        <AdminPageFrame
            title="工作台工具"
            description="管理生图与视频的工具、场景输入和示例素材"
            scroll
            actions={
                <>
                    <Button
                        disabled={loading}
                        onClick={() => {
                            setDefaultDraft(defaultExamples.map((item) => ({ ...item })));
                            setDefaultsOpen(true);
                        }}
                    >
                        默认状态示例
                    </Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={() => void openEditor()}>
                        新建工具
                    </Button>
                </>
            }
        >
            <div className="admin-workbench-tools">
                <div className="admin-workbench-tools-toolbar">
                    <Select
                        aria-label="工作台类型"
                        value={kind}
                        onChange={setKind}
                        options={[
                            { label: "图片生成", value: "image" },
                            { label: "视频生成", value: "video" },
                        ]}
                    />
                    <Input aria-label="搜索工作台工具" prefix={<Search className="size-4" />} placeholder="搜索名称或说明" value={query} onChange={(event) => setQuery(event.target.value)} allowClear />
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void reload()}>
                        刷新
                    </Button>
                </div>
                <AdminDataTable
                    table={{ className: "app-data-table", rowKey: "id", loading, pagination: false, columns, dataSource: visibleTools, scroll: { x: 900 } }}
                    empty={<div className="admin-workbench-tools-empty">当前类型还没有工具，使用“新建工具”创建首个目录项。</div>}
                />
            </div>
            <AdminModal
                title={`默认${kind === "image" ? "图片生成" : "视频生成"}示例`}
                open={defaultsOpen}
                onCancel={() => !defaultsSaving && !uploadCount && setDefaultsOpen(false)}
                onOk={() => void saveDefaults()}
                okText="保存"
                confirmLoading={defaultsSaving}
                okButtonProps={{ disabled: uploadCount > 0 }}
                cancelButtonProps={{ disabled: defaultsSaving || uploadCount > 0 }}
                closable={!defaultsSaving && !uploadCount}
                maskClosable={!defaultsSaving && !uploadCount}
                keyboard={!defaultsSaving && !uploadCount}
                width={900}
                destroyOnHidden
            >
                <p>未选择创作场景时展示，图片生成和视频生成分别配置。最多 20 项，每项可单独设置标题和说明。</p>
                <ResultExamplesEditor items={defaultDraft} disabled={defaultsSaving || uploadCount > 0} upload={upload} onChange={setDefaultDraft} />
            </AdminModal>
            <AdminModal
                title={draft.id ? "编辑工作台工具" : "新建工作台工具"}
                open={editorOpen}
                onCancel={() => !editorBusy && setEditorOpen(false)}
                onOk={() => void save()}
                okText={uploadCount ? "等待上传完成" : "保存"}
                okButtonProps={{ disabled: uploadCount > 0 }}
                cancelButtonProps={{ disabled: editorBusy }}
                confirmLoading={saving}
                maskClosable={!editorBusy}
                keyboard={!editorBusy}
                closable={!editorBusy}
                width={1080}
                destroyOnHidden
                className="admin-workbench-tool-editor"
            >
                <Form form={form} layout="vertical" disabled={editorBusy} className="admin-workbench-tool-form">
                    <div className="admin-workbench-tool-grid">
                        <Form.Item label="工作台类型">
                            <Select
                                value={draft.kind}
                                disabled={Boolean(draft.id) || editorBusy}
                                options={[
                                    { label: "图片生成", value: "image" },
                                    { label: "视频生成", value: "video" },
                                ]}
                                onChange={(value: WorkbenchKind) => {
                                    setDraft((current) => ({
                                        ...current,
                                        kind: value,
                                        processingOperation: "",
                                        inputContract: { ...current.inputContract, slots: value === "image" ? current.inputContract.slots.map((slot) => ({ ...slot, mediaTypes: ["image"] })) : current.inputContract.slots },
                                    }));
                                    form.setFieldValue("supportedModes", [value]);
                                }}
                            />
                        </Form.Item>
                        {draft.kind === "video" ? (
                            <Form.Item label="执行方式">
                                <Select
                                    aria-label="工具执行方式"
                                    disabled={Boolean(draft.id)}
                                    value={draft.processingOperation}
                                    options={[
                                        { value: "", label: "普通视频生成" },
                                        { value: "depth_capture", label: "深度动作捕捉", disabled: draft.presets.length > 0 },
                                    ]}
                                    onChange={(value: "" | "depth_capture") => {
                                        setDraft((current) => ({
                                            ...current,
                                            processingOperation: value,
                                            ...(value
                                                ? {
                                                      supportedModes: ["video"],
                                                      inputContract: {
                                                          promptRequired: false,
                                                          minTextReferences: 0,
                                                          slots: [{ key: "source_video", name: "源视频", resourceKind: "asset", mediaTypes: ["video"], required: true, minCount: 1, maxCount: 1, common: true }],
                                                      },
                                                  }
                                                : {}),
                                        }));
                                        if (value) {
                                            form.setFieldValue("supportedModes", ["video"]);
                                            if (!form.getFieldValue("name")) form.setFieldValue("name", "深度动作捕捉");
                                        }
                                    }}
                                />
                            </Form.Item>
                        ) : null}
                        <Form.Item name="categoryId" label="业务分类" rules={[{ required: true }]}>
                            <Select options={workbenchCategories} />
                        </Form.Item>
                        <Form.Item name="name" label="工具名称" rules={[{ required: true, whitespace: true, max: 80 }]}>
                            <Input maxLength={80} />
                        </Form.Item>
                        <Form.Item name="subtitle" label="副标题">
                            <Input maxLength={160} />
                        </Form.Item>
                        <Form.Item name="sortOrder" label="排序">
                            <InputNumber min={0} max={1000000} />
                        </Form.Item>
                        <Form.Item name="enabled" label="用户端开放" valuePropName="checked">
                            <Switch />
                        </Form.Item>
                    </div>
                    <Form.Item name="description" label="简短说明" rules={[{ required: true, whitespace: true, max: 500 }]}>
                        <Input.TextArea rows={2} maxLength={500} />
                    </Form.Item>
                    <div className="admin-workbench-resource-grid">
                        <ResourceUpload
                            label="工具图标"
                            value={{ id: draft.iconResourceId, url: draft.iconUrl }}
                            disabled={editorBusy}
                            upload={upload}
                            onChange={(value) => setDraft((current) => ({ ...current, iconResourceId: value.id, iconUrl: value.url }))}
                        />
                        <ResourceUpload
                            label="工具封面"
                            value={{ id: draft.coverResourceId, url: draft.coverUrl }}
                            disabled={editorBusy}
                            upload={upload}
                            onChange={(value) => setDraft((current) => ({ ...current, coverResourceId: value.id, coverUrl: value.url }))}
                        />
                    </div>
                    <div className="admin-workbench-section-title">
                        <strong>用户需要提供什么</strong>
                        <small>配置模特、人脸、商品等输入，用户端按媒体类型和数量展示上传入口。</small>
                    </div>
                    <div className="admin-workbench-contract-toolbar">
                        <label>
                            补充内容必填{" "}
                            <Switch
                                disabled={draft.processingOperation === "depth_capture"}
                                checked={draft.inputContract.minTextReferences > 0}
                                onChange={(required) => setDraft((current) => ({ ...current, inputContract: { ...current.inputContract, minTextReferences: required ? 1 : 0, ...(required ? { promptRequired: true } : {}) } }))}
                            />
                        </label>
                        <label>
                            提示词必填{" "}
                            <Switch
                                disabled={draft.processingOperation === "depth_capture"}
                                checked={draft.inputContract.promptRequired || draft.inputContract.minTextReferences > 0}
                                onChange={(promptRequired) => setDraft((current) => ({ ...current, inputContract: { ...current.inputContract, promptRequired, minTextReferences: 0 } }))}
                            />
                        </label>
                        <Button
                            size="small"
                            disabled={draft.inputContract.slots.length >= 20}
                            icon={<Plus className="size-3.5" />}
                            onClick={() =>
                                setDraft((current) => ({
                                    ...current,
                                    inputContract: { ...current.inputContract, slots: [...current.inputContract.slots, { key: createClientUUID(), name: "", mediaTypes: ["image"], resourceKind: "asset", minCount: 0, maxCount: 1, required: false }] },
                                }))
                            }
                        >
                            添加输入
                        </Button>
                    </div>
                    <div className="admin-workbench-slots">
                        {draft.inputContract.slots.map((slot, index) => (
                            <SlotEditor key={slot.key} slot={slot} index={index} kind={draft.kind} disabled={editorBusy} upload={upload} onChange={(patch) => updateSlot(slot.key, patch)} onRemove={() => updateSlot(slot.key)} />
                        ))}
                    </div>
                    <div className="admin-workbench-section-title">
                        <strong>使用说明与展示</strong>
                    </div>
                    <div className="admin-workbench-tool-grid">
                        <Form.Item name="inputHint" label="输入提示">
                            <Input.TextArea rows={2} maxLength={500} />
                        </Form.Item>
                        <Form.Item name="guideText" label="使用说明">
                            <Input.TextArea rows={2} maxLength={5000} />
                        </Form.Item>
                        <Form.Item name="supportedModes" label="创作方式" rules={[{ required: true }]}>
                            <Select mode="multiple" options={workbenchModeOptions(draft.kind)} />
                        </Form.Item>
                        <Form.Item name="searchKeywords" label="搜索关键词">
                            <Select mode="tags" tokenSeparators={[",", "，"]} placeholder="输入关键词后按回车" />
                        </Form.Item>
                        <Form.Item name="surfaces" label="展示入口">
                            <Select mode="multiple" options={[{ value: "workbench", label: "创作工作台" }]} />
                        </Form.Item>
                        <Form.Item name="recommendationOrder" label="推荐排序">
                            <InputNumber min={0} max={1000000} />
                        </Form.Item>
                        <Form.Item name="recommended" label="推荐工具" valuePropName="checked">
                            <Switch />
                        </Form.Item>
                    </div>
                    <div className="admin-workbench-section-title">
                        <strong>结果示例</strong>
                        <small>最多 20 个图片或视频示例；标题叠加在作品上方，说明显示在作品下方。</small>
                    </div>
                    <ResultExamplesEditor items={workbenchExamples(draft.resultExample)} disabled={editorBusy} upload={upload} onChange={(items) => setDraft((current) => ({ ...current, resultExample: { items } }))} />
                    {draft.processingOperation !== "depth_capture" ? (
                        <section className="admin-workbench-presets">
                            <header>
                                <div>
                                    <strong>预设提示词</strong>
                                    <small>用户只看到预设名称和简介。输入 @ 选择素材输入区，引用该组全部素材；重命名不会影响绑定。可选输入未上传时标记为未提供。</small>
                                </div>
                                <Button
                                    size="small"
                                    disabled={draft.presets.length >= 50}
                                    icon={<Plus className="size-3.5" />}
                                    onClick={() => setDraft((current) => ({ ...current, presets: [...current.presets, { id: createClientUUID(), name: "", promptTemplate: "", summary: "", enabled: true }] }))}
                                >
                                    添加预设
                                </Button>
                            </header>
                            {draft.presets.map((preset, index) => (
                                <div className="admin-workbench-preset-row" key={preset.id}>
                                    <Input aria-label={`预设 ${index + 1} 名称`} placeholder="预设名称" value={preset.name} onChange={(event) => updatePreset(preset.id, { name: event.target.value })} />
                                    <Input aria-label={`预设 ${index + 1} 简介`} placeholder="一句话说明" value={preset.summary} onChange={(event) => updatePreset(preset.id, { summary: event.target.value })} />
                                    <CanvasResourceMentionTextarea
                                        aria-label={`预设 ${index + 1} 提示词`}
                                        containerClassName="admin-workbench-template"
                                        references={workbenchSlotReferences(workbenchSlots(draft, preset))}
                                        sendOnEnter={false}
                                        placeholder="输入 @ 引用素材，例如商品原图"
                                        value={preset.promptTemplate}
                                        onChange={(promptTemplate) => updatePreset(preset.id, { promptTemplate })}
                                    />
                                    <Switch aria-label={`启用预设 ${index + 1}`} checked={preset.enabled} onChange={(enabled) => updatePreset(preset.id, { enabled })} />
                                    <div className="admin-workbench-preset-inputs">
                                        <label>
                                            本效果使用的专用素材（通用素材始终显示）
                                            <Select
                                                mode="multiple"
                                                aria-label={`预设 ${index + 1} 专用素材`}
                                                value={workbenchSlots(draft, preset)
                                                    .filter((slot) => slot.common === false)
                                                    .map((slot) => slot.key)}
                                                options={draft.inputContract.slots.filter((slot) => slot.common === false).map((slot) => ({ value: slot.key, label: slot.name || "未命名素材" }))}
                                                onChange={(slotKeys: string[]) =>
                                                    updatePreset(preset.id, {
                                                        defaultParameters: {
                                                            ...preset.defaultParameters,
                                                            workbenchInputs: {
                                                                slotKeys,
                                                                noticeSlotKeys: (preset.defaultParameters?.workbenchInputs?.noticeSlotKeys || []).filter((key) =>
                                                                    draft.inputContract.slots.some((slot) => slot.key === key && (slot.common !== false || slotKeys.includes(key))),
                                                                ),
                                                            },
                                                        },
                                                    })
                                                }
                                            />
                                        </label>
                                        <label>
                                            显示“查看注意事项”的素材
                                            <Select
                                                mode="multiple"
                                                aria-label={`预设 ${index + 1} 注意事项`}
                                                value={preset.defaultParameters?.workbenchInputs?.noticeSlotKeys || []}
                                                options={workbenchSlots(draft, preset).map((slot) => ({ value: slot.key, label: slot.name || "未命名素材", disabled: !slot.sampleResourceId }))}
                                                onChange={(noticeSlotKeys: string[]) => updatePreset(preset.id, { defaultParameters: { ...preset.defaultParameters, workbenchInputs: { ...preset.defaultParameters?.workbenchInputs, noticeSlotKeys } } })}
                                            />
                                        </label>
                                        <small>关闭“所有效果通用”后，可在这里按效果选择素材。先上传素材的注意事项图片，再开启对应按钮。</small>
                                    </div>
                                    {!draft.savedPresetIds.includes(preset.id) && (
                                        <Button danger size="small" onClick={() => setDraft((current) => ({ ...current, presets: current.presets.filter((item) => item.id !== preset.id) }))}>
                                            移除
                                        </Button>
                                    )}
                                </div>
                            ))}
                        </section>
                    ) : null}
                </Form>
            </AdminModal>
        </AdminPageFrame>
    );
}
