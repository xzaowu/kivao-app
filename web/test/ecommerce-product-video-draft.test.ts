import { afterAll, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import * as storage from "@/lib/localforage-storage";
import { promoteProductVideoDraft, readProductVideoDraft, writeProductVideoDraft, type ProductVideoDraft } from "@/pages/ecommerce/product-video-draft";

const stored = new Map<string, string>();
const scopedStore = spyOn(storage, "localForageStorageForScope");
const draft: ProductVideoDraft = { scope: "shop", sessionId: "session", chosenImage: "", chosenModel: "video", facts: "", purpose: "showcase", picking: false, story: null, voice: "带货台词" };

beforeAll(() => {
    scopedStore.mockImplementation((scope) => ({
        getItem: (key) => stored.get(scope + "/" + key) ?? null,
        setItem: (key, value) => {
            stored.set(scope + "/" + key, value);
        },
        removeItem: (key) => {
            stored.delete(scope + "/" + key);
        },
    }));
});
beforeEach(() => {
    stored.clear();
});
afterAll(() => scopedStore.mockRestore());

test("draft promotion and a new session retain separate shopping, remake, and presenter scripts", async () => {
    const referenceScript = { purpose: "demo" as const, candidateId: "follow-steps", picking: false, story: { purpose: "demo" as const, shots: ["远景", "跟拍手部", "收尾"], edited: true }, voice: "复刻台词" };
    const presenterPhoto = { resourceId: "presenter-frame", name: "合成同框图", source: "composite" as const };
    await writeProductVideoDraft({ ...draft, referenceScript, presenterVoice: "人物台词", presenterPhoto });
    await promoteProductVideoDraft(draft.scope, draft.sessionId, "project");
    expect(await readProductVideoDraft(draft.scope, "next", "project")).toMatchObject({ sessionId: "next", projectId: "project", story: null, voice: "带货台词", referenceScript, presenterVoice: "人物台词", presenterPhoto });
    expect(await readProductVideoDraft(draft.scope, draft.sessionId)).toBeNull();
});

test("older remake drafts retain their original voice and leave new script fields absent", async () => {
    await writeProductVideoDraft({ ...draft, mode: "reference" });
    const read = await readProductVideoDraft(draft.scope, draft.sessionId);
    expect(read).toMatchObject({ mode: "reference", voice: draft.voice });
    expect(read?.referenceScript).toBeUndefined();
    expect(read?.presenterVoice).toBeUndefined();
});

test("product references retain the selected order, explicit empty selection, and legacy absence", async () => {
    const images = ["back", "front", "side"].map((resourceId) => ({ resourceId, name: resourceId, source: "library" as const }));
    for (const productImages of [undefined, [], images]) {
        await writeProductVideoDraft({ ...draft, productImages });
        expect((await readProductVideoDraft(draft.scope, draft.sessionId))?.productImages).toEqual(productImages);
    }
    const key = Array.from(stored.keys())[0];
    for (const productImages of [null, {}, [images[0], images[0]], [...images, { ...images[0], resourceId: "four" }], [{ resourceId: "not/a/resource", name: "x" }]]) {
        stored.set(key, JSON.stringify({ ...draft, productImages }));
        await expect(readProductVideoDraft(draft.scope, draft.sessionId)).rejects.toThrow(/格式异常/);
    }
});

test("malformed stored mode scripts are rejected while an empty separate draft can be restored", async () => {
    const referenceScript = { purpose: "demo", picking: true, story: null, voice: "" } as const;
    await writeProductVideoDraft({ ...draft, referenceScript, presenterVoice: "", presenterPhoto: null });
    expect(await readProductVideoDraft(draft.scope, draft.sessionId)).toMatchObject({ referenceScript, presenterVoice: "", presenterPhoto: null });
    const key = Array.from(stored.keys())[0];
    for (const override of [
        { presenterVoice: null },
        { presenterPhoto: { resourceId: "", name: "同框图" } },
        { referenceScript: null },
        ...[{ purpose: "bad" }, { story: {} }, { story: undefined }, { candidateId: 3 }, { picking: "yes" }, { voice: false }].map((invalid) => ({ referenceScript: { ...referenceScript, ...invalid } })),
    ]) {
        stored.set(key, JSON.stringify({ ...draft, ...override }));
        await expect(readProductVideoDraft(draft.scope, draft.sessionId)).rejects.toThrow(/草稿格式异常/);
    }
});
