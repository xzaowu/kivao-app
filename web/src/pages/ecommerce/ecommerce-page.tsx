import { App, Button, Input, InputNumber, Select, Spin } from "antd";
import { Download, FolderOpen, History, ImagePlus, Plus, RefreshCw, Trash2 } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { ImageSizePicker } from "@/components/image-size-picker";
import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { ModelPicker } from "@/components/model-picker";
import { AppModal } from "@/components/ui/product/app-modal";
import type { AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { formatCredits } from "@/constant/credits";
import { createClientUUID } from "@/lib/client-id";
import { modelCapabilityConfigFor, normalizeImageValue } from "@/lib/model-capabilities";
import { createZip } from "@/lib/zip";
import * as api from "@/services/api/ecommerce";
import { getResourceBlob, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { cancelGenerationTask, recoverGenerationTaskMedia, type GenerationTask } from "@/services/api/task-center";
import { selectableModelsByCapability, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { resolveWorkbenchAsset } from "@/pages/workbench/workbench-references";
import { WorkbenchImageResults, workbenchImageResults } from "@/pages/workbench/workbench-image-results";
import { ecommerceModelChoice, ecommerceTaskText } from "./ecommerce-model";
import { loadEcommerceIntents, queryEcommerceIntents, retryEcommerceUnknown, saveEcommerceIntents, stopEcommerceUnknown, submitEcommerceIntents, type EcommerceIntent } from "./ecommerce-intents";
import "./ecommerce.css";

const AssetLibraryPickerModal = lazy(() => import("@/components/assets/asset-library-picker-modal").then((m) => ({ default: m.AssetLibraryPickerModal })));
const emptyDraft = (): api.EcommerceDraft => ({ productName: "", description: "", platform: "电商平台", language: "中文", imageType: "main", count: 4, references: [] });
const statusLabels: Record<string, string> = { queued: "排队中", running: "生成中", succeeded: "已完成", failed: "失败", cancelled: "已取消" };
const isRunning = (t?: GenerationTask) => t?.status === "queued" || t?.status === "running";
const messageOf = (e: unknown) => (e instanceof Error ? e.message : "操作失败，请重试");

function directionsFrom(task?: GenerationTask): api.EcommerceState["directions"] {
    if (task?.status !== "succeeded") return undefined;
    try {
        const value = JSON.parse(ecommerceTaskText(task));
        return Array.isArray(value.directions) && value.directions.length === 4 ? value : undefined;
    } catch {
        return undefined;
    }
}

function outputResourceId(task: GenerationTask) {
    // Download only the application's durable resource, never a transient provider URL.
    const src = workbenchImageResults(task)[0] || "";
    const match = src.match(/\/resources\/([^/?#]+)\/file(?:[?#]|$)/);
    return match ? decodeURIComponent(match[1]) : "";
}

function saveBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob),
        link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function EcommercePage() {
    const userId = useUserStore((s) => s.user?.id);
    return userId ? <EcommerceWorkspace key={userId} userId={userId} /> : null;
}

function EcommerceWorkspace({ userId }: { userId: string }) {
    const { message } = App.useApp();
    const [params, setParams] = useSearchParams();
    const projectId = params.get("project") || "";
    const config = useEffectiveConfig();
    const [status, setStatus] = useState({ enabled: false, configured: false });
    const [project, setProject] = useState<api.EcommerceProject | null>(null);
    const [draft, setDraft] = useState(emptyDraft);
    const [jobs, setJobs] = useState<EcommerceIntent[]>([]);
    const [quoteJobs, setQuoteJobs] = useState<EcommerceIntent[] | null>(null);
    const [cacheError, setCacheError] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false),
        [busy, setBusy] = useState(false);
    const [library, setLibrary] = useState(false),
        [history, setHistory] = useState(false);
    const [projects, setProjects] = useState<api.EcommerceProject[]>([]),
        [projectPage, setProjectPage] = useState(1);
    const [rounds, setRounds] = useState<api.EcommerceRound[]>([]),
        [roundPage, setRoundPage] = useState(1);
    const [pastRound, setPastRound] = useState<api.EcommerceRound | null>(null);
    const [edit, setEdit] = useState<api.EcommerceImage | null>(null);
    const [model, setModel] = useState("");
    const [imageSettings, setImageSettings] = useState({ size: "", quality: "", imageResolution: "" });
    const [newRoundDialog, setNewRoundDialog] = useState(false);
    const [stoppingUnknown, setStoppingUnknown] = useState(false);
    const activeRef = useRef(projectId),
        epoch = useRef(0),
        mounted = useRef(true),
        lock = useRef(false);
    const fileRef = useRef<HTMLInputElement>(null),
        createId = useRef(createClientUUID());
    const roundKey = useRef(createClientUUID());
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            epoch.current++;
        };
    }, []);
    const guard = (version = epoch.current) => {
        if (!mounted.current || useUserStore.getState().user?.id !== userId || version !== epoch.current) throw new Error("页面或账号已切换，请在原项目核对任务回执");
    };
    const run = async (fn: (version: number) => Promise<void>) => {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setError("");
        const version = epoch.current;
        try {
            guard(version);
            await fn(version);
        } catch (e) {
            if (mounted.current && version === epoch.current && useUserStore.getState().user?.id === userId) setError(messageOf(e));
        } finally {
            lock.current = false;
            if (mounted.current) setBusy(false);
        }
    };
    useEffect(() => {
        let active = true;
        api.ecommerceStatus()
            .then((s) => {
                if (active) setStatus(s);
            })
            .catch((e) => {
                if (active) setError(messageOf(e));
            });
        return () => {
            active = false;
        };
    }, [userId]);
    useEffect(() => {
        // Navigating history only reads; it never quotes or submits a task.
        if (activeRef.current === projectId && project?.id === projectId) return;
        activeRef.current = projectId;
        const version = ++epoch.current;
        setProject(null);
        setJobs([]);
        setQuoteJobs(null);
        setPastRound(null);
        setCacheError("");
        setEdit(null);
        setError("");
        setLoading(Boolean(projectId));
        if (!projectId) {
            setDraft(emptyDraft());
            createId.current = createClientUUID();
            return;
        }
        const controller = new AbortController();
        Promise.all([
            api.getEcommerceProject(projectId, controller.signal),
            loadEcommerceIntents(userId, projectId).catch((e) => {
                guard(version);
                setCacheError(messageOf(e));
                return [];
            }),
        ])
            .then(([p, items]) => {
                guard(version);
                setProject(p);
                setDraft(p.draft);
                setJobs(items);
            })
            .catch((e) => {
                if (!controller.signal.aborted && epoch.current === version) setError(messageOf(e));
            })
            .finally(() => {
                if (epoch.current === version) setLoading(false);
            });
        return () => controller.abort();
        // project is intentionally not a dependency: polling must not reset edited input.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId, userId]);
    const refresh = useCallback(async () => {
        const id = activeRef.current,
            version = epoch.current;
        if (!id) return;
        const p = await api.getEcommerceProject(id);
        guard(version);
        if (activeRef.current === id) setProject(p);
    }, [userId]);
    const running = project?.tasks.some(isRunning) || false;
    useEffect(() => {
        if (!running) return;
        const timer = window.setInterval(() => {
            void refresh().catch((e) => {
                if (mounted.current) setError(messageOf(e));
            });
        }, 2000);
        return () => window.clearInterval(timer);
    }, [running, refresh]);
    const options = useMemo(
        () =>
            selectableModelsByCapability(config, "image").filter((v) => {
                try {
                    ecommerceModelChoice(config, v);
                    return true;
                } catch {
                    return false;
                }
            }),
        [config],
    );
    const chosenModel = options.includes(model) ? model : options[0] || "";
    const profile = chosenModel ? modelCapabilityConfigFor(config, chosenModel)?.image : undefined;
    const normalizedSettings = useMemo(() => (profile ? normalizeImageValue(profile, imageSettings) : imageSettings), [profile, imageSettings]);
    const unknown = jobs.some((j) => j.phase === "unknown"),
        pending = jobs.some((j) => j.phase === "ready");
    const hasTasks = Boolean(project?.tasks.length);
    const canWrite = status.enabled && status.configured && project?.status !== "archived" && !pastRound && !cacheError && !unknown && !pending && !busy && !loading;
    const draftDirty = Boolean(project && JSON.stringify(project.draft) !== JSON.stringify(draft));
    const view = pastRound || project;
    const shownDraft = pastRound?.draft || draft;
    const state = view?.state;
    const taskFor = (id?: string) => view?.tasks.find((t) => t.id === id);
    const visionTask = taskFor(state?.visionTaskId),
        planningTask = taskFor(state?.planningTaskId);
    const directions = state?.directions || directionsFrom(visionTask);

    const persist = async (id: string, items: EcommerceIntent[], version: number) => {
        await saveEcommerceIntents(userId, id, items);
        guard(version);
        setJobs(structuredClone(items));
    };
    const deps = (id: string, version: number) => ({
        assertCurrent: () => guard(version),
        persist: (items: EcommerceIntent[]) => persist(id, items, version),
        project: () => api.getEcommerceProject(id),
        submit: (r: api.EcommerceTaskRequest) => api.submitEcommerceTask(id, r),
        receipt: async (idempotencyKey: string) => (await api.ecommerceReceipt(id, idempotencyKey)).task,
    });
    const ensureProject = async (version: number) => {
        if (!draft.productName.trim() || !draft.references.some((r) => r.role === "primary")) throw new Error("请填写商品名称，并添加至少一张商品原图");
        let p = project;
        if (!p) {
            p = await api.createEcommerceProject(createId.current, draft);
            guard(version);
            activeRef.current = p.id;
            setProject(p);
            setDraft(p.draft);
            setParams({ project: p.id }, { replace: true });
        } else if (draftDirty) {
            if (hasTasks) throw new Error("本轮已有任务，请先新建一轮再修改商品资料");
            p = await api.saveEcommerceDraft(p.id, p.revision, draft, false, roundKey.current);
            guard(version);
            setProject(p);
            setDraft(p.draft);
        }
        return p;
    };
    const prepareQuotes = (stage: api.EcommerceTaskRequest["stage"], images: api.EcommerceImage[] = []) =>
        run(async (version) => {
            if (!canWrite) throw new Error("请先处理当前任务或检查功能配置");
            const p = await ensureProject(version);
            guard(version);
            const requests: { request: api.EcommerceTaskRequest; label: string }[] =
                stage === "image"
                    ? images.map((image) => ({
                          label: image.title,
                          request: {
                              revision: p.revision,
                              requestId: createClientUUID(),
                              stage,
                              imageId: image.id,
                              model: ecommerceModelChoice(config, chosenModel),
                              size: normalizedSettings.size,
                              quality: normalizedSettings.quality,
                              imageResolution: normalizedSettings.imageResolution,
                              maxCharge: 0,
                          },
                      }))
                    : [{ label: stage === "vision" ? "商品识别与视觉方向" : "整套策划", request: { revision: p.revision, requestId: createClientUUID(), stage, maxCharge: 0 } }];
            if (!requests.length) throw new Error("没有需要生成的图片");
            const items: EcommerceIntent[] = [];
            for (const item of requests) {
                guard(version);
                const quote = await api.quoteEcommerceTask(p.id, item.request);
                guard(version);
                items.push({ phase: "ready", label: item.label, request: { ...item.request, quoteHash: quote.quoteHash, maxCharge: quote.amountMicrocredits, quoteExpiresAt: quote.expiresAt } });
            }
            setQuoteJobs(items);
        });
    const confirmQuotes = () =>
        run(async (version) => {
            if (!project || !quoteJobs) return;
            const items = quoteJobs;
            setQuoteJobs(null);
            await persist(project.id, items, version);
            const next = await submitEcommerceIntents(items, deps(project.id, version));
            guard(version);
            setJobs(next);
            await refresh();
        });
    const processIntents = (action: "query" | "retry" | "resume") =>
        run(async (version) => {
            if (!project) return;
            const handler = action === "query" ? queryEcommerceIntents : action === "retry" ? retryEcommerceUnknown : submitEcommerceIntents;
            const next = await handler(jobs, deps(project.id, version));
            guard(version);
            setJobs(next);
            await refresh();
        });
    const addRefs = (ids: string[]) =>
        setDraft((d) => {
            const refs = [...d.references];
            for (const id of ids) if (!refs.some((r) => r.resourceId === id) && refs.length < 8) refs.push({ resourceId: id, role: refs.length ? "detail" : "primary" });
            return { ...d, references: refs };
        });
    const upload = (files: FileList | null) =>
        run(async (version) => {
            if (!files) return;
            const ids: string[] = [];
            try {
                for (const file of Array.from(files).slice(0, 8 - draft.references.length)) {
                    guard(version);
                    if (!file.type.startsWith("image/")) throw new Error("仅支持图片素材");
                    const resource = await uploadResourceFile(file, "image", { fileName: file.name });
                    guard(version);
                    ids.push(resource.id);
                }
            } finally {
                guard(version);
                addRefs(ids);
                if (fileRef.current) fileRef.current.value = "";
            }
        });
    const addLibrary = (_ids: string[], items?: AssetLibraryPickerItem[]) =>
        run(async (version) => {
            const ids: string[] = [];
            for (const item of (items || []).slice(0, 8 - draft.references.length)) {
                if (item.asset?.kind !== "image") continue;
                guard(version);
                const resource = await resolveWorkbenchAsset(item.asset);
                guard(version);
                ids.push(resource.resourceId);
            }
            addRefs(ids);
            setLibrary(false);
        });
    const accept = (task: GenerationTask, directionId?: string) =>
        run(async (version) => {
            if (!project) return;
            const p = await api.acceptEcommerceStage(project.id, project.revision, task.id, directionId);
            guard(version);
            setProject(p);
        });
    const openHistory = () =>
        run(async (version) => {
            const [p, r] = await Promise.all([api.listEcommerceProjects(1), project ? api.listEcommerceRounds(project.id, 1) : Promise.resolve({ rounds: [] })]);
            guard(version);
            setProjects(p.projects);
            setRounds(r.rounds);
            setProjectPage(1);
            setRoundPage(1);
            setHistory(true);
        });
    const download = (images: api.EcommerceImage[]) =>
        run(async (version) => {
            const files: { name: string; data: Blob }[] = [];
            for (const image of images) {
                const task = taskFor(image.taskId);
                if (task?.status !== "succeeded") continue;
                const id = outputResourceId(task);
                if (!id) throw new Error("作品尚未保存为本地资源，请先完成重试保存");
                const blob = await getResourceBlob(resourceStorageKey(id));
                guard(version);
                if (!blob || !blob.type.startsWith("image/")) throw new Error("图片资源不可读取");
                files.push({ name: `${image.id}-${image.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60)}.${blob.type === "image/jpeg" ? "jpg" : blob.type.split("/")[1].replace(/[^a-z0-9]/gi, "") || "png"}`, data: blob });
            }
            if (!files.length) throw new Error("暂无可下载作品");
            const blob = files.length === 1 ? files[0].data : await createZip(files);
            guard(version);
            saveBlob(blob, files.length === 1 ? files[0].name : `${(view?.draft.productName || "商品套图").replace(/[\\/:*?"<>|]/g, "_")}.zip`);
        });
    const taskStatus = (task?: GenerationTask) =>
        task ? (
            <div className="ecommerce-task-state" role="status">
                <span>
                    {statusLabels[task.status]}
                    {isRunning(task) && task.progress ? ` · ${task.progress}%` : ""}
                </span>
                {task.error && <p>{task.error}</p>}
                {isRunning(task) && (
                    <Button
                        size="small"
                        disabled={busy}
                        onClick={() =>
                            void run(async () => {
                                await cancelGenerationTask(task.id);
                                await refresh();
                            })
                        }
                    >
                        取消任务
                    </Button>
                )}
                {task.canRecoverMedia && (
                    <Button
                        size="small"
                        disabled={busy}
                        onClick={() =>
                            void run(async () => {
                                await recoverGenerationTaskMedia(task.id);
                                await refresh();
                            })
                        }
                    >
                        重试保存
                    </Button>
                )}
            </div>
        ) : null;

    return (
        <WorkspacePage className="ecommerce-page">
            <PageHeader
                title="商品套图"
                description="从商品原图出发，确认视觉方向后生成一套主图或详情图。"
                actions={
                    <>
                        <Button icon={<History className="size-4" />} disabled={busy || loading} onClick={() => void openHistory()}>
                            项目与轮次
                        </Button>
                        <Button
                            icon={<Plus className="size-4" />}
                            disabled={busy}
                            onClick={() => {
                                if (busy) return;
                                setParams({});
                            }}
                        >
                            新商品
                        </Button>
                    </>
                }
            />
            {!status.enabled && (
                <p className="ecommerce-notice" role="status">
                    商品套图暂未开放，已有项目和作品仍可查看、下载。
                </p>
            )}
            {status.enabled && !status.configured && (
                <p className="ecommerce-notice" role="status">
                    请管理员先配置商品套图的两个阶段模型。
                </p>
            )}
            {error && (
                <div role="alert" className="ecommerce-error">
                    {error}
                    <Button
                        type="text"
                        onClick={() =>
                            void run(async () => {
                                await refresh();
                            })
                        }
                        icon={<RefreshCw className="size-4" />}
                    >
                        刷新项目
                    </Button>
                </div>
            )}
            {cacheError && (
                <p role="alert" className="ecommerce-error">
                    {cacheError}。生成已暂停，请保留浏览器数据并核对创作历史。
                </p>
            )}
            {jobs.some((j) => j.phase !== "accepted") && (
                <section className="ecommerce-receipts" aria-label="任务提交记录">
                    <h2>提交记录</h2>
                    {jobs.map((j) => (
                        <p key={j.request.requestId}>
                            {j.label} · {{ ready: "尚未提交", unknown: "回执待确认", accepted: "已受理", rejected: "提交被拒绝，请重新报价" }[j.phase]}
                        </p>
                    ))}
                    <div className="ecommerce-actions">
                        {unknown && (
                            <Button disabled={busy} onClick={() => void processIntents("query")}>
                                查询任务回执
                            </Button>
                        )}
                        {unknown && jobs.find((j) => j.phase === "unknown")?.checked && (
                            <Button disabled={busy} onClick={() => void processIntents("retry")}>
                                确认重试原请求
                            </Button>
                        )}
                        {unknown && jobs.filter((j) => j.phase === "unknown").every((j) => j.checked) && (
                            <Button
                                disabled={busy || !status.enabled}
                                onClick={() => {
                                    setError("");
                                    roundKey.current = createClientUUID();
                                    setStoppingUnknown(true);
                                    setNewRoundDialog(true);
                                }}
                            >
                                终止待确认请求并新建一轮
                            </Button>
                        )}
                        {!unknown && pending && (
                            <Button disabled={busy || !status.enabled} onClick={() => void processIntents("resume")}>
                                继续提交已确认任务
                            </Button>
                        )}
                        {!unknown && (
                            <Button
                                disabled={busy}
                                onClick={() =>
                                    void run(async (version) => {
                                        if (project) await persist(project.id, [], version);
                                    })
                                }
                            >
                                结束未提交项，重新报价
                            </Button>
                        )}
                    </div>
                </section>
            )}
            {loading ? (
                <div className="ecommerce-loading">
                    <Spin />
                </div>
            ) : (
                <div className="ecommerce-workspace">
                    <section className="ecommerce-brief" aria-labelledby="ecommerce-brief-heading">
                        <h2 id="ecommerce-brief-heading">商品资料</h2>
                        <p className="ecommerce-caption">至少一张商品原图；风格参考仅用于视觉方向。最多 8 张。</p>
                        <fieldset aria-disabled={!canWrite || hasTasks} className="ecommerce-form">
                            <label>
                                商品名称
                                <Input readOnly={!canWrite || hasTasks} value={shownDraft.productName} maxLength={100} onChange={(e) => setDraft((d) => ({ ...d, productName: e.target.value }))} placeholder="例如：便携保温杯" />
                            </label>
                            <label>
                                商品信息与卖点
                                <Input.TextArea
                                    readOnly={!canWrite || hasTasks}
                                    value={shownDraft.description}
                                    rows={3}
                                    maxLength={4000}
                                    onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                                    placeholder="填写已确认的材质、用途与限制，勿填未经证实的功效"
                                />
                            </label>
                            <div className="ecommerce-field-pair">
                                <label>
                                    平台
                                    <Input readOnly={!canWrite || hasTasks} value={shownDraft.platform} maxLength={80} onChange={(e) => setDraft((d) => ({ ...d, platform: e.target.value }))} />
                                </label>
                                <label>
                                    语言
                                    <Input readOnly={!canWrite || hasTasks} value={shownDraft.language} maxLength={40} onChange={(e) => setDraft((d) => ({ ...d, language: e.target.value }))} />
                                </label>
                            </div>
                            <div className="ecommerce-field-pair">
                                <label>
                                    用途
                                    <Select
                                        value={shownDraft.imageType}
                                        disabled={!canWrite || hasTasks}
                                        options={[
                                            { value: "main", label: "商品主图" },
                                            { value: "detail", label: "商品详情图" },
                                        ]}
                                        onChange={(imageType) => setDraft((d) => ({ ...d, imageType }))}
                                    />
                                </label>
                                <label>
                                    图片数量
                                    <InputNumber disabled={!canWrite || hasTasks} value={shownDraft.count} min={1} max={8} onChange={(v) => setDraft((d) => ({ ...d, count: v || 1 }))} />
                                </label>
                            </div>
                        </fieldset>
                        <ul className="ecommerce-references">
                            {shownDraft.references.map((ref) => (
                                <li key={ref.resourceId}>
                                    <CachedResourceImage storageKey={resourceStorageKey(ref.resourceId)} alt="商品参考图" fallback={<ImagePlus />} />
                                    <Select
                                        aria-label="参考图用途"
                                        value={ref.role}
                                        disabled={!canWrite || hasTasks}
                                        options={[
                                            { value: "primary", label: "商品原图" },
                                            { value: "detail", label: "商品细节" },
                                            { value: "style", label: "风格参考" },
                                        ]}
                                        onChange={(role) => setDraft((d) => ({ ...d, references: d.references.map((r) => (r.resourceId === ref.resourceId ? { ...r, role } : r)) }))}
                                    />
                                    <Button
                                        type="text"
                                        aria-label="移除参考图"
                                        icon={<Trash2 className="size-4" />}
                                        disabled={!canWrite || hasTasks}
                                        onClick={() => setDraft((d) => ({ ...d, references: d.references.filter((r) => r.resourceId !== ref.resourceId) }))}
                                    />
                                </li>
                            ))}
                        </ul>
                        <div className="ecommerce-actions">
                            <input type="file" hidden ref={fileRef} accept="image/*" multiple onChange={(e) => void upload(e.target.files)} />
                            <Button icon={<ImagePlus className="size-4" />} disabled={!canWrite || hasTasks || draft.references.length >= 8} onClick={() => fileRef.current?.click()}>
                                上传原图
                            </Button>
                            <Button icon={<FolderOpen className="size-4" />} disabled={!canWrite || hasTasks || draft.references.length >= 8} onClick={() => setLibrary(true)}>
                                素材库
                            </Button>
                        </div>
                        {hasTasks && !pastRound && (
                            <div className="ecommerce-round-note">
                                <p>本轮资料已锁定，修改商品或方向请新建一轮。原方案和作品会保留在轮次中。</p>
                                <Button
                                    disabled={!canWrite || running}
                                    onClick={() => {
                                        setError("");
                                        setStoppingUnknown(false);
                                        roundKey.current = createClientUUID();
                                        setNewRoundDialog(true);
                                    }}
                                >
                                    新建一轮
                                </Button>
                            </div>
                        )}
                        {!state?.visionApplied && (
                            <div className="ecommerce-stage-action">
                                <Button type="primary" disabled={!canWrite || isRunning(visionTask) || visionTask?.status === "succeeded"} loading={busy} onClick={() => void prepareQuotes("vision")}>
                                    识别商品与视觉方向
                                </Button>
                                {taskStatus(visionTask)}
                            </div>
                        )}
                        {state?.plan && !pastRound && (
                            <section className="ecommerce-output-settings">
                                <h2>出图设置</h2>
                                <ModelPicker
                                    config={config}
                                    value={chosenModel}
                                    capability="image"
                                    onChange={(v) => {
                                        setModel(v);
                                        setImageSettings({ size: "", quality: "", imageResolution: "" });
                                    }}
                                    fullWidth
                                    showSelectedPrice={false}
                                    requirements={{ input: { textCount: 1, imageCount: draft.references.length, videoCount: 0, audioCount: 0, characterCount: 0 } }}
                                    modelDisabledReason={(v) => {
                                        try {
                                            ecommerceModelChoice(config, v);
                                            return "";
                                        } catch {
                                            return "请选择平台模型";
                                        }
                                    }}
                                />
                                {profile && (
                                    <ImageSizePicker
                                        profile={profile}
                                        size={normalizedSettings.size}
                                        quality={normalizedSettings.quality}
                                        imageResolution={normalizedSettings.imageResolution}
                                        onChange={(size, quality, imageResolution) => setImageSettings({ size, quality: quality || "", imageResolution: imageResolution || "" })}
                                    />
                                )}
                                <Button
                                    type="primary"
                                    disabled={!canWrite || !chosenModel || running}
                                    onClick={() =>
                                        void prepareQuotes(
                                            "image",
                                            state.plan!.images.filter((image) => !isRunning(taskFor(image.taskId)) && taskFor(image.taskId)?.status !== "succeeded"),
                                        )
                                    }
                                >
                                    生成尚未完成的图片
                                </Button>
                            </section>
                        )}
                    </section>
                    <section className="ecommerce-results" aria-label="视觉方向与作品">
                        {pastRound && (
                            <div className="ecommerce-notice">
                                正在查看历史轮次 {pastRound.ordinal}
                                <Button type="text" onClick={() => setPastRound(null)}>
                                    返回当前轮
                                </Button>
                            </div>
                        )}
                        {!directions && !state?.plan && (
                            <div className="ecommerce-empty">
                                <ImagePlus className="size-9" aria-hidden />
                                <h2>先让商品说清楚</h2>
                                <p>上传原图并填写商品信息，确认报价后获取 4 个视觉方向。选定方向，再策划每张图片。</p>
                            </div>
                        )}
                        {directions && !state?.plan && (
                            <section>
                                <h2>选择视觉方向</h2>
                                <p className="ecommerce-caption">{directions.productSummary}</p>
                                {directions.uncertainFacts.length > 0 && <p className="ecommerce-caption">尚待确认：{directions.uncertainFacts.join("；")}</p>}
                                <div className="ecommerce-directions">
                                    {directions.directions.map((direction) => (
                                        <button
                                            type="button"
                                            key={direction.id}
                                            aria-pressed={state?.selectedDirectionId === direction.id}
                                            disabled={!canWrite || Boolean(state?.planningTaskId) || !visionTask}
                                            onClick={() => visionTask && void accept(visionTask, direction.id)}
                                        >
                                            <h3>{direction.name}</h3>
                                            <p>{direction.description}</p>
                                            <span>{state?.selectedDirectionId === direction.id ? "已选择" : "选择方向"}</span>
                                        </button>
                                    ))}
                                </div>
                                {state?.selectedDirectionId && (
                                    <div className="ecommerce-stage-action">
                                        <Button type="primary" disabled={!canWrite || isRunning(planningTask) || planningTask?.status === "succeeded"} onClick={() => void prepareQuotes("planning")}>
                                            策划整套图片
                                        </Button>
                                        {taskStatus(planningTask)}
                                        {planningTask?.status === "succeeded" && !state?.planningApplied && (
                                            <Button disabled={!canWrite} onClick={() => void accept(planningTask)}>
                                                使用这套方案
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </section>
                        )}
                        {state?.plan && (
                            <>
                                <div className="ecommerce-result-heading">
                                    <div>
                                        <h2>{pastRound ? `第 ${pastRound.ordinal} 轮作品` : "整套方案与作品"}</h2>
                                        <p className="ecommerce-caption">{state.plan.summary}</p>
                                    </div>
                                    <Button icon={<Download className="size-4" />} disabled={busy || !state.plan.images.some((i) => taskFor(i.taskId)?.status === "succeeded")} onClick={() => void download(state.plan!.images)}>
                                        下载已完成作品
                                    </Button>
                                </div>
                                <div className="ecommerce-image-grid">
                                    {state.plan.images.map((image) => {
                                        const task = taskFor(image.taskId),
                                            src = task ? workbenchImageResults(task)[0] : "";
                                        return (
                                            <article key={image.id} className="ecommerce-image">
                                                <div className="ecommerce-image-preview">
                                                    {task?.status === "succeeded" && src ? (
                                                        <WorkbenchImageResults task={task} src={src} />
                                                    ) : (
                                                        <div className="ecommerce-image-placeholder">
                                                            <ImagePlus aria-hidden />
                                                            <span>{task ? statusLabels[task.status] : "等待生成"}</span>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="ecommerce-image-copy">
                                                    <h3>{image.title}</h3>
                                                    {image.copy && <p>{image.copy}</p>}
                                                    <details>
                                                        <summary>查看与调整提示词</summary>
                                                        <p>{image.prompt}</p>
                                                    </details>
                                                    {taskStatus(task)}
                                                    {!!image.previousTaskIds?.length && (
                                                        <details>
                                                            <summary>较早作品（{image.previousTaskIds.length}）</summary>
                                                            {image.previousTaskIds.map((id, index) => {
                                                                const previous = taskFor(id);
                                                                return previous?.status === "succeeded" ? (
                                                                    <div key={id} className="ecommerce-previous-version">
                                                                        <WorkbenchImageResults task={previous} src={workbenchImageResults(previous)[0] || ""} />
                                                                        <Button size="small" disabled={busy} onClick={() => void download([{ ...image, taskId: id }])}>
                                                                            下载较早作品 {index + 1}
                                                                        </Button>
                                                                    </div>
                                                                ) : null;
                                                            })}
                                                        </details>
                                                    )}
                                                    <div className="ecommerce-actions">
                                                        {!pastRound && (
                                                            <Button
                                                                size="small"
                                                                disabled={!canWrite || isRunning(task)}
                                                                onClick={() => {
                                                                    setError("");
                                                                    setEdit({ ...image });
                                                                }}
                                                            >
                                                                编辑方案
                                                            </Button>
                                                        )}
                                                        {!pastRound && (
                                                            <Button size="small" disabled={!canWrite || !chosenModel || isRunning(task) || task?.canRecoverMedia} onClick={() => void prepareQuotes("image", [image])}>
                                                                {task ? "重新出图" : "生成这张"}
                                                            </Button>
                                                        )}
                                                        {task?.status === "succeeded" && (
                                                            <Button size="small" disabled={busy} onClick={() => void download([image])}>
                                                                下载
                                                            </Button>
                                                        )}
                                                    </div>
                                                </div>
                                            </article>
                                        );
                                    })}
                                </div>
                            </>
                        )}
                    </section>
                </div>
            )}
            <AppModal title="确认生成费用" open={Boolean(quoteJobs)} onCancel={() => !busy && setQuoteJobs(null)} onOk={() => void confirmQuotes()} confirmLoading={busy} okText="确认并提交" destroyOnHidden>
                <p>本次仅提交以下任务，不会自动开始下一阶段。</p>
                <ul className="ecommerce-quote-list">
                    {quoteJobs?.map((j) => (
                        <li key={j.request.requestId}>
                            <span>{j.label}</span>
                            <strong>{formatCredits(j.request.maxCharge)} 积分</strong>
                        </li>
                    ))}
                </ul>
                <p>
                    本次最高 <strong>{formatCredits(quoteJobs?.reduce((sum, j) => sum + j.request.maxCharge, 0) || 0)} 积分</strong>。按用量计费的文本阶段以实际用量结算，超过本次上限须重新确认；报价 5 分钟内有效。
                </p>
            </AppModal>
            <AppModal
                title="新建一轮"
                open={newRoundDialog}
                onCancel={() => setNewRoundDialog(false)}
                okText={stoppingUnknown ? "终止原请求并新建一轮" : "保留本轮并重新策划"}
                confirmLoading={busy}
                onOk={() =>
                    void run(async (version) => {
                        if (!project) return;
                        if (stoppingUnknown) {
                            const result = await stopEcommerceUnknown(jobs, { ...deps(project.id, version), newRound: (before) => api.saveEcommerceDraft(before.id, before.revision, before.draft, true, roundKey.current) });
                            guard(version);
                            setJobs(result.items);
                            setProject(result.project);
                            setDraft(result.project.draft);
                            setPastRound(null);
                            setNewRoundDialog(false);
                            message.info(result.stopped ? "原请求已终止，已保留历史并新建一轮" : "已找到原任务，已恢复回执，请先查看结果");
                            return;
                        }
                        const p = await api.saveEcommerceDraft(project.id, project.revision, project.draft, true, roundKey.current);
                        guard(version);
                        await persist(p.id, [], version);
                        setProject(p);
                        setDraft(p.draft);
                        setPastRound(null);
                        setNewRoundDialog(false);
                    })
                }
            >
                {error && (
                    <p role="alert" className="ecommerce-error">
                        {error}
                    </p>
                )}
                {stoppingUnknown && <p>将再次查询原回执。只有未受理请求被版本检查成功阻止后才结束暂存；不再重发原请求，不会删除已有作品，也不会自动生成。</p>}
                <p>原方案、任务和作品会保留。新一轮可重新编辑商品资料，并逐阶段确认费用。</p>
            </AppModal>
            <AppModal
                title="编辑图片方案"
                open={Boolean(edit)}
                onCancel={() => setEdit(null)}
                okText="保存方案"
                confirmLoading={busy}
                onOk={() =>
                    void run(async (version) => {
                        if (!project || !edit) return;
                        const p = await api.editEcommerceImage(project.id, project.revision, edit);
                        guard(version);
                        setProject(p);
                        setEdit(null);
                    })
                }
            >
                {edit && (
                    <div className="ecommerce-form">
                        {error && (
                            <p role="alert" className="ecommerce-error">
                                {error}
                            </p>
                        )}
                        <label>
                            标题
                            <Input value={edit.title} maxLength={100} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
                        </label>
                        <label>
                            上图文案
                            <Input.TextArea value={edit.copy} maxLength={1000} rows={2} onChange={(e) => setEdit({ ...edit, copy: e.target.value })} />
                        </label>
                        <label>
                            生成提示词
                            <Input.TextArea value={edit.prompt} maxLength={6000} rows={6} onChange={(e) => setEdit({ ...edit, prompt: e.target.value })} />
                        </label>
                        <p className="ecommerce-caption">保存不会发起生成，原作品继续保留；重新出图需再次确认报价。</p>
                    </div>
                )}
            </AppModal>
            <AppModal title="项目与轮次" open={history} footer={null} onCancel={() => setHistory(false)} width={720}>
                {error && (
                    <p role="alert" className="ecommerce-error">
                        {error}
                    </p>
                )}
                <h3>商品项目</h3>
                <ul className="ecommerce-history">
                    {projects.map((p) => (
                        <li key={p.id}>
                            <Button
                                type="text"
                                disabled={busy}
                                onClick={() => {
                                    setHistory(false);
                                    setParams({ project: p.id });
                                }}
                            >
                                {p.name}
                            </Button>
                            <time>{new Date(p.updatedAt).toLocaleString("zh-CN")}</time>
                        </li>
                    ))}
                </ul>
                <div className="ecommerce-actions">
                    <Button
                        disabled={busy || projectPage === 1}
                        onClick={() =>
                            void run(async (v) => {
                                const p = await api.listEcommerceProjects(projectPage - 1);
                                guard(v);
                                setProjects(p.projects);
                                setProjectPage(projectPage - 1);
                            })
                        }
                    >
                        上一页
                    </Button>
                    <span>第 {projectPage} 页</span>
                    <Button
                        disabled={busy || projects.length < 20}
                        onClick={() =>
                            void run(async (v) => {
                                const p = await api.listEcommerceProjects(projectPage + 1);
                                guard(v);
                                setProjects(p.projects);
                                setProjectPage(projectPage + 1);
                            })
                        }
                    >
                        下一页
                    </Button>
                </div>
                {project && (
                    <>
                        <h3 className="mt-6">当前商品的历史轮次</h3>
                        {!rounds.length && <p className="ecommerce-caption">还没有归档轮次</p>}
                        <ul className="ecommerce-history">
                            {rounds.map((r) => (
                                <li key={r.id}>
                                    <Button
                                        type="text"
                                        onClick={() => {
                                            setPastRound(r);
                                            setHistory(false);
                                        }}
                                    >
                                        第 {r.ordinal} 轮 · {r.draft.productName}
                                    </Button>
                                    <time>{new Date(r.createdAt).toLocaleString("zh-CN")}</time>
                                </li>
                            ))}
                        </ul>
                        <div className="ecommerce-actions">
                            <Button
                                disabled={busy || roundPage === 1}
                                onClick={() =>
                                    void run(async (v) => {
                                        const r = await api.listEcommerceRounds(project.id, roundPage - 1);
                                        guard(v);
                                        setRounds(r.rounds);
                                        setRoundPage(roundPage - 1);
                                    })
                                }
                            >
                                上一页
                            </Button>
                            <span>第 {roundPage} 页</span>
                            <Button
                                disabled={busy || rounds.length < 20}
                                onClick={() =>
                                    void run(async (v) => {
                                        const r = await api.listEcommerceRounds(project.id, roundPage + 1);
                                        guard(v);
                                        setRounds(r.rounds);
                                        setRoundPage(roundPage + 1);
                                    })
                                }
                            >
                                下一页
                            </Button>
                        </div>
                    </>
                )}
            </AppModal>
            {library && (
                <Suspense fallback={<Spin />}>
                    <AssetLibraryPickerModal open remoteLibrary remoteKind="image" mediaKinds={["image"]} acceptRemoteItems items={[]} categoryLabels={{ all: "全部图片" }} title="选择商品参考图" onClose={() => setLibrary(false)} onConfirm={addLibrary} />
                </Suspense>
            )}
        </WorkspacePage>
    );
}
