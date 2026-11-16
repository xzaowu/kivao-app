/**
 * 全量灵感目录的运行时加载。
 *
 * 3MB 量级的目录不打进主 JS，首页灵感大厅进入可视区域附近后按需拉取；
 * 静态来源分别缓存在内存中；上新短期复用，页面可订阅逐批到达的目录。
 */
import { catalogIdOf, curatedInspirations, type CreationInspiration, type InspirationSourceId } from "@/lib/inspirations/catalog";
import { getPublicInspirationFeed, type InspirationFeed } from "@/services/api/inspiration-feed";

/** manifest.json 里每个来源带的分类码译名表。 */
type SourceManifest = { revision?: string; count?: number; categories?: Record<string, string> };
type CatalogManifest = { generatedAt?: string; sources?: Record<string, SourceManifest> };

export type InspirationCategoryOption = {
    id: string;
    label: string;
    count: number;
};

export type InspirationCatalog = {
    /** 原创 + 全部外部来源，已按来源归并。 */
    entries: CreationInspiration[];
    /** 各来源的分类选项，只保留有条目的那些。 */
    categoriesBySource: Record<InspirationSourceId, InspirationCategoryOption[]>;
    /** 未知分类码的兜底译名表，页面直接用 code 显示。 */
    revisions: Record<string, string>;
    loadedAt: number;
    pendingSources?: string[];
    failedSources?: string[];
};

const CATALOG_SOURCES: { key: InspirationSourceId; file: string }[] = [
    { key: "seedance", file: "/inspirations/seedance.json" },
    { key: "haohaoxue", file: "/inspirations/haohaoxue.json" },
    { key: "youmind", file: "/inspirations/youmind.json" },
];

let pending: Promise<InspirationCatalog> | null = null;
let manifest: CatalogManifest | null = null;
let feed: InspirationFeed | null = null;
let feedLoadedAt = 0;
let generation = 0;
const packs = new Map<InspirationSourceId, CreationInspiration[]>();
const loading = new Set<string>();
const failures = new Set<string>();
const listeners = new Set<(catalog: InspirationCatalog) => void>();
const controllers = new Set<AbortController>();
const FEED_MAX_AGE = 5 * 60_000;

async function withTimeout<T>(request: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
        return await request(controller.signal);
    } finally {
        clearTimeout(timer);
        controllers.delete(controller);
    }
}

async function fetchJson<T>(url: string): Promise<T> {
    return withTimeout(async (signal) => {
        const response = await fetch(url, { headers: { Accept: "application/json" }, signal });
        if (!response.ok) throw new Error(`加载灵感目录失败：${url} 返回 HTTP ${response.status}`);
        return (await response.json()) as T;
    });
}

/** 目录文件是构建期生成的，但仍然是外部数据：形状不对就抛错，不能当成空目录糊过去。 */
function readEntries(payload: unknown, file: string): CreationInspiration[] {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error(`${file} 结构不是目录格式`);
    const entries = (payload as { entries?: unknown }).entries;
    if (!Array.isArray(entries)) throw new Error(`${file} 缺少 entries 列表`);
    return entries as CreationInspiration[];
}

/** 后端定时同步的上新条目只来自这两个来源；其他 sourceId 一律忽略。 */
const FEED_SOURCES = new Set<InspirationSourceId>(["seedance", "youmind"]);

function isWebLink(value: string | undefined, httpsOnly = false) {
    if (!value) return false;
    try {
        const url = new URL(value);
        return url.protocol === "https:" || (!httpsOnly && url.protocol === "http:");
    } catch {
        return false;
    }
}

/** 静态目录已有的条目以静态目录为准（带人工译审和本地缩略图），上新只补目录里没有的。 */
function mergeFeed(entriesBySource: Map<InspirationSourceId, CreationInspiration[]>, feed: InspirationFeed | null, labelsOf: (sourceId: InspirationSourceId) => Record<string, string>) {
    if (!feed?.enabled) return;
    const known = new Map([...entriesBySource.values()].flat().map((entry) => [catalogIdOf(entry), entry]));
    for (const entry of feed.entries) {
        const sourceId = entry.sourceId as InspirationSourceId;
        if (!FEED_SOURCES.has(sourceId) || !entry.title || !entry.prompt || !isWebLink(entry.image, true)) continue;
        const existing = known.get(entry.id);
        if (existing) {
            if (existing.mode === "video" && isWebLink(entry.videoUrl, true)) existing.videoUrl = entry.videoUrl;
            continue;
        }
        const item: CreationInspiration = {
            id: entry.id,
            title: entry.title,
            // 与静态目录一致：没有中文摘要时用分类名做描述。
            description: entry.description || (entry.category ? (labelsOf(sourceId)[entry.category] ?? "") : ""),
            image: entry.image,
            ...(isWebLink(entry.videoUrl, true) ? { videoUrl: entry.videoUrl } : {}),
            mode: entry.mode,
            prompt: entry.prompt,
            sourceId,
            addedAt: entry.addedAt,
            ...(entry.category ? { category: entry.category } : {}),
            ...(entry.tags?.length ? { tags: entry.tags } : {}),
            ...(entry.credit ? { credit: entry.credit } : {}),
            ...(isWebLink(entry.sourceUrl) ? { sourceUrl: entry.sourceUrl } : {}),
            ...(entry.publishedAt ? { publishedAt: entry.publishedAt } : {}),
        };
        known.set(entry.id, item);
        entriesBySource.get(sourceId)?.push(item);
    }
}

