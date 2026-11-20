import { FolderOpen, X } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { assertCurrentUserSession, captureUserSession } from "@/lib/user-scope";
import { WorkbenchAssetPicker } from "@/pages/workbench/workbench-asset-picker";
import { boardCameras, boardFramings, type ProductVideoBoardShot } from "./product-video-board";
import { isProductVideoFrame } from "./product-video-version";

type Frame = NonNullable<ProductVideoBoardShot["frame"]>;
type Props = {
    title: string;
    shot?: ProductVideoBoardShot;
    images: Frame[];
    canReadFrame: (id: string) => Promise<boolean>;
    disabled: boolean;
    salesVideo?: boolean;
    onChange: (patch: Partial<ProductVideoBoardShot>) => void;
};
const imageOnly = ["image"] as const;

export function ProductVideoBoardControls({ title, shot, images, canReadFrame, disabled, salesVideo, onChange }: Props) {
    const id = useId();
    const [picker, setPicker] = useState(false);
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState("");
    const latest = useRef<Props["onChange"] | null>(null);
    const busy = useRef(false);
    const libraryButton = useRef<HTMLButtonElement>(null);
    const returnFocus = useRef(false);
    useLayoutEffect(() => {
        if (!picker && returnFocus.current) {
            returnFocus.current = false;
            libraryButton.current?.focus();
        }
    }, [picker]);
    useLayoutEffect(() => {
        latest.current = disabled ? null : onChange;
        return () => {
            latest.current = null;
        };
    }, [disabled, onChange]);
    const selected = shot?.frame;
    const locked = checking || disabled;
    async function pick(frame: Frame) {
        if (!latest.current || busy.current) throw new Error("请重新选择分镜图。");
        busy.current = true;
        setChecking(true);
        setError("");
        try {
            const session = captureUserSession();
            if (session.scope === "guest" || !isProductVideoFrame(frame) || !(await canReadFrame(frame.resourceId))) throw new Error("这张图片已不可用，请重新选择。");
            assertCurrentUserSession(session);
            if (!latest.current) throw new Error("镜头已切换，请重新选择分镜图。");
            latest.current({ frame });
        } finally {
            busy.current = false;
            setChecking(false);
        }
    }
    return (
        <fieldset className="ec-board-controls" disabled={disabled}>
            <legend>{title}镜头设置</legend>
            <div className="ec-board-optics">
                <label htmlFor={id + "-framing"}>
                    景别
                    <select id={id + "-framing"} value={shot?.framing || ""} onChange={(event) => onChange({ framing: (event.target.value || undefined) as ProductVideoBoardShot["framing"] })}>
                        <option value="">按脚本</option>
                        {Object.entries(boardFramings).map(([code, label]) => (
                            <option key={code} value={code}>
                                {label}
                            </option>
                        ))}
                    </select>
                </label>
                <label htmlFor={id + "-camera"}>
                    运镜
                    <select id={id + "-camera"} value={shot?.camera || ""} onChange={(event) => onChange({ camera: (event.target.value || undefined) as ProductVideoBoardShot["camera"] })}>
                        <option value="">按脚本</option>
                        {Object.entries(boardCameras).map(([code, label]) => (
                            <option key={code} value={code}>
                                {label}
                            </option>
                        ))}
                    </select>
                </label>
            </div>
            <div className="ec-board-pick">
                <label htmlFor={id + "-frame"}>
                    分镜参考图 <small>{salesVideo ? "可用于生成" : "仅供预演"}</small>
                </label>
                <div className="ec-board-frame-actions">
                    <select
                        aria-label={title + "分镜参考图"}
                        id={id + "-frame"}
                        disabled={locked || !images.length}
                        value={selected?.resourceId || ""}
                        onChange={(event) => {
                            const frame = images.find((item) => item.resourceId === event.target.value);
                            if (frame) void pick(frame).catch(() => setError("这张项目图片暂时无法使用，请重新选择或前往素材库。"));
                        }}
                    >
                        <option value="" disabled>
                            {salesVideo ? "按脚本构图" : images.length ? "选项目图片" : "暂无项目图片"}
                        </option>
                        {selected && !images.some((item) => item.resourceId === selected.resourceId) && <option value={selected.resourceId}>{selected.name || "已选素材"}</option>}
                        {images.map((item) => (
                            <option key={item.resourceId} value={item.resourceId}>
                                {item.name || "项目图片"}
                            </option>
                        ))}
                    </select>
                    <button
                        ref={libraryButton}
                        type="button"
                        aria-haspopup="dialog"
                        disabled={locked}
                        onClick={() => {
                            setError("");
                            setPicker(true);
                        }}
                        aria-label={`从素材库选择${title}分镜参考图`}
                    >
                        <FolderOpen size={15} aria-hidden />
                        素材库
                    </button>
                    {selected && (
                        <button
                            type="button"
                            disabled={locked}
                            aria-label={`清除${title}分镜参考图`}
                            onClick={() => {
                                setError("");
                                libraryButton.current?.focus();
                                onChange({ frame: undefined });
                            }}
                        >
                            <X size={15} aria-hidden />
                        </button>
                    )}
                </div>
                {checking && <small role="status">正在核对图片…</small>}
                {error && <small role="alert">{error}</small>}
            </div>
            {picker && (
                <WorkbenchAssetPicker
                    open
                    syncedOnly
                    accept={imageOnly}
                    maxCount={1}
                    slotName={title + "分镜参考图"}
                    onClose={() => {
                        returnFocus.current = true;
                        setPicker(false);
                    }}
                    onPick={async ([asset]) => {
                        if (asset?.kind !== "image") throw new Error("请选择一张已同步的图片。");
                        await pick({ resourceId: asset.resourceId, name: asset.name });
                    }}
                />
            )}
        </fieldset>
    );
}
