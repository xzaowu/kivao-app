import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import axios, { type InternalAxiosRequestConfig } from "axios";

// Actual resource/storage modules run against deterministic I/O, never a server or real account.
const localValues = new Map<string, string>();
const events = new EventTarget();
Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
        localStorage: { getItem: (key: string) => localValues.get(key) ?? null, setItem: (key: string, value: string) => localValues.set(key, value) },
        location: { origin: "http://fixture.invalid", href: "http://fixture.invalid/" },
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
    },
});
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { storage: { estimate: async () => ({ quota: 1024 ** 3, usage: 0 }) } } });
let audioCreated = () => {};
let audioElement: { duration: number; onloadedmetadata?: () => void; onerror?: () => void; src?: string };
Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
        createElement: (tag: string) => {
            if (tag !== "audio") throw new Error(`Unexpected element ${tag}`);
            audioElement = { duration: 2 };
            audioCreated();
            return audioElement;
        },
    },
});
const stores = new Map<string, Map<string, unknown>>();
let readHook: ((store: string, key: string) => Promise<unknown> | undefined) | undefined;
let writeHook: ((store: string, key: string, value: unknown) => Promise<void> | undefined) | undefined;
const writes: Array<{ store: string; key: string }> = [];
function memoryStore(name: string) {
    const values = new Map<string, unknown>();
    stores.set(name, values);
    return {
        getItem: async (key: string) => readHook?.(name, key) ?? values.get(key) ?? null,
        setItem: async (key: string, value: unknown) => {
            writes.push({ store: name, key });
            await writeHook?.(name, key, value);
            values.set(key, value);
            return value;
        },
        removeItem: async (key: string) => {
            values.delete(key);
        },
        iterate: async (callback: (value: unknown, key: string) => void) => {
            for (const [key, value] of values) callback(value, key);
        },
        keys: async () => [...values.keys()],
        length: async () => values.size,
    };
}
mock.module(import.meta.resolve("localforage"), () => ({ default: { ...memoryStore("app_state"), config: () => {}, createInstance: ({ storeName }: { storeName: string }) => memoryStore(storeName) } }));
const imageMeta = { width: 2, height: 2, mimeType: "image/png" };
let readImage = async () => imageMeta;
let readPoster = async (): Promise<{ width: number; height: number; durationMs: number; hasAudio?: boolean; poster?: Blob }> => ({ width: 2, height: 2, durationMs: 2000, hasAudio: true });
let readTracks = async (): Promise<boolean | undefined> => false;
mock.module("../../src/lib/image-utils", () => ({ readImageMeta: () => readImage() }));
mock.module("../../src/lib/video-poster", () => ({ captureVideoPoster: () => readPoster(), detectVideoAudioTrackFromBlob: () => readTracks() }));
const scope = await import("../../src/lib/user-scope");
const { apiClient } = await import("../../src/services/api/request");
const resources = await import("../../src/services/api/resources");
const cache = await import("../../src/services/resource-blob-cache");
const images = await import("../../src/services/image-storage");
const files = await import("../../src/services/file-storage");

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((yes) => {
        resolve = yes;
    });
    return { promise, resolve };
}
function observe(promise: Promise<unknown>) {
    return promise.then(
        () => ({ ok: true, name: "" }),
        (error) => ({ ok: false, name: error?.name }),
    );
}
async function aborted(result: ReturnType<typeof observe>) {
    expect(await result).toEqual({ ok: false, name: "AbortError" });
}
function switchAccount(id?: string) {
    resources.clearResourceAccessCache();
    cache.clearResourceBlobCache();
    scope.setActiveUserScope(id);
}
function resource(id = "uploaded") {
    return { id, userId: scope.getActiveUserScope(), kind: "image", status: "ready", publicUrl: "", size: 4, width: 2, height: 2, mimeType: "image/png" };
}
function ok(config: InternalAxiosRequestConfig, data: unknown) {
    return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data, msg: "" } };
}
function rejectHTTP(config: InternalAxiosRequestConfig, status: number): never {
    throw new axios.AxiosError("Synthetic refusal", "ERR_BAD_REQUEST", config, undefined, { config, status, statusText: "Error", headers: {}, data: { code: status, data: null, msg: "Synthetic refusal" } });
}
const smallImage = () => new Blob(["image"], { type: "image/png" });
const largeFile = new Blob([new Uint8Array(51 << 20)]);
const chunkSize = 8 << 20;
function chunkResponse(config: InternalAxiosRequestConfig) {
    if (config.url === "/resources/uploads") return ok(config, { uploadId: "session", chunkSize, chunkCount: Math.ceil(largeFile.size / chunkSize) });
    if (config.url?.endsWith("/complete")) return ok(config, { resource: resource() });
    return ok(config, { index: Number(config.url?.split("/").at(-1)) });
}
beforeEach(() => {
    readHook = undefined;
    writeHook = undefined;
    switchAccount("account-a");
    stores.forEach((values) => values.clear());
    writes.length = 0;
    readImage = async () => imageMeta;
    readPoster = async () => ({ width: 2, height: 2, durationMs: 2000, hasAudio: true });
    readTracks = async () => false;
    globalThis.fetch = (() => {
        throw new Error("Unexpected HTTP request");
    }) as typeof fetch;
    apiClient.defaults.adapter = async () => {
        throw new Error("Unexpected API request");
    };
});
afterEach(() => {
    switchAccount();
});

