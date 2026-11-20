import type { EcommerceDraft } from "@/services/api/ecommerce";
import { productVideoBeats, productVideoPresenterDeliveries } from "./product-video";
import type { ProductVideoPresenter, ProductVideoReference } from "@/services/api/task-center";
import { productVideoReferenceFocus, videoRemixInstruction } from "./product-video-remix-presets";
import { productVideoPurposes, salesVideoStyle, salesVideoVoiceLabels, type SalesVideoVoiceMode } from "./product-video-approaches";
import type { ProductVideoStory } from "./product-video-storyboard";
import { shotDirection } from "./product-video-board";

export type PlanningTarget = "all" | 0 | 1 | 2;

export type PresenterPlanningBrief = { delivery: ProductVideoPresenter["delivery"]; voice: string };

function remixPlanningContext(reference: ProductVideoReference) {
    return {
        参考片时长秒: reference.durationMs / 1000,
        借鉴重点: productVideoReferenceFocus(reference),
        复刻要求: videoRemixInstruction(reference)?.trim() || undefined,
    };
}

export function presenterVoicePrompt(
    draft: EcommerceDraft,
    facts: string,
    story: ProductVideoStory,
    instruction: string,
    presenter?: PresenterPlanningBrief,
    closing?: string,
    voice = presenter?.voice || "",
    salesVideo = false,
    salesVoiceMode?: SalesVideoVoiceMode,
    reference?: ProductVideoReference,
) {
    const style = salesVideo && !presenter ? salesVideoStyle(story.approachId) : undefined;
    const delivery = style ? salesVideoVoiceLabels[salesVoiceMode ?? style.voiceMode] : undefined;
    return [
        "为一条15秒商品短片起草可直接说出口的台词。只依据商家确认的事实，按给定口播方式、语言和分镜写一段自然短句，留出展示商品的停顿。",
        ...(presenter ? ["只写同一位出镜人的话，用所选成片语言给眼前的一位观众讲清一个商品细节。口播中不写镜号、动作、时码或说话人标签。"] : []),
        ...(style ? ["先从买家会遇到的具体问题起句，再把实物演示变成购买理由，最后给出适用场景或挑选建议。出镜时像在和眼前的观众聊天，画外讲解则跟着手上的动作说。"] : []),
        ...(reference ? ["结合给定的复刻分镜另写台词。本次仅有参考片时长和文字说明，不能假设已听过原声。"] : []),
        '没有依据时不编造使用经历、对比效果、销量、价格或认证。原台词是可供修改的草稿。只输出 JSON 对象 {"voice":"完整台词"}。',
        JSON.stringify({
            商品: draft.productName.trim(),
            已确认卖点: facts.trim(),
            受众: draft.audience.trim(),
            使用场景: draft.scene.trim(),
            投放市场: draft.region || undefined,
            输出语言: draft.language || "zh-CN",
            ...(style && { 带货拍法: style.title }),
            ...(reference && { 视频复刻: remixPlanningContext(reference) }),
            口播方式: presenter ? productVideoPresenterDeliveries[presenter.delivery] : delivery,
            分镜: story.shots,
            ...(closing?.trim() && { 结尾目标: closing.trim() }),
            原台词: voice,
            改稿要求: instruction.trim(),
        }),
    ].join("\n");
}

export function parsePresenterVoice(text: string): string {
    const value: unknown = JSON.parse(
        text
            .trim()
            .replace(/^`{3}(?:json)?\s*/i, "")
            .replace(/\s*`{3}$/, ""),
    );
    const voice = value && typeof value === "object" && "voice" in value && typeof value.voice === "string" ? value.voice.trim() : "";
    if (!voice || Array.from(voice).length > 500) throw new Error("未收到可用的短片台词。");
    return voice;
}

