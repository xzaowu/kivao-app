import { expect, test } from "bun:test";
import { apiClient } from "@/services/api/request";
import { clearResourceAccessCache, getResourceBlob } from "@/services/api/resources";

test("原图处理跳过 HTTP 缓存并按交付类型隔离 Cookie，读取失败不返回成功", async () => {
    const adapter = apiClient.defaults.adapter;
    const originalFetch = globalThis.fetch;
    try {
        for (const delivery of ["platform-local", "platform-proxy", "cdn"]) {
            clearResourceAccessCache();
            apiClient.defaults.adapter = async (config) => ({ config, status: 200, statusText: "OK", headers: {}, data: {
                code: 0, data: { items: [{ access: { delivery, url: "https://example.invalid/image", expiresAt: "2000-01-01T00:00:00Z" } }] },
            } });
            const calls: RequestInit[] = [];
            globalThis.fetch = (async (_url, options) => {
                calls.push(options!);
                return new Response("pixels", { status: 200 });
            }) as typeof fetch;
            expect(await (await getResourceBlob("resource:test-image"))?.text()).toBe("pixels");
            expect(calls[0]?.cache).toBe("no-store");
            expect(calls[0]?.mode).toBe("cors");
            expect(calls[0]?.credentials).toBe(delivery === "cdn" ? "omit" : "include");
            expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
        }
        clearResourceAccessCache();
        globalThis.fetch = (async () => new Response("", { status: 403 })) as typeof fetch;
        await expect(getResourceBlob("resource:denied-image")).rejects.toThrow("403");
    } finally {
        clearResourceAccessCache();
        apiClient.defaults.adapter = adapter;
        globalThis.fetch = originalFetch;
    }
});