test("会话代次防 A→B→A，切换等待期间拒绝新操作，同账号设置不取消", () => {
    const first = scope.captureUserScopeOperation();
    scope.setActiveUserScope("account-a");
    expect(first.isCurrent()).toBe(true);
    scope.setActiveUserScope("account-b");
    scope.setActiveUserScope("account-a");
    expect(first.signal.aborted).toBe(true);
    expect(() => first.assertCurrent()).toThrow();
    const second = scope.captureUserScopeOperation();
    const finish = scope.beginUserScopeTransition();
    expect(second.signal.aborted).toBe(true);
    expect(() => scope.captureUserScopeOperation()).toThrow();
    finish();
    finish();
    expect(scope.captureUserScopeOperation().isCurrent()).toBe(true);
});

test("其他标签页的账号存储事件使已有操作失效", () => {
    const operation = scope.captureUserScopeOperation();
    events.dispatchEvent(Object.assign(new Event("storage"), { key: "yingce:active-user-scope" }));
    expect(operation.signal.aborted).toBe(true);
});

for (const mode of ["multipart", "import"] as const) {
    for (const next of ["account-b", "guest", "back-to-a"]) {
        test(`${mode} 迟到响应在 ${next} 不返回或污染新会话缓存`, async () => {
            const entered = deferred<void>(),
                response = deferred<void>();
            let sent: InternalAxiosRequestConfig | undefined;
            const old = resource("late");
            apiClient.defaults.adapter = async (config) => {
                sent = config;
                entered.resolve();
                await response.promise;
                return ok(config, { resource: old });
            };
            const result = observe(mode === "multipart" ? resources.uploadResourceFile(smallImage(), "image") : resources.importResourceFromUrl("https://fixture.invalid/a.png", "image"));
            await entered.promise;
            switchAccount(next === "guest" ? undefined : "account-b");
            if (next === "back-to-a") switchAccount("account-a");
            expect(sent!.signal?.aborted).toBe(true);
            response.resolve();
            await aborted(result);
            let reads = 0;
            apiClient.defaults.adapter = async (config) => {
                reads++;
                return ok(config, { resource: resource("late") });
            };
            expect((await resources.getResource("late")).userId).toBe(scope.getActiveUserScope());
            expect(reads).toBe(1);
        });
    }
}

for (const stage of ["start", "chunk", "complete"]) {
    test(`分片 ${stage} 期间切换后不继续、不重开会话、不触发旧进度`, async () => {
        const entered = deferred<void>(),
            response = deferred<void>();
        const calls: string[] = [],
            progress: number[] = [];
        apiClient.defaults.adapter = async (config) => {
            const step = config.url === "/resources/uploads" ? "start" : config.method === "put" ? "chunk" : "complete";
            calls.push(step);
            if (step === stage) {
                entered.resolve();
                await response.promise;
                config.onUploadProgress?.({ loaded: 1, total: 1 } as never);
            }
            return chunkResponse(config);
        };
        const result = observe(resources.uploadResourceFile(largeFile, "video", undefined, (loaded) => progress.push(loaded)));
        await entered.promise;
        const count = calls.length,
            progressCount = progress.length;
        switchAccount("account-b");
        response.resolve();
        await aborted(result);
        expect(calls.length).toBe(count);
        expect(calls.filter((x) => x === "start").length).toBe(1);
        expect(progress.length).toBe(progressCount);
    });
}

