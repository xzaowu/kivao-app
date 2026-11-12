import { useEffect, useState } from "react";
import { App } from "antd";
import { AdminModal } from "@/pages/admin/ui/overlays";

import { Switch } from "@/components/ui/base/switch";
import { getAdminBillingAutoRefund, updateAdminBillingAutoRefund } from "@/services/api/wallet";

/**
 * 自动退回默认关闭；仅释放已确认未提交或明确失败、且没有作品或待恢复证据的预留。
 */
export function BillingAutoRefundToggle() {
    const { message } = App.useApp();
    const [enabled, setEnabled] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);

    useEffect(() => {
        let active = true;
        void getAdminBillingAutoRefund()
            .then(({ setting }) => {
                if (active) setEnabled(setting.enabled);
            })
            .catch((error) => {
                if (active) message.error(error instanceof Error ? error.message : "读取自动退回设置失败");
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [message]);

    const save = async (next: boolean) => {
        setSaving(true);
        try {
            const { setting } = await updateAdminBillingAutoRefund(next);
            setEnabled(setting.enabled);
            setConfirmOpen(false);
            message.success(setting.enabled ? "已开启自动退回，仅处理已确认可退回的冻结积分" : "已关闭自动退回");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存自动退回设置失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <label className="inline-flex h-8 items-center gap-2 rounded-[var(--r-md)] px-2 text-[var(--fs-body)]" title="仅退回已确认未提交或明确失败的任务预留；费用不明确的订单仍需人工核对">
                <span>自动退回</span>
                <Switch
                    size="sm"
                    aria-label="冻结积分自动退回"
                    checked={enabled}
                    loading={loading || (saving && !confirmOpen)}
                    disabled={loading || saving}
                    onChange={(checked) => {
                        if (checked) setConfirmOpen(true);
                        else void save(false);
                    }}
                />
            </label>
            <AdminModal
                title="开启冻结积分自动退回"
                open={confirmOpen}
                okText="确认开启"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                confirmLoading={saving}
                closable={!saving}
                mask={{ closable: !saving }}
                onCancel={() => {
                    if (!saving) setConfirmOpen(false);
                }}
                onOk={() => void save(true)}
                destroyOnHidden
            >
                <p className="admin-operation-confirmation-copy">开启后，系统每分钟检查已失败或取消任务的冻结积分。仅在确认请求未提交，或服务明确返回失败、取消，且没有成功调用、作品或待恢复记录时退回。</p>
                <p className="admin-operation-confirmation-copy">费用待核对、结果不明确、仍在执行或没有关联任务的订单保留人工处理。运行时间长本身不代表可退款。退回与处理记录同时保存，可随时关闭。</p>
            </AdminModal>
        </>
    );
}
