import { expect, test } from "bun:test";
import { productSalesVideoApproaches, productVideoApproaches, productVideoPurposes, salesVideoStyle } from "@/pages/ecommerce/product-video-approaches";
import { presenterVoicePrompt, videoPlanningPrompt } from "@/pages/ecommerce/product-video-planning";
import { emptyEcommerceDraft } from "@/services/api/ecommerce";

test("each purpose offers three different openings that match the first editable shot", () => {
    const draft = { productName: "无线耳机", scene: "通勤地铁" };
    const scripts = productVideoPurposes.flatMap(({ id }) => {
        const approaches = productVideoApproaches(id, draft);
        expect(approaches).toHaveLength(3);
        return approaches;
    });
    expect(new Set(scripts.map((script) => script.id)).size).toBe(9);
    expect(new Set(scripts.map((script) => script.opening)).size).toBe(9);
    for (const script of scripts) {
        expect(script.shots).toHaveLength(3);
        expect(script.opening).toBe(script.shots[0]);
        expect(script.opening).toContain("无线耳机");
        expect(script.shots.every((shot) => Boolean(shot.trim()))).toBe(true);
    }
    expect(productVideoApproaches("lifestyle", draft).every((script) => script.shots.join("").includes("通勤地铁"))).toBe(true);
});

test("the same approaches are available before a product is named and long names stay outside the shot text", () => {
    const empty = { productName: "  ", scene: "" };
    const long = { productName: "长商品名".repeat(40), scene: "复杂场景".repeat(40) };
    for (const { id } of productVideoPurposes) {
        const approaches = productVideoApproaches(id, empty);
        expect(productVideoApproaches(id, long)).toEqual(approaches);
        expect(approaches.every((script) => script.opening.includes("这件商品"))).toBe(true);
    }
});

test("editing a chosen shot leaves the preset intact the next time it is opened", () => {
    const draft = { productName: "帆布袋", scene: "公园" };
    const [first] = productVideoApproaches("lifestyle", draft);
    first.shots[1] = "我手动调整的镜头";
    const [fresh] = productVideoApproaches("lifestyle", draft);
    expect(fresh.shots[1]).not.toBe(first.shots[1]);
});

test("all sales approaches ground the three shots in the buyer, confirmed fact, and requested close", () => {
    const draft = { productName: "折叠杯", audience: "短途旅行者", scene: "高铁桌板" };
    const facts = "\n杯盖带挂环，仅适配本款。\n侧面有刻度";
    for (const { id } of productVideoPurposes) {
        const sales = productSalesVideoApproaches(id, draft, facts, "定格环扣连接处");
        expect(sales).toHaveLength(3);
        for (const item of productVideoApproaches(id, draft)) expect(salesVideoStyle(item.id)).toBeUndefined();
        for (const item of sales) expect(salesVideoStyle(item.id)?.title).toBe(item.title);
        for (const { opening, shots } of sales) {
            expect(opening).toBe(shots[0]);
            expect(shots[0]).toContain(draft.productName);
            expect(shots[0]).toContain(draft.audience);
            if (id === "lifestyle") expect(shots[0]).toContain(draft.scene);
            expect(shots[1]).toContain("杯盖带挂环，仅适配本款。");
            expect(shots[2]).toContain("定格环扣连接处");
        }
    }
});

test("sales presets distinguish hosts, narrated footage, and silent demonstrations in AI planning", () => {
    const draft = { ...emptyEcommerceDraft(), language: "ja", productName: "折叠杯" };
    for (const [purpose, id, mode, label] of [
        ["showcase", "host-pick", "host", "出镜口播"],
        ["lifestyle", "daily-pick", "voiceover", "画外解说"],
        ["demo", "how-to", "silent", "无口播"],
    ] as const) {
        const preset = productSalesVideoApproaches(purpose, draft, "杯盖带挂环").find((item) => item.id === id)!;
        const story = { purpose, approachId: id, edited: false, shots: preset.shots };
        expect(salesVideoStyle(id)?.voiceMode).toBe(mode);
        const plan = videoPlanningPrompt(draft, "杯盖带挂环", story, "all", "", undefined, undefined, true);
        expect(JSON.parse(plan.split("\n").at(-1)!)).toMatchObject({ 用途: preset.title, 讲述方式: label, 成片语言: "ja" });
        if (mode !== "silent") {
            const voice = presenterVoicePrompt(draft, "杯盖带挂环", story, "", undefined, "", "", true);
            expect(JSON.parse(voice.split("\n").at(-1)!)).toMatchObject({ 带货拍法: preset.title, 口播方式: label, 输出语言: "ja" });
        }
    }
    expect(salesVideoStyle("reveal")).toBeUndefined();
    expect(salesVideoStyle("toString")).toBeUndefined();
});

test("without a product claim or close each sales approach offers a visual basis for a choice", () => {
    const blank = { productName: "", audience: "", scene: "" };
    const sales = productVideoPurposes.flatMap(({ id }) => productSalesVideoApproaches(id, blank, ""));
    expect(new Set(sales.map((item) => item.opening)).size).toBe(9);
    expect(new Set(sales.map((item) => item.shots[2])).size).toBe(9);
    for (const { shots } of sales) {
        expect(shots[1]).not.toContain("围绕「");
        expect(shots.join("")).not.toMatch(/undefined|折扣|限时抢购|立即下单/);
    }
});

test("AI suggestions carry the matching sales purpose for a single shot while preserving the input draft", () => {
    const draft = { ...emptyEcommerceDraft(), audience: "短途旅行者" };
    const story = { purpose: "demo" as const, shots: ["我手写的开场", "指向环扣", "看全貌"], edited: true };
    const prompt = videoPlanningPrompt(draft, "杯盖带挂环", story, 1, "展示细节", undefined, undefined, true);
    expect(prompt).toContain("只改写第2镜");
    expect(prompt).toContain("缺少操作依据时，改拍外形和部位位置");
    expect(prompt).toContain("卖点无法用画面核实");
    expect(prompt).toContain("我手写的开场");
    expect(story.shots).toEqual(["我手写的开场", "指向环扣", "看全貌"]);
    expect(videoPlanningPrompt(draft, "", story, 1, "")).not.toContain("按带货节奏");
    expect(videoPlanningPrompt(draft, "", story, 1, "", { delivery: "recommend", voice: "你好" }, undefined, true)).not.toContain("按带货节奏");
});
