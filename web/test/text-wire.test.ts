import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { beginUserScopeTransition } from "../src/lib/user-scope";
import { defaultConfig, createModelChannel, type AiConfig } from "../src/stores/use-config-store";
import { http } from "../src/services/api/request";
import { requestImageQuestion, requestToolResponse } from "../src/services/api/image";
import { resolveTextRequestConfig } from "../src/services/api/text-wire";
import type { TextWire } from "../src/lib/model-protocols";

const catalog = spyOn(http, "get");
const send = spyOn(globalThis, "fetch");
afterEach(() => { catalog.mockReset(); send.mockReset(); });
afterAll(() => { catalog.mockRestore(); send.mockRestore(); });

function configFor(protocol: string, wire?: TextWire): AiConfig {
    const channel = createModelChannel({ id: "fixture", name: "Fixture", scope: wire ? "system" : "user", baseUrl: wire ? "/api/fixture" : "https://example.invalid/v1", apiKey: "fixture-key", models: ["test-model"], interfaceType: protocol, modelCosts: [{ model: "test-model", protocol, textWire: wire, capability: "text", billingMode: "fixed_request", unitPriceMicrocredits: 1 }] });
    return { ...defaultConfig, model: "test-model", channels: [channel] };
}

function provide(wire: TextWire, extra: Record<string, unknown> = {}) {
    catalog.mockResolvedValue({ providers: [{ id: "alias", name: "Alias", version: "1.0.0", vendor: "Fixture", categories: ["text"], scopes: ["user.custom-channel"], enabled: true, textWire: wire, ...extra }] } as never);
}

const fixtures: Array<{ wire: TextWire; path: string; events: string }> = [
    { wire: "chat-completion", path: "/chat/completions", events: 'data: {"choices":[{"delta":{"content":"draft"}}]}\n\ndata: [DONE]\n\n' },
    { wire: "responses", path: "/responses", events: 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"draft"}\n\nevent: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","output_text":"draft"}}\n\n' },
    { wire: "claude-api", path: "/messages", events: 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"draft"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n' },
];

describe("declared plugin text wires", () => {
    for (const fixture of fixtures) for (const system of [false, true]) {
        test(`${fixture.wire} ${system ? "system model" : "custom catalog"} sends the matching body and reads its stream`, async () => {
            provide(fixture.wire);
            send.mockImplementation(async (_url, init) => {
                const headers = new Headers(init?.headers);
                const target = system ? String(_url) : headers.get("X-Canvas-Upstream-URL")!;
                expect(target.endsWith(fixture.path)).toBe(true);
                expect(init?.credentials).toBe("include");
                const body = JSON.parse(String(init?.body));
                expect(body.model).toBe("test-model");
                expect(body.stream).toBe(true);
                expect(fixture.wire === "responses" ? body.input : body.messages).toBeArray();
                if (!system) expect(headers.get("X-Canvas-Upstream-Format")).toBe(fixture.wire === "claude-api" ? "claude" : "openai");
                return new Response(fixture.events, { headers: { "Content-Type": "text/event-stream" } });
            });
            const answer = await requestImageQuestion(configFor("alias", system ? fixture.wire : undefined), [{ role: "user", content: "hello" }], () => {});
            expect(answer).toBe("draft");
            expect(send).toHaveBeenCalledTimes(1);
            expect(catalog).toHaveBeenCalledTimes(system ? 0 : 1);
        });
    }

    for (const extra of [{ enabled: false }, { unavailableReason: "disabled" }, { textWire: "unknown" }, { id: "different" }, { requiresSecretKey: true }]) {
        test(`unusable custom declaration fails before sending: ${JSON.stringify(extra)}`, async () => {
            provide("chat-completion", extra);
            await expect(requestImageQuestion(configFor("alias"), [], () => {})).rejects.toThrow();
            expect(send).not.toHaveBeenCalled();
        });
    }

    test("a missing system contract never borrows a user plugin", async () => {
        const config = configFor("alias", "responses");
        delete config.channels[0].modelCosts![0].textWire;
        await expect(requestImageQuestion(config, [], () => {})).rejects.toThrow("当前文本协议不可用");
        expect(catalog).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    test("catalog failure is not a Responses fallback", async () => {
        catalog.mockRejectedValue(new Error("catalog unavailable"));
        await expect(requestImageQuestion(configFor("alias"), [], () => {})).rejects.toThrow("catalog unavailable");
        expect(send).not.toHaveBeenCalled();
    });

    test("switching sessions during catalog lookup cancels the request", async () => {
        catalog.mockImplementation(async () => {
            beginUserScopeTransition()();
            return { providers: [{ id: "alias", categories: ["text"], enabled: true, textWire: "responses" }] } as never;
        });
        await expect(requestImageQuestion(configFor("alias"), [], () => {})).rejects.toThrow("账号会话已变化");
        expect(send).not.toHaveBeenCalled();
    });

    test("an alias never inherits the builtin tool_choice retry", async () => {
        provide("chat-completion");
        send.mockResolvedValue(new Response('{"error":{"message":"tool_choice unsupported"}}', { status: 400, headers: { "Content-Type": "application/json" } }));
        await expect(requestToolResponse(configFor("alias"), [{ role: "user", content: "hello" }], [], "required")).rejects.toThrow();
        expect(send).toHaveBeenCalledTimes(1);
    });

    test("known builtin formats and legacy no-protocol configuration remain usable", async () => {
        for (const [id, wire] of [["chat-completion", "chat-completion"], ["openai-response", "responses"], ["claude-api", "claude-api"], ["", "chat-completion"]]) {
            expect((await resolveTextRequestConfig(configFor(id))).textWire).toBe(wire);
        }
        expect(catalog).not.toHaveBeenCalled();
    });
});
