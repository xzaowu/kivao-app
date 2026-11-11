import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
const original = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    ResizeObserver: dom.ResizeObserver,
    localStorage: dom.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AgentConversation } = await import("../../src/components/canvas/canvas-cloud-agent-panel-parts");
const { canvasThemes } = await import("../../src/lib/canvas-theme");
const noop = () => {};
const messages = Object.freeze(Array.from({ length: 200 }, (_, i) => Object.freeze({ id: `history-${i}`, role: "user" as const, text: `history-text-${String(i).padStart(3, "0")}` })));

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of original) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

for (const theme of [canvasThemes.light, canvasThemes.dark]) {
    test(`long conversation renders a bounded history and keeps every message available (${theme === canvasThemes.dark ? "dark" : "light"})`, async () => {
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);
        try {
            await act(async () =>
                root.render(
                    <AgentConversation
                        theme={theme}
                        messages={[...messages]}
                        references={[]}
                        busy={false}
                        approval={null}
                        approvalSubmitting={false}
                        nodeCount={0}
                        installedSkillCount={0}
                        onChooseSkill={noop}
                        onOpenSkillRecommendations={noop}
                        onDraftPrompt={noop}
                        onApprovalReasonChange={noop}
                        onApprove={noop}
                        onReject={noop}
                    />,
                ),
            );
            const content = host.querySelector(".agent-conversation-messages")!;
            expect(content.textContent).toContain("history-text-199");
            expect(content.textContent).not.toContain("history-text-119");
            expect(content.textContent?.match(/history-text-\d+/g)).toHaveLength(80);
            const earlier = () => [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("加载更早"));
            expect(earlier()).toBeDefined();
            await act(async () => earlier()!.click());
            expect(content.textContent?.match(/history-text-\d+/g)).toHaveLength(160);
            expect(content.textContent).toContain("history-text-040");
            await act(async () => earlier()!.click());
            expect(content.textContent?.match(/history-text-\d+/g)).toHaveLength(200);
            expect(content.textContent).toContain("history-text-000");
            expect(earlier()).toBeUndefined();
            expect(messages).toHaveLength(200);
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    });
}

test("a short conversation has no history-loading command", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
        await act(async () =>
            root.render(
                <AgentConversation
                    theme={canvasThemes.light}
                    messages={[...messages.slice(0, 2)]}
                    references={[]}
                    busy={false}
                    approval={null}
                    approvalSubmitting={false}
                    nodeCount={0}
                    installedSkillCount={0}
                    onChooseSkill={noop}
                    onOpenSkillRecommendations={noop}
                    onDraftPrompt={noop}
                    onApprovalReasonChange={noop}
                    onApprove={noop}
                    onReject={noop}
                />,
            ),
        );
        expect(host.textContent).not.toContain("加载更早");
        expect(host.textContent).toContain("history-text-000");
    } finally {
        await act(async () => root.unmount());
    }
});
