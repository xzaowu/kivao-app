import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type TouchEvent } from "react";
import { AGENT_LAUNCHER_POSITION_KEY, clampAgentLauncherPosition, moveAgentLauncher, restoreAgentLauncherPosition, type AgentLauncherGesture, type AgentLauncherPosition } from "@/lib/canvas/agent-launcher-position";

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

/**
 * 入口的拖拽、点击与键盘移动。指针处理器（onPointer*）可以挂在入口按钮上，也可以挂在按钮内的身体热区上
 * （大形象外框不接收指针）；指针捕获落在挂处理器的元素上，因此该元素必须能被命中。
 */
export function useAgentLauncherPosition(onOpen: () => void, width = 76, height = 76, storageKey = AGENT_LAUNCHER_POSITION_KEY, inCanvasEditor = true) {
    const size = { width, height };
    const preference = useRef<string | null>(null);
    const [position, setPosition] = useState(() => {
        try {
            preference.current = localStorage.getItem(storageKey);
        } catch (error) {
            console.warn("Agent 入口位置无法读取", error);
        }
        return restoreAgentLauncherPosition(preference.current, viewport(), size, inCanvasEditor);
    });
    const [dragging, setDragging] = useState(false);
    const gestureRef = useRef<(AgentLauncherGesture & { pointerId: number }) | null>(null);
    const suppressClick = useRef(false);
    const touchTapPending = useRef(false);

    const save = (next: AgentLauncherPosition) => {
        preference.current = JSON.stringify(next);
        try {
            localStorage.setItem(storageKey, preference.current);
        } catch (error) {
            console.warn("Agent 入口位置无法保存", error);
        }
    };

    useEffect(() => {
        const resize = () => setPosition((current) => (gestureRef.current ? clampAgentLauncherPosition(current, viewport(), size) : restoreAgentLauncherPosition(preference.current, viewport(), size, inCanvasEditor)));
        resize();
        window.addEventListener("resize", resize);
        return () => window.removeEventListener("resize", resize);
    }, [width, height, inCanvasEditor]);

    const onPointerDown = (event: PointerEvent<HTMLElement>) => {
        event.stopPropagation();
        if (event.button !== 0 || !event.isPrimary || gestureRef.current) return;
        suppressClick.current = false;
        touchTapPending.current = false;
        gestureRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, start: position, dragged: false };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent<HTMLElement>) => {
        event.stopPropagation();
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        const next = moveAgentLauncher(gesture, event.clientX, event.clientY, viewport(), size);
        gesture.dragged = next.dragged;
        if (!next.dragged) return;
        event.preventDefault();
        suppressClick.current = true;
        setDragging(true);
        setPosition(next.position);
    };
    const finish = (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
        event.stopPropagation();
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        gestureRef.current = null;
        const next = cancelled ? { dragged: gesture.dragged, position: clampAgentLauncherPosition(position, viewport(), size) } : moveAgentLauncher(gesture, event.clientX, event.clientY, viewport(), size);
        suppressClick.current = cancelled || next.dragged;
        touchTapPending.current = event.pointerType === "touch" && !cancelled && !next.dragged;
        setDragging(false);
        setPosition(next.position);
        if (next.dragged) save(next.position);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };
    // 先在 touchend 取消合成的 click，再打开面板。pointerup 时打开会让同一次点按命中新面板里的按钮。
    const onTouchEnd = (event: TouchEvent<HTMLElement>) => {
        if (!touchTapPending.current) return;
        touchTapPending.current = false;
        event.preventDefault();
        event.stopPropagation();
        suppressClick.current = true;
        if (!event.touches.length) onOpen();
    };
    const onClick = (event: MouseEvent<HTMLElement>) => {
        event.stopPropagation();
        // Keyboard/assistive activation remains available after a drag or cancellation.
        if (event.detail !== 0 && suppressClick.current) {
            event.preventDefault();
            return;
        }
        onOpen();
    };
    const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        event.stopPropagation();
        const delta = event.shiftKey ? 40 : 10;
        const offsets: Record<string, [number, number]> = { ArrowLeft: [delta, 0], ArrowRight: [-delta, 0], ArrowUp: [0, delta], ArrowDown: [0, -delta] };
        const offset = offsets[event.key];
        if (!offset) return;
        event.preventDefault();
        const next = clampAgentLauncherPosition({ right: position.right + offset[0], bottom: position.bottom + offset[1] }, viewport(), size);
        setPosition(next);
        save(next);
    };

    return {
        position,
        dragging,
        handlers: {
            onPointerDown,
            onPointerMove,
            onPointerUp: (event: PointerEvent<HTMLElement>) => finish(event, false),
            onPointerCancel: (event: PointerEvent<HTMLElement>) => finish(event, true),
            onLostPointerCapture: (event: PointerEvent<HTMLElement>) => finish(event, true),
            onTouchEnd,
            onClick,
            onKeyDown,
            onDoubleClick: (event: MouseEvent<HTMLElement>) => event.stopPropagation(),
        },
    };
}
