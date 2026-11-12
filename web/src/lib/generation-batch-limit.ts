import { useUserStore } from "@/stores/use-user-store";
import type { LogicalModelQuote } from "@/services/api/logical-models";

// 创作页与画布按单张拆成多个任务；这里的上限不是模型单次输出张数。
export function generationBatchLimit(activeTaskLimit: number) {
    return Number.isFinite(activeTaskLimit) ? Math.max(1, Math.min(15, Math.floor(activeTaskLimit))) : 1;
}

export function generationBatchCount(value: string | number, limit = 15) {
    const count = Number(value);
    return Number.isFinite(count) ? Math.max(1, Math.min(generationBatchLimit(limit), Math.floor(count))) : 1;
}

export function currentGenerationBatchLimit() {
    return generationBatchLimit(useUserStore.getState().runtimeLimits.activeTaskLimit);
}

export function useGenerationBatchLimit() {
    return useUserStore((state) => generationBatchLimit(state.runtimeLimits.activeTaskLimit));
}

export function generationBatchQuote(quote: LogicalModelQuote | null, count: number) {
    if (!quote) return null;
    const tasks = generationBatchCount(count);
    return { ...quote, amountMicrocredits: quote.amountMicrocredits * tasks, quantity: quote.quantity * tasks };
}
