import type { GenerationTask } from "@/services/api/task-center";
import type { TryOnBatch } from "./tryon-store";

export function needsTryOnReceipt(batch: TryOnBatch) {
    return batch.planning?.state === "unknown" || batch.jobs.some((job) => job.state === "unknown");
}

/** Older workbench receipts only have a position. Never guess when two images share it. */
export function restoreTryOnReceipts(batch: TryOnBatch, tasks: GenerationTask[]): TryOnBatch {
    const receipts = tasks.filter((task) => task.clientContext?.batchId === batch.id);
    const plan = receipts.find((task) => task.clientContext?.batchSlotKey === "$planning");
    const images = receipts.filter((task) => task.clientContext?.batchSlotKey !== "$planning");
    const jobs = batch.jobs.map((job) => {
        if (job.taskId) return job;
        const keyed = images.find((task) => task.clientContext?.batchSlotKey === job.key);
        const older = images.filter((task) => !task.clientContext?.batchSlotKey && (task.clientContext?.batchIndex ?? 0) === job.index && !batch.jobs.some((other) => other.taskId === task.id));
        const receipt = keyed || (older.length === 1 && batch.jobs.filter((other) => other.index === job.index).length === 1 ? older[0] : undefined);
        return receipt ? { ...job, taskId: receipt.id, state: "submitted" as const, error: undefined } : job;
    });
    const planning = plan && batch.planning && !batch.planning.taskId ? { ...batch.planning, taskId: plan.id, state: "running" as const, error: undefined } : batch.planning;
    return planning === batch.planning && jobs.every((job, index) => job === batch.jobs[index]) ? batch : { ...batch, jobs, planning };
}
