export const portraitLooks = [
    { name: "生活分享者", example: "cn-woman", direction: "自然亲切，穿素色休闲上衣，像在镜头前分享日常好物。" },
    { name: "专业讲解员", example: "cn-man", direction: "沉稳利落，穿简洁衬衫，神情专注，适合做清晰的产品演示。" },
    { name: "时尚出镜人", example: "eu-woman", direction: "造型简洁有层次，穿有质感的中性色服装，姿态从容。" },
];

export const appearanceFields = [
    { key: "presentation", label: "性别呈现", options: ["女性", "男性", "中性"] },
    { key: "age", label: "成年年龄段", options: ["青年（18–34 岁）", "中年（35–59 岁）", "银发（60 岁以上）"] },
    { key: "complexion", label: "肤色", options: ["浅肤色", "中等肤色", "棕肤色", "深肤色"] },
    { key: "build", label: "体型", options: ["匀称", "纤细", "健壮", "丰盈"] },
] as const;

type AppearanceKey = (typeof appearanceFields)[number]["key"];
export type PortraitBrief = Record<AppearanceKey, string> & { look: string; detail: string };

export function restorePortraitBrief(saved?: Partial<PortraitBrief> | null): PortraitBrief {
    const brief: PortraitBrief = {
        look: portraitLooks.find((item) => item.name === saved?.look)?.name || portraitLooks[0].name,
        detail: typeof saved?.detail === "string" ? saved.detail.slice(0, 400) : "",
        presentation: "",
        age: "",
        complexion: "",
        build: "",
    };
    for (const field of appearanceFields) {
        brief[field.key] = field.options.find((option) => option === saved?.[field.key]) || "";
    }
    return brief;
}

export function portraitPrompt(brief: PortraitBrief) {
    const look = portraitLooks.find((item) => item.name === brief.look) || portraitLooks[0];
    return [
        "为商品短视频选角，创作一位原创虚拟成年出镜人。输出单人半身定妆照，正面自然看镜头，脸部、双手及服装清晰，双手空置。使用柔和均匀的摄影棚光线和干净背景，只拍人物，不加商品、文字、水印或拼图。",
        look.direction,
        ...appearanceFields.filter((field) => brief[field.key]).map((field) => `${field.label}：${brief[field.key]}。`),
        brief.detail.trim(),
    ]
        .filter(Boolean)
        .join("\n");
}