for (const failure of [401, 403, "abort", 503, "network"] as const) {
    test(`分片 ${failure} 的重试分类及原幂等键`, async () => {
        const starts: string[] = [];
        let rejected = false;
        apiClient.defaults.adapter = async (config) => {
            if (config.url === "/resources/uploads") starts.push(String(config.headers.get("X-Idempotency-Key")));
            if (config.method === "put" && !rejected) {
                rejected = true;
                if (failure === "abort") throw new DOMException("cancel", "AbortError");
                if (failure === "network") throw new Error("Network Error");
                rejectHTTP(config, failure);
            }
            return chunkResponse(config);
        };
        const task = resources.uploadResourceFile(largeFile, "video", { idempotencyKey: "original-upload" });
        if (failure === 503 || failure === "network") {
            expect((await task).userId).toBe("account-a");
            expect(starts).toEqual(["original-upload", "original-upload"]);
        } else {
            expect(await task.catch((error) => error.name)).toBe(failure === "abort" ? "AbortError" : "ResourceUploadError");
            expect(starts).toEqual(["original-upload"]);
        }
    });
}

test("显式 AbortSignal 取消传递给分片请求且不重试", async () => {
    const entered = deferred<void>(),
        response = deferred<void>(),
        controller = new AbortController();
    let requests = 0;
    apiClient.defaults.adapter = async (config) => {
        requests++;
        entered.resolve();
        await response.promise;
        return chunkResponse(config);
    };
    const result = observe(resources.uploadResourceFile(largeFile, "video", { signal: controller.signal }));
    await entered.promise;
    controller.abort();
    response.resolve();
    await aborted(result);
    expect(requests).toBe(1);
});

test("图片解码迟到后不上传，并释放预览 URL", async () => {
    const entered = deferred<void>(),
        response = deferred<typeof imageMeta>();
    let requests = 0;
    readImage = () => {
        entered.resolve();
        return response.promise;
    };
    apiClient.defaults.adapter = async (config) => {
        requests++;
        return ok(config, { resource: resource() });
    };
    const revoke = mock(URL.revokeObjectURL);
    const original = URL.revokeObjectURL;
    URL.revokeObjectURL = revoke;
    try {
        const result = observe(images.uploadImage(smallImage()));
        await entered.promise;
        switchAccount("account-b");
        response.resolve(imageMeta);
        await aborted(result);
        expect(requests).toBe(0);
        expect(writes).toEqual([]);
        expect(revoke).toHaveBeenCalledTimes(1);
    } finally {
        URL.revokeObjectURL = original;
    }
});

for (const stage of ["poster", "tracks", "audio"] as const) {
    test(`媒体 ${stage} 解析期间切换后不上传`, async () => {
        const entered = deferred<void>(),
            response = deferred<void>();
        let requests = 0;
        readPoster = async () => {
            if (stage === "poster") {
                entered.resolve();
                await response.promise;
            }
            return { width: 2, height: 2, durationMs: 2000 };
        };
        readTracks = async () => {
            entered.resolve();
            await response.promise;
            return false;
        };
        audioCreated = () => entered.resolve();
        apiClient.defaults.adapter = async (config) => {
            requests++;
            return ok(config, { resource: resource() });
        };
        const result = observe(files.uploadMediaFile(new Blob(["media"], { type: stage === "audio" ? "audio/wav" : "video/mp4" })));
        await entered.promise;
        switchAccount("account-b");
        response.resolve();
        if (stage === "audio") audioElement.onloadedmetadata?.();
        await aborted(result);
        expect(requests).toBe(0);
        expect(writes).toEqual([]);
    });
}

for (const upload of ["image", "file"] as const) {
    test(`${upload} 请求取消不写待补传；网络失败仍可留在原账号`, async () => {
        const invoke = () => (upload === "image" ? images.uploadImage(smallImage(), undefined, imageMeta) : files.uploadMediaFile(new Blob(["file"])));
        apiClient.defaults.adapter = async () => {
            throw new DOMException("cancel", "AbortError");
        };
        await aborted(observe(invoke()));
        expect(writes).toEqual([]);
        apiClient.defaults.adapter = async () => {
            throw new Error("Network Error");
        };
        const result = await invoke();
        expect(result.pendingRemoteUpload).toBe(true);
        expect(result.storageKey).toContain(":account-a:");
        expect(writes.filter((x) => x.store === (upload === "image" ? "image_files" : "media_files"))).toHaveLength(1);
    });

    test(`${upload} 本地降级写入期间切换，不发布待补传或 object URL`, async () => {
        const entered = deferred<void>(),
            response = deferred<void>();
        writeHook = (store) => {
            if (store === (upload === "image" ? "image_files" : "media_files")) {
                entered.resolve();
                return response.promise;
            }
        };
        apiClient.defaults.adapter = async () => {
            throw new Error("Network Error");
        };
        const result = observe(upload === "image" ? images.uploadImage(smallImage(), undefined, imageMeta) : files.uploadMediaFile(new Blob(["file"])));
        await entered.promise;
        switchAccount("account-b");
        response.resolve();
        await aborted(result);
        expect(writes.every((x) => x.key.includes(":account-a:"))).toBe(true);
    });
}

