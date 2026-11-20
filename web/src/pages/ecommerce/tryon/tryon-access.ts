import type { TryOnFunction } from "./tryon-kinds";

let available: { scope: string; functions: ReadonlySet<TryOnFunction> } | undefined;

export function setTryOnAllowedFunctions(scope: string, functions: readonly TryOnFunction[]) {
    available = { scope, functions: new Set(functions) };
}

export function tryOnAllowed(scope: string, fn: TryOnFunction) {
    return available?.scope === scope && available.functions.has(fn);
}
