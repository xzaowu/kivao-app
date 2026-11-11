import { App, Button, Spin } from "antd";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ModelPicker } from "@/components/model-picker";
import { PageHeader } from "@/components/layout/workspace-page";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { useEffectiveConfig, selectableModelsByCapability } from "@/stores/use-config-store";
import { getEcommerceSettings, saveEcommerceSettings } from "@/services/api/ecommerce";
import { ecommerceModelChoice } from "@/pages/ecommerce/ecommerce-model";
import { useUserStore } from "@/stores/use-user-store";

export default function EcommerceSettingsPage() {
    const config = useEffectiveConfig(),
        { message } = App.useApp();
    const userId = useUserStore((s) => s.user?.id);
    const [selected, setSelected] = useState({ vision: "", planning: "" });
    const [loading, setLoading] = useState(true),
        [busy, setBusy] = useState(false),
        [error, setError] = useState("");
    useEffect(() => {
        let active = true;
        setLoading(true);
        getEcommerceSettings()
            .then((settings) => {
                if (!active) return;
                const options = selectableModelsByCapability(config, "text");
                const find = (choice: typeof settings.vision) =>
                    options.find((v) => {
                        try {
                            return JSON.stringify(ecommerceModelChoice(config, v)) === JSON.stringify(choice);
                        } catch {
                            return false;
                        }
                    }) || "";
                setSelected({ vision: find(settings.vision), planning: find(settings.planning) });
            })
            .catch((e) => {
                if (active) setError(e.message);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [config, userId]);
    const save = async () => {
        setBusy(true);
        try {
            await saveEcommerceSettings({ vision: ecommerceModelChoice(config, selected.vision), planning: ecommerceModelChoice(config, selected.planning) });
            if (useUserStore.getState().user?.id === userId) {
                message.success("阶段模型已保存");
                setError("");
            }
        } catch (e) {
            if (useUserStore.getState().user?.id === userId) setError(e instanceof Error ? e.message : "保存失败");
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="max-w-3xl">
            <PageHeader title="商品套图" description="识别商品、选择视觉方向，再策划整套图片。两个文本阶段均需用户确认报价。" />
            <p className="my-5 text-sm text-foreground/70">
                先在
                <Link to="/admin/settings/features" className="underline underline-offset-4">
                    功能开放
                </Link>
                启用商品套图和图片生成，再配置支持参考图的文本模型。图片模型由用户在出图前选择。
            </p>
            {error && (
                <p role="alert" className="mb-4 text-destructive">
                    {error}
                </p>
            )}
            {loading ? (
                <Spin />
            ) : (
                <div className="space-y-6">
                    {(
                        [
                            ["vision", "商品识别与视觉方向"],
                            ["planning", "整套策划"],
                        ] as const
                    ).map(([key, title]) => (
                        <section key={key} className="space-y-3">
                            <h2 className="font-medium">{title}</h2>
                            <ModelPicker
                                config={config}
                                capability="text"
                                value={selected[key]}
                                onChange={(v) => setSelected((s) => ({ ...s, [key]: v }))}
                                fullWidth
                                modelDisabledReason={(v) => {
                                    try {
                                        ecommerceModelChoice(config, v);
                                    } catch {
                                        return "仅支持平台模型";
                                    }
                                    return (modelCapabilityConfigFor(config, v)?.text?.references.maxImages || 0) > 0 ? "" : "模型未配置图片参考能力";
                                }}
                            />
                        </section>
                    ))}
                    <Button type="primary" loading={busy} disabled={!selected.vision || !selected.planning} onClick={() => void save()}>
                        保存阶段模型
                    </Button>
                </div>
            )}
        </div>
    );
}