test("URL 导入权限拒绝不转浏览器；临时故障仍允许同会话下载上传", async () => {
    let downloads = 0,
        uploads = 0;
    globalThis.fetch = (async () => {
        downloads++;
        return new Response(smallImage());
    }) as typeof fetch;
    apiClient.defaults.adapter = async (config) => rejectHTTP(config, 403);
    await expect(images.uploadImage("https://fixture.invalid/image", undefined, imageMeta)).rejects.toBeInstanceOf(resources.ResourceUploadError);
    expect(downloads).toBe(0);
    apiClient.defaults.adapter = async (config) => {
        if (config.url === "/resources/import") rejectHTTP(config, 503);
        uploads++;
        return ok(config, { resource: resource() });
    };
    expect((await images.uploadImage("https://fixture.invalid/image", undefined, imageMeta)).pendingRemoteUpload).toBeUndefined();
    expect(downloads).toBe(1);
    expect(uploads).toBe(1);
});

for (const read of ["blob", "object-url", "image-local", "file-local"]) {
    test(`${read} 的 IndexedDB 迟到读取不返回旧账号内容`, async () => {
        const entered = deferred<void>(),
            response = deferred<Blob>();
        readHook = () => {
            entered.resolve();
            return response.promise;
        };
        const promise =
            read === "blob"
                ? cache.getCachedResourceBlob("resource:cached")
                : read === "object-url"
                  ? cache.getCachedResourceObjectUrl("resource:cached")
                  : read === "image-local"
                    ? images.getImageBlob("image:account-a:old")
                    : files.getMediaBlob("file:account-a:old");
        const result = observe(promise);
        await entered.promise;
        switchAccount("account-b");
        response.resolve(smallImage());
        await aborted(result);
        expect(cache.peekCachedResourceObjectUrl("resource:cached")).toBe("");
    });
}

function serveAccess() {
    apiClient.defaults.adapter = async (config) => {
        const body = JSON.parse(config.data);
        return ok(config, { items: body.map((item: { resourceId: string }) => ({ resourceId: item.resourceId, access: { delivery: "platform-local", url: `/api/resources/${item.resourceId}/file`, expiresAt: "2099-01-01T00:00:00Z" } })) });
    };
}

test("缓存下载持久化期间切换后不交付 Blob 或创建新账号 URL", async () => {
    const entered = deferred<void>(),
        response = deferred<void>();
    serveAccess();
    globalThis.fetch = (async () => new Response(smallImage())) as typeof fetch;
    writeHook = (store) => {
        if (store === "resource_blobs") {
            entered.resolve();
            return response.promise;
        }
    };
    const result = observe(cache.getCachedResourceBlob("resource:download"));
    await entered.promise;
    switchAccount("account-b");
    response.resolve();
    await aborted(result);
    expect(cache.peekCachedResourceObjectUrl("resource:download")).toBe("");
    expect(writes.some((x) => x.key.startsWith("account-b:"))).toBe(false);
});

test("取消时清除等待下载队列，旧排队工作不会用新账号发请求", async () => {
    const saturated = deferred<void>(),
        response = deferred<void>();
    let downloads = 0;
    serveAccess();
    globalThis.fetch = (async () => {
        downloads++;
        if (downloads === 16) saturated.resolve();
        await response.promise;
        return new Response(smallImage());
    }) as typeof fetch;
    const pending = Array.from({ length: 20 }, (_, index) => observe(cache.getCachedResourceBlob(`resource:queued-${index}`)));
    await saturated.promise;
    switchAccount("account-b");
    response.resolve();
    for (const item of pending) await aborted(item);
    expect(downloads).toBe(16);
});

test("同账号上传后缓存可读，持久化失败不伪报服务端上传失败", async () => {
    apiClient.defaults.adapter = async (config) => ok(config, { resource: resource("same-account") });
    writeHook = async () => {
        throw new Error("Synthetic cache quota");
    };
    const result = await images.uploadImage(smallImage(), undefined, imageMeta);
    expect(result.pendingRemoteUpload).toBeUndefined();
    expect(await (await cache.getCachedResourceBlob(result.storageKey))?.text()).toBe("image");
    expect(cache.peekCachedResourceObjectUrl(result.storageKey)).toStartWith("blob:");
});
