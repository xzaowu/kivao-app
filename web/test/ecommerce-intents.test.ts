import { afterAll, expect, spyOn, test } from "bun:test";
import localforage from "localforage";
import { ApiError } from "../src/services/api/request";
import { loadEcommerceIntents, queryEcommerceIntents, retryEcommerceUnknown, saveEcommerceIntents, stopEcommerceUnknown, submitEcommerceIntents, validateEcommerceIntents, type EcommerceIntent } from "../src/pages/ecommerce/ecommerce-intents";
import type { EcommerceProject, EcommerceTaskRequest } from "../src/services/api/ecommerce";
import type { GenerationTask } from "../src/services/api/task-center";

const pid = "736806ea-babc-481e-af85-b9181552af50";
const ids = ["d5fa09a0-e122-4949-80dc-7800e95ef2cc", "5fc4f77a-c303-47ca-afd0-3bc757402890"];
const taskId = "31a170fd-26ce-5486-811a-fae58b0c0fba";
const item = (index = 0): EcommerceIntent => ({
    request: { requestId: ids[index], revision: 1, stage: "image", imageId: `image-${index + 1}`, quoteHash: "a".repeat(64), quoteExpiresAt: "2099-01-01T00:00:00Z", maxCharge: 100, model: { channelId: "platform", model: "test" } },
    phase: "ready",
    label: "商品图",
});
const task = { id: taskId, status: "queued" } as GenerationTask;
const project = async () => ({ revision: 7 }) as EcommerceProject;
const data = new Map<string, unknown>();
const get = spyOn(localforage, "getItem").mockImplementation(async (key) => structuredClone(data.get(key) ?? null) as never);
const set = spyOn(localforage, "setItem").mockImplementation(async (key, value) => {
    data.set(key, structuredClone(value));
    return value as never;
});
afterAll(() => {
    get.mockRestore();
    set.mockRestore();
});

test("丢失回执不自动重发，查询为空后仅人工重试原始请求", async () => {
    const calls: EcommerceTaskRequest[] = [],
        states: EcommerceIntent[][] = [];
    const deps = {
        assertCurrent() {},
        persist: async (s: EcommerceIntent[]) => {
            states.push(structuredClone(s));
        },
        project,
        submit: async (r: EcommerceTaskRequest) => {
            calls.push(structuredClone(r));
            throw new ApiError("Connection lost", { status: 503 });
        },
        receipt: async () => null,
    };
    let jobs = await submitEcommerceIntents([item(), item(1)], deps);
    expect(jobs.map((j) => j.phase)).toEqual(["unknown", "ready"]);
    expect(states[0][0].phase).toBe("unknown");
    expect(calls).toHaveLength(1);
    await expect(submitEcommerceIntents(jobs, deps)).rejects.toThrow("先查询");
    await expect(retryEcommerceUnknown(jobs, deps)).rejects.toThrow("先查询");
    jobs = await queryEcommerceIntents(jobs, deps);
    expect(calls).toHaveLength(1);
    jobs = await retryEcommerceUnknown(jobs, {
        ...deps,
        project: async () => ({ revision: 999 }) as EcommerceProject,
        submit: async (r) => {
            calls.push(structuredClone(r));
            return task;
        },
    });
    expect(calls[1]).toEqual(calls[0]);
    expect(jobs.map((j) => j.phase)).toEqual(["accepted", "ready"]);
    jobs = await submitEcommerceIntents(jobs, {
        ...deps,
        submit: async (r) => {
            calls.push(structuredClone(r));
            return task;
        },
    });
    expect(calls).toHaveLength(3);
    expect(calls[2].requestId).toBe(ids[1]);
});

test("刷新和查询只读，缓存按账号项目隔离且不保存连接信息", async () => {
    const jobs = [{ ...item(), phase: "unknown" as const }];
    await saveEcommerceIntents("owner", pid, jobs);
    expect(await loadEcommerceIntents("other", pid)).toEqual([]);
    expect((await loadEcommerceIntents("owner", pid))[0].phase).toBe("unknown");
    let sends = 0;
    const next = await queryEcommerceIntents(jobs, {
        assertCurrent() {},
        persist: async () => {},
        project,
        receipt: async () => task,
        submit: async () => {
            sends++;
            return task;
        },
    });
    expect(next[0].phase).toBe("accepted");
    expect(sends).toBe(0);
    for (const mutate of [
        (v: any) => {
            v.request.model.apiKey = "test";
        },
        (v: any) => {
            v.request.baseUrl = "https://example.invalid";
        },
        (v: any) => {
            v.request.headers = {};
        },
    ]) {
        const v = item();
        mutate(v);
        expect(() => validateEcommerceIntents([v])).toThrow();
    }
    expect(() => validateEcommerceIntents([item(), item()])).toThrow();
});

