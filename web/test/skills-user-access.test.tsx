import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { Skill } from "@/services/api/skills";

const dom = new Window({ url: "https://skills.example.com/skills" });
const globals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router");
const { App } = await import("antd");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { apiClient } = await import("@/services/api/request");
const { invalidateAddedSkillsCache } = await import("@/services/api/skills");
const { useUserStore } = await import("@/stores/use-user-store");
const { default: SkillsPage } = await import("@/pages/skills");
const { PromptSkillField } = await import("@/pages/projects/prompt-skill");

const skill: Skill = {
    skillId: "legacy-owned",
    skillName: "已有技能",
    description: "可继续使用的工作法",
    instruction: "# 工作法正文",
    versionId: "v1",
    version: "1",
    contentHash: "hash",
    fileCount: 1,
    totalBytes: 30,
    sourceType: "github",
    sourceUrl: "",
    sourceRef: "main",
    sourceSubdir: "",
    sourceCommit: "",
    syncStatus: "synced",
    autoUpdate: false,
    status: 1,
    markdownUrl: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    source: 0,
    tag: "drama",
    sortWeight: 0,
    isPrivate: false,
    likeCount: 0,
    isLike: false,
    ownerUid: "member",
    effectiveUser: { name: "用户", avatarUrl: "", uid: "member" },
    originalSkillId: null,
    showcaseMedia: [],
    addedCount: 1,
    isTest: false,
    extraInfo: "",
    isAdded: true,
    isOwner: true,
};
const file = { path: "SKILL.md", kind: "markdown", mimeType: "text/markdown", size: 30, sha256: "hash" };
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let request: ReturnType<typeof spyOn<typeof apiClient, "request">>;

beforeEach(() => {
    invalidateAddedSkillsCache();
    useUserStore.setState({ hydrated: true, user: { id: "member", username: "member", displayName: "Member", role: "user", status: "active" } });
    request = spyOn(apiClient, "request").mockImplementation((async (config) => {
        let data: unknown;
        if (config.url?.startsWith("/skills?")) data = { skills: [skill], totalCount: 1, hasMore: false, nextOffset: 0, page: 1, pageSize: 20, categories: [] };
        else if (config.url === "/skills/added") data = { skills: [skill, { ...skill, skillId: "second", skillName: "第二个技能" }] };
        else if (config.url === "/skills/legacy-owned/like" && config.method === "post") data = { skill: { ...skill, isLike: true, likeCount: 1 } };
        else if (config.url === "/skills/curation") data = { enabled: false, revision: 0, categories: [], assignments: [] };
        else if (config.url === "/skills/library-categories") data = { categories: [], totalCount: 1, uncategorizedCount: 1 };
        else if (config.url === "/skills/legacy-owned/files") data = { files: [file] };
        else if (config.url === "/skills/legacy-owned/file") data = { file: { file, content: "# 工作法正文", binary: false } };
        else if (config.url === "/skills/legacy-owned") data = { skill };
        else throw new Error(`Unexpected skill request: ${config.method} ${config.url}`);
        return { data: { code: 0, data, msg: "ok" }, status: 200, headers: {} };
    }) as typeof apiClient.request);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    invalidateAddedSkillsCache();
    host.remove();
    request.mockRestore();
    useUserStore.setState({ hydrated: false, user: null });
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("普通用户可查看技能名称、标签、图标与计数并收藏，只有管理员能打开源码", async () => {
    await act(async () =>
        root.render(
            <MemoryRouter>
                <App>
                    <SkillsPage />
                </App>
            </MemoryRouter>,
        ),
    );
    expect(host.textContent).toContain("已有技能");
    const tile = host.querySelector(".skill-tile")!;
    expect(tile.querySelector(".skill-tile-chip")?.textContent).toBe("短剧影视");
    expect(tile.querySelector(".skill-tile-glyph")).not.toBeNull();
    expect(tile.textContent).toContain("1 人加入");
    expect(tile.textContent).not.toContain(skill.description);
    expect(tile.textContent).not.toContain("工作法正文");
    expect(tile.querySelector('button[aria-label="已加入已有技能"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(host.textContent).not.toContain("安装技能");
    expect(host.querySelector(".skill-tile-edit")).toBeNull();
    await act(async () => tile.querySelector<HTMLButtonElement>('button[aria-label="收藏已有技能，0 人收藏"]')!.click());
    expect(tile.querySelector('button[aria-label="取消收藏已有技能，1 人收藏"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(tile.querySelector('button[title="已有技能"]')).toBeNull();
    expect(request.mock.calls.some(([config]) => /^\/skills\/legacy-owned(?:$|\/files?)/.test(config.url || ""))).toBe(false);
    await act(async () => useUserStore.setState({ user: { ...useUserStore.getState().user!, role: "admin" } }));
    expect(host.textContent).toContain("安装技能");
    expect(host.querySelector(".skill-tile-edit")).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('button[title="已有技能"]')!.click());
    const detail = document.querySelector(".skill-package-shell")!;
    expect(detail.textContent).toContain("工作法正文");
    expect(detail.querySelector(".skill-package-actions")?.textContent).toContain("同步");
    expect(detail.querySelector(".skill-package-actions")?.textContent).toContain("技能信息");
});

test("普通用户可更换短剧写作技能，编辑工作台只向管理员展示", async () => {
    const client = new QueryClient();
    const change = mock();
    await act(async () =>
        root.render(
            <MemoryRouter>
                <QueryClientProvider client={client}>
                    <PromptSkillField value={{ skillId: skill.skillId, skillName: skill.skillName, path: "SKILL.md" }} onChange={change} />
                </QueryClientProvider>
            </MemoryRouter>,
        ),
    );
    expect(host.textContent).toContain("已有技能");
    const input = host.querySelector<HTMLInputElement>('[role="combobox"][aria-label="选择写作技能"]')!;
    await act(async () => {
        input.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bubbles: true }));
    });
    const option = Array.from(document.querySelectorAll<HTMLElement>(".ant-select-item-option")).find((item) => item.textContent === "第二个技能")!;
    await act(async () => option.click());
    expect(change).toHaveBeenCalledWith({ skillId: "second", skillName: "第二个技能", path: "SKILL.md" });
    expect(request.mock.calls.map(([config]) => config.url)).toEqual(["/skills/added"]);
    expect(document.body.textContent).not.toContain("工作法正文");
    expect(host.querySelector(".drama-pskill-edit")).toBeNull();
    await act(async () => useUserStore.setState({ user: { ...useUserStore.getState().user!, role: "admin" } }));
    expect(host.querySelector(".drama-pskill-edit")?.getAttribute("href")).toBe("/skills/legacy-owned/edit");
    client.clear();
});
