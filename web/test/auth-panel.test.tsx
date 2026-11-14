import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

import { AuthPanel } from "../src/components/auth/auth-panel";
import { AuthRoutePanel } from "../src/pages/auth/auth-route-panel";

const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
let dom: Window;

beforeEach(() => {
    dom = new Window({ url: "http://localhost:3000/" });
    for (const [key, value] of Object.entries({ window: dom, document: dom.document, HTMLElement: dom.HTMLElement, Element: dom.Element, SVGElement: dom.SVGElement, ShadowRoot: dom.ShadowRoot, getComputedStyle: dom.getComputedStyle.bind(dom) })) {
        originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
});

afterEach(async () => {
    await dom.happyDOM.close();
    for (const [key, descriptor] of originalGlobals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
    originalGlobals.clear();
});

describe("全局登录弹窗", () => {
    test("登录面板在 RouterProvider 外仍能显示账号密码表单", () => {
        const markup = renderToStaticMarkup(<AuthPanel variant="dialog" view="login" next="/" onViewChange={() => {}} onAuthenticated={() => {}} />);

        expect(markup).toContain('autoComplete="username"');
        expect(markup).toContain('type="password"');
        expect(markup).toContain('type="submit"');
    });

    test("微信回跳路由仍显示补全注册面板", () => {
        const markup = renderToStaticMarkup(
            <MemoryRouter initialEntries={["/register?wechat_register=1"]}>
                <AuthRoutePanel view="register" />
            </MemoryRouter>,
        );

        expect(markup).toContain("ant-skeleton");
        expect(markup).not.toContain('autoComplete="username"');
    });
});
