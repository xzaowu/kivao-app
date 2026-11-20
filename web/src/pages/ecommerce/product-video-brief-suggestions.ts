import type { EcommerceDraft } from "@/services/api/ecommerce";

export type ShootBriefValues = { audience: string; scene: string; closing: string };
export type ShootBriefField = keyof ShootBriefValues;
export const shootBriefLabels: Record<ShootBriefField, string> = { audience: "给谁看", scene: "在哪里拍", closing: "看完希望观众做什么" };
export const shootBriefFields = Object.keys(shootBriefLabels) as ShootBriefField[];

type ProductInfo = Pick<EcommerceDraft, "productName" | "category" | "description" | "platform"> & Partial<Pick<EcommerceDraft, "region" | "language">>;
const examples: { match: RegExp; suggestion: ShootBriefValues }[] = [
    { match: /耳机|耳麦|headphones?|earbuds?/i, suggestion: { audience: "经常通勤、想看看实际佩戴效果的人", scene: "出门前的玄关，先拿起耳机再展示佩戴细节", closing: "看清佩戴方式，再决定是否适合自己的通勤习惯" } },
    { match: /护肤|美妆|化妆|口红|唇釉|粉底|lipstick|cosmetics?/i, suggestion: { audience: "想在购买前看清颜色和质地的人", scene: "自然光下的梳妆台，镜头靠近产品和上手展示的位置", closing: "对照近景里的颜色和质地，选适合自己的一款" } },
    { match: /服装|服饰|连衣裙|外套|衬衫|穿搭|鞋靴|上衣|毛衣|apparel|clothing/i, suggestion: { audience: "想先看上身和日常搭配效果的人", scene: "日光下的穿衣镜前，先展示全身搭配，再靠近拍细节", closing: "对照穿搭效果，再查看适合自己的尺码" } },
    { match: /零食|食品|点心|饼干|坚果|小吃|snacks?/i, suggestion: { audience: "正在挑选日常零食的人", scene: "客厅的小桌上，把商品和打开后的实物放在同一画面", closing: "对照包装和实物，挑选自己想尝试的一款" } },
    { match: /家居|桌面|香薰|台灯|花瓶|家饰|diffuser|decor/i, suggestion: { audience: "正在为家中一角挑选摆设的人", scene: "窗边木桌，自然侧光照出商品在桌面上的轮廓", closing: "对照商品大小和摆放效果，看看适合家里的哪个位置" } },
    { match: /背包|双肩包|旅行包|收纳包|手提包|backpack/i, suggestion: { audience: "买包前想看日常收纳方式的人", scene: "出门前的桌面，将随身物品放在包旁边演示取放", closing: "对照随身物品，判断包的空间与拿取方式是否合适" } },
];

export function quickShootBrief(product: ProductInfo): ShootBriefValues {
    const category = [product.productName, product.category].join(" ");
    const example = examples.find(({ match }) => match.test(category));
    if (example) return example.suggestion;
    const name = product.productName.trim() || product.category.trim();
    const item = name && Array.from(name).length <= 24 ? name : "这款商品";
    return { audience: `想先看清${item}实物细节，再做选择的人`, scene: "光线明亮的展示台，先看商品全貌，再拍一处细节", closing: "回到商品全貌，让观众对照自己的使用需求做选择" };
}

export function briefSuggestionPrompt(product: ProductInfo, facts: string, existing: string) {
    return [
        "为一条 15 秒商品视频起草可以直接采用的拍摄简报。建议一种具体的目标受众、一个可以实际拍摄的场景和收尾时希望观众做的事。",
        "沿用商家已写的方向。有用的卖点只以已确认条目为准。不得虚构商品功能、认证、价格、促销或真实用户反馈。把受众写成需求或使用习惯，场景写出环境和一个可见动作。",
        '只输出 JSON 对象 {"audience":"受众","scene":"场景","closing":"收尾目标"}。每项用一句简短中文，不超过 80 字，不附解释。',
        JSON.stringify({
            商品: product.productName.trim(),
            品类: product.category.trim(),
            描述: product.description.trim(),
            平台: product.platform.trim(),
            投放市场: product.region || undefined,
            成片语言: product.language || undefined,
            已确认卖点: facts.trim(),
        }),
        existing,
    ].join("\n");
}

export function parseShootBriefSuggestion(raw: string): ShootBriefValues {
    const parsed: unknown = JSON.parse(
        raw
            .trim()
            .replace(/^\x60{3}(?:json)?\s*/i, "")
            .replace(/\s*\x60{3}$/, ""),
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("AI 没有返回完整的拍摄简报。");
    const candidate = parsed as Record<string, unknown>;
    const value = (key: ShootBriefField) => {
        const field = candidate[key];
        if (typeof field !== "string" || !field.trim() || Array.from(field.trim()).length > 240) throw new Error("AI 没有返回完整的拍摄简报。");
        return field.trim();
    };
    return { audience: value("audience"), scene: value("scene"), closing: value("closing") };
}

export function fillBriefGaps(current: ShootBriefValues, suggestion: ShootBriefValues): ShootBriefValues {
    return { audience: current.audience.trim() ? current.audience : suggestion.audience, scene: current.scene.trim() ? current.scene : suggestion.scene, closing: current.closing.trim() ? current.closing : suggestion.closing };
}
