const ACTIVE_USER_SCOPE_KEY = "yingce:active-user-scope";
const GUEST_SCOPE = "guest";
let userScopedPersistenceSuppressionDepth = 0;
let operationController = new AbortController();
let scopeTransitions = 0;

export type UserScopeOperation = ReturnType<typeof captureUserScopeOperation>;

/** Bind async media work to one session, including an A -> B -> A transition. */
export function captureUserScopeOperation(signal?: AbortSignal) {
    const scope = getActiveUserScope();
    const sessionSignal = operationController.signal;
    const combinedSignal = signal ? AbortSignal.any([sessionSignal, signal]) : sessionSignal;
    const isCurrent = () => !combinedSignal.aborted && scopeTransitions === 0 && scope === getActiveUserScope();
    const assertCurrent = () => {
        if (!isCurrent()) throw new DOMException("操作已取消或账号会话已变化", "AbortError");
    };
    assertCurrent();
    return { scope, signal: combinedSignal, isCurrent, assertCurrent };
}

export function isUserScopeAbort(error: unknown) {
    return error instanceof Error && error.name === "AbortError";
}

function invalidateUserScopeOperations() {
    operationController.abort();
    operationController = new AbortController();
}

/** Stop old work before waiting for persistence/sync locks, and block new work until scope is ready. */
export function beginUserScopeTransition() {
    scopeTransitions += 1;
    invalidateUserScopeOperations();
    let finished = false;
    return () => {
        if (finished) return;
        finished = true;
        scopeTransitions -= 1;
    };
}

export function withUserScopedPersistenceSuppressed<T>(operation: () => T) {
    userScopedPersistenceSuppressionDepth += 1;
    try {
        return operation();
    } finally {
        userScopedPersistenceSuppressionDepth -= 1;
    }
}

export function isUserScopedPersistenceSuppressed() {
    return userScopedPersistenceSuppressionDepth > 0;
}

export function getActiveUserScope() {
    if (typeof window === "undefined") return GUEST_SCOPE;
    return window.localStorage.getItem(ACTIVE_USER_SCOPE_KEY) || GUEST_SCOPE;
}

export function setActiveUserScope(userId?: string | null) {
    if (typeof window === "undefined") return;
    if (getActiveUserScope() !== (userId || GUEST_SCOPE)) invalidateUserScopeOperations();
    window.localStorage.setItem(ACTIVE_USER_SCOPE_KEY, userId || GUEST_SCOPE);
}

if (typeof window !== "undefined") {
    window.addEventListener?.("storage", (event) => {
        if (event.key === ACTIVE_USER_SCOPE_KEY || event.key === null) invalidateUserScopeOperations();
    });
}

export function scopedStorageKey(name: string, scope = getActiveUserScope()) {
    return `${name}:user:${scope}`;
}

export const scopedLocalStorage = {
    getItem: (name: string) => {
        if (typeof window === "undefined") return null;
        return window.localStorage.getItem(scopedStorageKey(name));
    },
    setItem: (name: string, value: string) => {
        if (typeof window === "undefined") return;
        if (isUserScopedPersistenceSuppressed()) return;
        window.localStorage.setItem(scopedStorageKey(name), value);
    },
    removeItem: (name: string) => {
        if (typeof window === "undefined") return;
        if (isUserScopedPersistenceSuppressed()) return;
        window.localStorage.removeItem(scopedStorageKey(name));
    },
};