function snapshot(): InspirationCatalog {
    const entriesBySource = new Map<InspirationSourceId, CreationInspiration[]>();
    // 合并上新会更新视频地址，不能反向改写已缓存的静态条目。
    CATALOG_SOURCES.forEach((source) =>
        entriesBySource.set(
            source.key,
            (packs.get(source.key) ?? []).map((entry) => ({ ...entry })),
        ),
    );
    entriesBySource.set("original", curatedInspirations);
    // 静态目录的分类名优先，上游新增的分类码再用上新接口带回的名称。
    const labelsOf = (sourceId: InspirationSourceId) => ({ ...(feed?.categories?.[sourceId] ?? {}), ...(manifest?.sources?.[sourceId]?.categories ?? {}) });
    mergeFeed(entriesBySource, feed, labelsOf);

    const categoriesBySource = {} as Record<InspirationSourceId, InspirationCategoryOption[]>;
    const revisions: Record<string, string> = {};
    for (const [sourceId, sourceEntries] of entriesBySource) {
        if (manifest?.sources?.[sourceId]?.revision) revisions[sourceId] = manifest.sources[sourceId]!.revision!;
        const labels = labelsOf(sourceId);
        const counts = new Map<string, number>();
        for (const entry of sourceEntries) {
            const category = entry.category?.trim();
            if (category) counts.set(category, (counts.get(category) ?? 0) + 1);
        }
        categoriesBySource[sourceId] = [...counts.entries()].map(([id, count]) => ({ id, label: labels[id] ?? id, count })).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "zh-Hans-CN"));
    }

    return {
        entries: [...entriesBySource.values()].flat(),
        categoriesBySource,
        revisions,
        loadedAt: Date.now(),
        pendingSources: [...loading],
        failedSources: [...failures],
    };
}

function publish() {
    const catalog = snapshot();
    for (const listener of listeners) listener(catalog);
}

/** 先显示已加载条目；搜索和数量会随着剩余来源到达继续更新。 */
export function subscribeInspirationCatalog(listener: (catalog: InspirationCatalog) => void) {
    listeners.add(listener);
    listener(snapshot());
    return () => {
        listeners.delete(listener);
    };
}

/** 管理员改了上新开关或刚同步完，下次进入灵感大厅重新拉取。 */
export function invalidateInspirationCatalog() {
    generation += 1;
    for (const controller of controllers) controller.abort();
    pending = null;
    manifest = null;
    feed = null;
    feedLoadedAt = 0;
    packs.clear();
    loading.clear();
    failures.clear();
    publish();
    if (listeners.size) void loadInspirationCatalog().catch(() => undefined);
}

/** 静态来源成功后复用；重试只补失败来源，上新过期后单独刷新。 */
export function loadInspirationCatalog(): Promise<InspirationCatalog> {
    if (pending) return pending;
    const currentGeneration = generation;
    const jobs: { key: string; run: () => Promise<void> }[] = [];
    if (!manifest)
        jobs.push({
            key: "manifest",
            run: async () => {
                const value = await fetchJson<CatalogManifest>("/inspirations/manifest.json");
                if (generation === currentGeneration) manifest = value;
            },
        });
    for (const source of CATALOG_SOURCES) {
        if (packs.has(source.key)) continue;
        jobs.push({
            key: source.key,
            run: async () => {
                const entries = readEntries(await fetchJson<unknown>(source.file), source.file);
                if (generation === currentGeneration) packs.set(source.key, entries);
            },
        });
    }
    if (!feedLoadedAt || Date.now() - feedLoadedAt >= FEED_MAX_AGE || failures.has("feed")) {
        jobs.push({
            key: "feed",
            run: async () => {
                const value = await withTimeout((signal) => getPublicInspirationFeed(signal));
                if (generation === currentGeneration) {
                    feed = value;
                    feedLoadedAt = Date.now();
                }
            },
        });
    }
    if (!jobs.length) return Promise.resolve(snapshot());
    for (const job of jobs) loading.add(job.key);
    publish();
    pending = Promise.all(
        jobs.map(async (job) => {
            try {
                await job.run();
                if (generation === currentGeneration) failures.delete(job.key);
            } catch {
                if (generation === currentGeneration) failures.add(job.key);
            } finally {
                if (generation === currentGeneration) {
                    loading.delete(job.key);
                    publish();
                }
            }
        }),
    )
        .then(() => {
            if (generation !== currentGeneration) throw new DOMException("灵感目录已刷新，请重试", "AbortError");
            // 后台编辑器要求完整目录；前台通过订阅保留已到达的内容并单独提示重试。
            if (CATALOG_SOURCES.some((source) => failures.has(source.key))) throw new Error("部分灵感暂时无法加载，请重试");
            return snapshot();
        })
        .finally(() => {
            if (generation === currentGeneration) pending = null;
        });
    return pending;
}

/** 首页画廊的池子：带本地缩略图的精选条目，正文一并带着，点卡片就能直接填词。 */
const GALLERY_POOL_FILE = "/inspirations/gallery-pool.json";

let galleryPool: Promise<CreationInspiration[]> | null = null;

/**
 * 池子有几百条、几百 KB，是全量目录之外的单独一份，只服务画廊一处。
 * 拿不到就退回打包的原创条目——画廊宁可少几张，也不该空着。
 */
export function loadGalleryPool(): Promise<CreationInspiration[]> {
    if (!galleryPool) {
        galleryPool = fetchJson<unknown>(GALLERY_POOL_FILE)
            .then((payload) => [...curatedInspirations, ...readEntries(payload, GALLERY_POOL_FILE)])
            .catch((error) => {
                console.warn("画廊池加载失败，退回打包的原创条目", error);
                galleryPool = null;
                return curatedInspirations;
            });
    }
    return galleryPool;
}
