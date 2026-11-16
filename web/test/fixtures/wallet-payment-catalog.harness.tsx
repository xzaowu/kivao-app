import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { PaymentProvider, TopupProduct } from "../../src/services/api/payments";

const dom = new Window({ url: "http://localhost/" });
for (const key of ["document", "navigator", "HTMLElement", "HTMLBodyElement", "HTMLHtmlElement", "Element", "SVGElement", "ShadowRoot", "Node", "MutationObserver", "ResizeObserver"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom[key] });
}
Object.assign(globalThis, {
    window: dom,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
});
const product: TopupProduct = {
    id: "credits",
    name: "测试套餐",
    kind: "credits",
    amountFen: 100,
    currency: "CNY",
    creditsMicrocredits: 1000000,
    storageBytes: 0,
    storageDurationDays: 0,
    enabled: true,
    sortOrder: 0,
    saleStrategy: "unlimited",
    canPurchase: true,
    createdBy: "",
    updatedBy: "",
    createdAt: "",
    updatedAt: "",
};
const provider: PaymentProvider = { id: "test", pluginId: "test", name: "测试支付", icon: "", checkoutMode: "qr_code", enabled: true, pluginEnabled: true, configured: true, closeAfterMinutes: 15 };
const products = mock(async (_signal?: AbortSignal) => ({ products: [product] }));
const providers = mock(async (_signal?: AbortSignal) => ({ providers: [provider] }));
const settings = mock(async (_signal?: AbortSignal) => ({ settings: { usdCnyRate: "7" } }));
mock.module("../../src/services/api/payments", () => ({
    listTopupProducts: products,
    listPaymentProviders: providers,
    getPaymentSettings: settings,
    formatPaymentAmount: (value: number) => (value / 100).toFixed(2),
}));
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { useWalletPaymentCatalog, walletPaymentCatalogQueryKey } = await import("../../src/components/layout/workspace-wallet-catalog");
const { WalletTopupPanel } = await import("../../src/components/layout/workspace-wallet-topup");
let root: ReturnType<typeof createRoot> | undefined;
let client: InstanceType<typeof QueryClient>;
let current: ReturnType<typeof useWalletPaymentCatalog>;
const onPay = mock(() => {});

function Consumer({ userId, open }: { userId: string; open: boolean }) {
    current = useWalletPaymentCatalog(userId, open);
    return (
        <WalletTopupPanel
            loading={current.productsLoading}
            paymentLoading={current.loading}
            paymentReady={current.ready}
            catalogError={current.error?.message}
            onRefresh={() => void current.refresh()}
            products={current.products}
            paymentOptions={current.paymentOptions}
            selectedProduct={current.products[0]}
            onSelectProduct={() => {}}
            selectedOptionKey={current.paymentOptions[0]?.key ?? ""}
            onSelectOption={() => {}}
            creating={false}
            onPay={onPay}
            storageGrants={[]}
            onCleanAssets={() => {}}
        />
    );
}
async function render(userId = "user-a", open = true) {
    if (!root) {
        const host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    }
    await act(async () =>
        root!.render(
            <QueryClientProvider client={client}>
                <Consumer userId={userId} open={open} />
            </QueryClientProvider>,
        ),
    );
}
async function until(condition: () => boolean) {
    for (let i = 0; i < 100; i++) {
        if (condition()) return;
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    }
    expect(condition()).toBe(true);
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined;
    client?.clear();
    document.body.innerHTML = "";
    products.mockReset();
    products.mockImplementation(async () => ({ products: [product] }));
    providers.mockReset();
    providers.mockImplementation(async () => ({ providers: [provider] }));
    settings.mockReset();
    settings.mockImplementation(async () => ({ settings: { usdCnyRate: "7" } }));
    onPay.mockClear();
});
afterAll(() => dom.happyDOM.abort());

test("慢渠道返回前先展示套餐，禁止提前下单；短期重开复用三个配置请求", async () => {
    const pending = deferred<{ providers: PaymentProvider[] }>();
    providers.mockImplementation(() => pending.promise);
    await render();
    await until(() => current.products.length === 1);
    expect(document.body.textContent).toContain(product.name);
    expect(current.ready).toBe(false);
    const pay = document.querySelector<HTMLButtonElement>(".wallet-topup-checkout button.ant-btn-primary");
    expect(pay?.disabled).toBe(true);
    await act(async () => pending.resolve({ providers: [provider] }));
    await until(() => current.ready);
    expect(pay?.disabled).toBe(false);
    await render("user-a", false);
    await render("user-a", true);
    expect(products).toHaveBeenCalledTimes(1);
    expect(providers).toHaveBeenCalledTimes(1);
    expect(settings).toHaveBeenCalledTimes(1);
});

test("刷新失败保留已读套餐并禁止下单，重试读取停用渠道的新状态", async () => {
    await render();
    await until(() => current.ready);
    providers.mockRejectedValueOnce(new Error("测试渠道读取失败"));
    await act(async () => {
        await current.refresh();
    });
    await until(() => Boolean(current.error));
    expect(current.ready).toBe(false);
    expect(document.body.textContent).toContain(product.name);
    expect(document.querySelector("[role=alert]")?.textContent).toContain("测试渠道读取失败");
    expect(document.querySelector<HTMLButtonElement>(".wallet-topup-checkout button.ant-btn-primary")?.disabled).toBe(true);
    providers.mockResolvedValueOnce({ providers: [{ ...provider, enabled: false }] });
    const retry = document.querySelector<HTMLButtonElement>("[role=alert] button")!;
    await act(async () => retry.click());
    await until(() => current.ready);
    expect(current.paymentOptions).toEqual([]);
    expect(document.querySelector<HTMLButtonElement>(".wallet-topup-checkout button.ant-btn-primary")?.disabled).toBe(true);
});

test("过期重开重新读取配置；账号切换不显示旧套餐，游客不请求配置", async () => {
    await render("", true);
    expect(products).not.toHaveBeenCalled();
    await render();
    await until(() => current.ready);
    await render("user-a", false);
    for (const suffix of ["products", "providers", "settings"]) {
        const key = [...walletPaymentCatalogQueryKey("user-a"), suffix];
        client.setQueryData(key, client.getQueryData(key), { updatedAt: Date.now() - 31_000 });
    }
    await render("user-a", true);
    await until(() => current.ready && products.mock.calls.length === 2);
    const pending = deferred<{ products: TopupProduct[] }>();
    products.mockImplementationOnce(() => pending.promise);
    await render("user-b", true);
    expect(current.products).toEqual([]);
    expect(document.body.textContent).not.toContain(product.name);
    await act(async () => pending.resolve({ products: [{ ...product, id: "other", name: "另一账号套餐" }] }));
    await until(() => current.ready);
    expect(current.products[0].id).toBe("other");
});

test("切换账号会取消旧账号在途配置请求，晚响应不覆盖新账号", async () => {
    const pending = deferred<{ providers: PaymentProvider[] }>();
    let oldSignal: AbortSignal | undefined;
    providers.mockImplementationOnce((signal) => {
        oldSignal = signal;
        return pending.promise;
    });
    await render();
    await render("user-b");
    await until(() => current.ready);
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => pending.resolve({ providers: [] }));
    expect(current.paymentOptions).toHaveLength(1);
    expect(client.getQueryData([...walletPaymentCatalogQueryKey("user-a"), "providers"])).toBeUndefined();
});