test("本地暂存失败或账号切换时阻断后续请求", async () => {
    let sends = 0,
        current = true;
    const deps = {
        assertCurrent() {
            if (!current) throw new Error("scope changed");
        },
        persist: async () => {
            throw new Error("disk full");
        },
        project,
        receipt: async () => null,
        submit: async () => {
            sends++;
            return task;
        },
    };
    await expect(submitEcommerceIntents([item()], deps)).rejects.toThrow("disk full");
    expect(sends).toBe(0);
    await expect(
        submitEcommerceIntents([item()], {
            ...deps,
            persist: async () => {
                current = false;
            },
        }),
    ).rejects.toThrow("scope changed");
    expect(sends).toBe(0);
});

test("明确拒绝保留后续未发送项，未知重试的拒绝仍保留回执风险", async () => {
    const deps = {
        assertCurrent() {},
        persist: async () => {},
        project,
        receipt: async () => null,
        submit: async () => {
            throw new ApiError("stale quote", { status: 409 });
        },
    };
    const rejected = await submitEcommerceIntents([item(), item(1)], deps);
    expect(rejected.map((j) => j.phase)).toEqual(["rejected", "ready"]);
    const uncertain = await retryEcommerceUnknown([{ ...item(), phase: "unknown", checked: true }], deps);
    expect(uncertain[0].phase).toBe("unknown");
    expect(uncertain[0].checked).toBe(false);
});

test("终止 UNKNOWN 先固定 revision 再查询，仅新轮 CAS 成功后清暂存", async () => {
    const events: string[] = [],
        saved: EcommerceIntent[][] = [];
    const original = [{ ...item(), phase: "unknown" as const, checked: true }];
    const deps = {
        assertCurrent() {},
        project: async () => {
            events.push("project");
            return { id: pid, revision: 7 } as EcommerceProject;
        },
        receipt: async () => {
            events.push("receipt");
            return null;
        },
        persist: async (items: EcommerceIntent[]) => {
            saved.push(structuredClone(items));
        },
        submit: async () => {
            throw new Error("must not generate");
        },
        newRound: async (before: EcommerceProject) => {
            events.push("fence");
            expect(before.revision).toBe(7);
            expect(saved.every((items) => items.length > 0)).toBe(true);
            return { ...before, revision: 8 };
        },
    };
    const next = await stopEcommerceUnknown(original, deps);
    expect(events).toEqual(["project", "receipt", "fence"]);
    expect(saved.at(-1)).toEqual([]);
    expect(next.stopped).toBe(true);
    expect(next.project.revision).toBe(8);
    const before = saved.length;
    await expect(
        stopEcommerceUnknown(original, {
            ...deps,
            newRound: async () => {
                throw new ApiError("revision conflict", { status: 409 });
            },
        }),
    ).rejects.toThrow("revision conflict");
    expect(saved.slice(before).every((items) => items.length > 0)).toBe(true);
    await expect(
        stopEcommerceUnknown(original, {
            ...deps,
            newRound: async () => {
                throw new Error("response lost");
            },
        }),
    ).rejects.toThrow("response lost");
    expect(original[0].phase).toBe("unknown");
});

test("终止前发现已受理任务时只恢复回执；新轮后本地清理失败继续阻止发送", async () => {
    const original = [{ ...item(), phase: "unknown" as const, checked: true }];
    let fences = 0;
    const deps = {
        assertCurrent() {},
        project,
        receipt: async () => task,
        persist: async () => {},
        submit: async () => {
            throw new Error("must not generate");
        },
        newRound: async (p: EcommerceProject) => {
            fences++;
            return p;
        },
    };
    const found = await stopEcommerceUnknown(original, deps);
    expect(found.stopped).toBe(false);
    expect(found.items[0].phase).toBe("accepted");
    expect(fences).toBe(0);
    await expect(
        stopEcommerceUnknown(original, {
            ...deps,
            receipt: async () => null,
            persist: async (items) => {
                if (!items.length) throw new Error("cache unavailable");
            },
        }),
    ).rejects.toThrow("cache unavailable");
    expect(original[0].phase).toBe("unknown");
    expect(fences).toBe(1);
});
