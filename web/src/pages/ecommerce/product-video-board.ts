import type { ProductVideoBoards, ProductVideoBoardShot, ProductVideoShootBrief } from "@/services/api/task-center";

export type { ProductVideoBoards, ProductVideoBoardShot };
export const boardFramings = { wide: "全景", medium: "中景", close: "近景", detail: "特写" } as const;
export const boardCameras = { static: "固定机位", push: "向前推近", pan: "水平摇镜", follow: "跟随主体" } as const;

export function withBoardShot(boards: ProductVideoBoards | undefined, index: number, shot: ProductVideoBoardShot): ProductVideoBoards | undefined {
    const next: ProductVideoBoards = boards ? [...boards] : [{}, {}, {}];
    next[index] = shot;
    return next.some((item) => item.frame || item.framing || item.camera) ? next : undefined;
}

export function shotDirection(shot?: ProductVideoBoardShot) {
    return [shot?.framing && boardFramings[shot.framing], shot?.camera && boardCameras[shot.camera]].filter(Boolean).join(" · ");
}

export function sameBoards(left?: ProductVideoBoards, right?: ProductVideoBoards) {
    return [0, 1, 2].every((i) => {
        const a = left?.[i],
            b = right?.[i];
        return a?.camera === b?.camera && a?.framing === b?.framing && a?.frame?.resourceId === b?.frame?.resourceId && a?.frame?.name === b?.frame?.name;
    });
}

export function validBoards(value: unknown): value is ProductVideoBoards {
    return (
        Array.isArray(value) &&
        value.length === 3 &&
        value.every((shot) => {
            if (!shot || typeof shot !== "object" || Array.isArray(shot)) return false;
            const { frame, framing, camera } = shot;
            return (
                (framing === undefined || (typeof framing === "string" && Object.hasOwn(boardFramings, framing))) &&
                (camera === undefined || (typeof camera === "string" && Object.hasOwn(boardCameras, camera))) &&
                (frame === undefined || (frame && typeof frame.resourceId === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(frame.resourceId) && typeof frame.name === "string" && Array.from(frame.name).length <= 512))
            );
        })
    );
}

export function validShootBrief(value: unknown): value is ProductVideoShootBrief {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return Object.entries(value).every(([key, text]) => (key === "scene" || key === "closing") && typeof text === "string" && Array.from(text).length <= 240);
}
