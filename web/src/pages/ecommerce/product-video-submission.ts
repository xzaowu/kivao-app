import { useState } from "react";

// Keep the operation ID before sending so a page reload cannot turn a lost acknowledgement into another paid submission.
export function useProductVideoSubmission(scope: string, projectId?: string) {
    const key = (id: string) => JSON.stringify(["ecommerce-product-video-submit", scope, id]);
    const [pending, setPending] = useState(() => {
        try {
            return projectId ? sessionStorage.getItem(key(projectId)) : null;
        } catch {
            return null;
        }
    });
    function start(id: string, operationId: string) {
        const storageKey = key(id);
        let previous: string | null;
        try {
            previous = sessionStorage.getItem(storageKey);
            if (!previous) sessionStorage.setItem(storageKey, operationId);
        } catch {
            throw new Error("此浏览器无法保存提交回执，请开启站点存储后再生成。");
        }
        if (previous) {
            setPending(previous);
            throw new Error("上次提交仍待核对，请先核对提交结果。");
        }
        setPending(operationId);
    }
    function finish(id: string, operationId: string) {
        try {
            if (sessionStorage.getItem(key(id)) === operationId) sessionStorage.removeItem(key(id));
        } catch {
            // The known server response is authoritative. A surviving marker can be checked again after reload.
        }
        setPending(null);
    }
    return { pending, start, finish };
}
