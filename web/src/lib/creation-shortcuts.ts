import { Camera, Clapperboard, FileText, Image, PanelsTopLeft, ShoppingBag, Sparkles, WandSparkles } from "lucide-react";

export type CreationShortcut = { group: string; title: string; icon: string; target: string };
export const CREATION_SHORTCUT_ICONS = {
    image: { label: "图片", icon: Image },
    video: { label: "视频", icon: Clapperboard },
    canvas: { label: "画布", icon: PanelsTopLeft },
    skill: { label: "技能", icon: Sparkles },
    text: { label: "文本", icon: FileText },
    wand: { label: "效果", icon: WandSparkles },
    camera: { label: "相机", icon: Camera },
    shopping: { label: "商品", icon: ShoppingBag },
};
export const DEFAULT_CREATION_SHORTCUTS: CreationShortcut[] = [
    { group: "作图", title: "图片生成", icon: "image", target: "/toolbox/image" },
    { group: "做视频", title: "视频生成", icon: "video", target: "/toolbox/video" },
    { group: "创作与工具", title: "自由画布", icon: "canvas", target: "/canvas" },
    { group: "创作与工具", title: "技能", icon: "skill", target: "/skills" },
];

export function validCreationShortcut(item: unknown): item is CreationShortcut {
    if (!item || typeof item !== "object") return false;
    const value = item as CreationShortcut;
    if (![value.group, value.title].every((text) => typeof text === "string" && text.trim() && [...text.trim()].length <= 20 && !/[\u0000-\u001f\u007f]/.test(text))) return false;
    if (
        typeof value.icon !== "string" ||
        !Object.hasOwn(CREATION_SHORTCUT_ICONS, value.icon) ||
        typeof value.target !== "string" ||
        value.target.length > 512 ||
        !value.target.startsWith("/") ||
        value.target.startsWith("//") ||
        /[\\\u0000-\u001f\u007f]/.test(value.target)
    )
        return false;
    try {
        const path = decodeURIComponent(new URL(value.target, "https://kivao.invalid").pathname);
        if (/[\\\u0000-\u001f\u007f]/.test(path)) return false;
        return ["/", "/create", "/canvas", "/skills", "/toolbox/image", "/toolbox/video", "/ecommerce", "/projects", "/assets", "/tasks"].includes(path) || path.startsWith("/canvas/") || path.startsWith("/projects/");
    } catch {
        return false;
    }
}

export function normalizeCreationShortcuts(value: unknown): CreationShortcut[] {
    return Array.isArray(value) ? value.slice(0, 10).filter(validCreationShortcut) : DEFAULT_CREATION_SHORTCUTS;
}
