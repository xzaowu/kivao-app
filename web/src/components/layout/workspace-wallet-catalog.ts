import { useQuery } from "@tanstack/react-query";

import { paymentOptionsFromProviders, type PaymentOption } from "@/lib/payment-options";
import { getPaymentSettings, listPaymentProviders, listTopupProducts, type PaymentProvider, type TopupProduct } from "@/services/api/payments";

const emptyProducts: TopupProduct[] = [];
const emptyOptions: PaymentOption[] = [];
const selectProducts = (data: { products: TopupProduct[] }) => data.products.filter((item) => item.enabled);
const selectOptions = (data: { providers: PaymentProvider[] }) => paymentOptionsFromProviders(data.providers.filter((item) => item.enabled && item.pluginEnabled && item.configured));

export const walletPaymentCatalogQueryKey = (userId: string) => ["wallet-payment-catalog", userId] as const;

/** Cache display metadata briefly; payment writes still validate current prices and availability. */
export function useWalletPaymentCatalog(userId: string, open: boolean) {
    const options = { enabled: open && Boolean(userId), staleTime: 30_000, gcTime: 120_000, retry: false } as const;
    const key = walletPaymentCatalogQueryKey(userId);
    const products = useQuery({ ...options, queryKey: [...key, "products"], queryFn: ({ signal }) => listTopupProducts(signal), select: selectProducts });
    const providers = useQuery({ ...options, queryKey: [...key, "providers"], queryFn: ({ signal }) => listPaymentProviders(signal), select: selectOptions });
    const settings = useQuery({ ...options, queryKey: [...key, "settings"], queryFn: ({ signal }) => getPaymentSettings(signal) });
    const error = products.error || providers.error || settings.error;
    return {
        products: products.data ?? emptyProducts,
        paymentOptions: providers.data ?? emptyOptions,
        usdCnyRate: settings.data?.settings.usdCnyRate || "",
        productsLoading: products.isPending && !products.isError,
        loading: products.isFetching || providers.isFetching || settings.isFetching,
        ready: products.isSuccess && providers.isSuccess && settings.isSuccess && !products.isFetching && !providers.isFetching && !settings.isFetching,
        error,
        refresh: () => Promise.all([products.refetch(), providers.refetch(), settings.refetch()]),
    };
}