export function videoPlanningPrompt(
    draft: EcommerceDraft,
    facts: string,
    story: ProductVideoStory,
    target: PlanningTarget,
    instruction: string,
    presenter?: PresenterPlanningBrief,
    closing?: string,
    salesVideo = false,
    salesVoiceMode?: SalesVideoVoiceMode,
    reference?: ProductVideoReference,
) {
    const style = salesVideo && !presenter ? salesVideoStyle(story.approachId) : undefined;
    const delivery = style ? salesVideoVoiceLabels[salesVoiceMode ?? style.voiceMode] : undefined;
    const brief = {
        商品: draft.productName.trim(),
        品类: draft.category.trim(),
        商品描述: draft.description.trim(),
        已确认卖点: facts.trim(),
        目标受众: draft.audience.trim(),
        使用场景: draft.scene.trim(),
        投放市场: draft.region || undefined,
        成片语言: draft.language || "zh-CN",
        用途: reference ? "视频复刻" : style?.title || productVideoPurposes.find((item) => item.id === story.purpose)?.label,
        ...(reference && { 视频复刻: remixPlanningContext(reference) }),
        ...(delivery && { 讲述方式: delivery }),
        原分镜: productVideoBeats.map((beat, i) => {
            const direction = shotDirection(story.boards?.[i]);
            return { 时段: beat.time, 镜头: beat.title, 画面: story.shots[i], ...(direction && { 已选拍摄方式: direction }) };
        }),
        ...(closing?.trim() && { 结尾目标: closing.trim() }),
        改稿要求: instruction.trim(),
        ...(presenter && { 口播方式: productVideoPresenterDeliveries[presenter.delivery], 人物台词: presenter.voice.trim() }),
    };
    const targetInstruction = target === "all" ? "规划开场、细节、收尾三个镜头，按时间顺序返回三项。" : `只改写第${target + 1}镜「${productVideoBeats[target].title}」；承接其他镜头，只返回这一项。`;
    const salesFocus = {
        showcase: "把观众最想问的事交给出镜者回答，用实物演示支撑推荐理由。",
        lifestyle: "用实际使用场景交代谁会需要商品，再展示这个场景中可以看见的选择依据。",
        demo: "围绕一个购买疑问演示一项已核实操作；缺少操作依据时，改拍外形和部位位置。",
    };
    return [
        "为一条15秒商品短片提出可拍摄的中文分镜建议。每项用一两句写主体、动作、景别或机位。守住已确认的商品事实，不杜撰功能、价格、效果或认证。分镜只写画面，台词单独编辑。",
        targetInstruction,
        ...(reference ? ["这是复刻分镜的文本改稿。依据给定的借鉴重点、已有分镜和用户标注的片段写拍摄指令，保留已有的原片时间标注。你没有收到参考视频画面，不推测其中的人物、物品、动作或真实切点。"] : []),
        ...(salesVideo && !presenter
            ? [
                  salesFocus[story.purpose],
                  "按带货节奏安排三镜：第一镜让目标受众看见商品和具体的购买疑问；第二镜用可拍摄的动作或细节回应一个已确认卖点；第三镜根据刚才展示的内容给出选择依据，优先落实结尾目标。单镜改稿只承担该镜的作用。",
                  "缺少已确认卖点，或卖点无法用画面核实时，只展示可见的外观、结构或摆放状态。不编造折扣、限时库存、竞品对比、实测结果或购买链接。",
                  ...(delivery ? [`按「${style?.title}」的${delivery}形式编排。出镜口播给说话人和实物同框留时间；画外解说顺着演示动作讲；无口播依靠画面让人看懂。`] : []),
              ]
            : []),
        ...(presenter ? ["镜头围绕出镜人物与商品安排，镜头动作配合所给台词。只输出画面建议，保留用户的原台词。"] : []),
        '仅输出 JSON 对象 {"shots":["镜头画面"]}，不附解释。下面的 JSON 是商品及草稿资料。',
        JSON.stringify(brief),
    ].join("\n");
}

export function parseVideoPlanningShots(text: string, target: PlanningTarget): string[] {
    let value: unknown;
    try {
        value = JSON.parse(
            text
                .trim()
                .replace(/^\x60\x60\x60(?:json)?\s*/i, "")
                .replace(/\s*\x60\x60\x60$/, ""),
        );
    } catch {
        throw new Error("策划结果缺少可用的分镜，原稿已保留。");
    }
    const shots = value && typeof value === "object" && "shots" in value ? value.shots : undefined;
    if (!Array.isArray(shots) || shots.length !== (target === "all" ? 3 : 1) || !shots.every((item) => typeof item === "string" && item.trim())) throw new Error("策划结果的镜头数量或内容不完整，原稿已保留。");
    return shots.map((shot: string) => shot.trim());
}

export function replacePlanningShots(story: ProductVideoStory, target: PlanningTarget, replacement: string[]): ProductVideoStory {
    return { ...story, edited: true, shots: target === "all" ? [...replacement] : story.shots.map((value, i) => (i === target ? replacement[0] : value)) };
}
