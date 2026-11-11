import { Button } from "antd";
import type { WorkbenchBatch } from "./workbench-batches";

export function WorkbenchBatchStatus({ batch, busy, onQuery, onContinue, onRetry, onDismiss }: { batch: WorkbenchBatch; busy: boolean; onQuery: () => void; onContinue: () => void; onRetry: () => void; onDismiss: () => void }) {
    const accepted = batch.items.filter((item) => item.state === "accepted").length;
    const uncertain = batch.items.some((item) => item.state === "unknown" || item.state === "submitting");
    const checked = uncertain && batch.items.every((item) => item.state !== "submitting" && (item.state !== "unknown" || item.checked));
    return (
        <section className="workbench-batch-status" aria-label="批量提交进度">
            <p role="status">
                已受理 {accepted} / {batch.items.length} 个任务
            </p>
            <p>{uncertain ? "有任务尚未取得回执。请先查询，暂不重复提交。" : "已受理任务继续处理，可继续提交剩余任务。"}</p>
            <p>续提沿用本批最初的模型、素材和参数。</p>
            <div>
                {uncertain ? (
                    <Button size="small" disabled={busy} onClick={onQuery}>
                        查询任务回执
                    </Button>
                ) : null}
                {checked ? (
                    <Button size="small" disabled={busy} onClick={onRetry}>
                        重试未确认任务
                    </Button>
                ) : null}
                <Button size="small" disabled={busy || uncertain} onClick={onContinue}>
                    继续未提交任务
                </Button>
                {!uncertain ? (
                    <Button size="small" type="text" disabled={busy} onClick={onDismiss}>
                        取消未提交项
                    </Button>
                ) : null}
            </div>
        </section>
    );
}
