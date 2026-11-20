import type { EcommerceDraft } from "@/services/api/ecommerce";

export const productVideoPurposes = [
    { id: "showcase", label: "商品展示" },
    { id: "lifestyle", label: "场景种草" },
    { id: "demo", label: "功能演示" },
] as const;

export type ProductVideoPurpose = (typeof productVideoPurposes)[number]["id"];

export type ProductVideoApproach = {
    id: string;
    title: string;
    opening: string;
    shots: [string, string, string];
};

function approach(id: string, title: string, opening: string, middle: string, ending: string): ProductVideoApproach {
    return { id, title, opening, shots: [opening, middle, ending] };
}

// The full product name still goes into the final prompt. Use a natural short reference in shot directions.
function shortReference(value: string, fallback: string) {
    const text = value.trim().replace(/\s+/g, " ");
    return text && Array.from(text).length <= 24 ? text : fallback;
}

export function productVideoApproaches(purpose: ProductVideoPurpose, draft: Pick<EcommerceDraft, "productName" | "scene">): ProductVideoApproach[] {
    const item = shortReference(draft.productName, "这件商品");
    const setting = shortReference(draft.scene, "日常使用场景");
    switch (purpose) {
        case "showcase":
            return [
                approach("reveal", "轮廓亮相", `一道光沿着${item}的轮廓移过。`, "镜头随光后退，让商品全貌逐渐进入画面。", "停在与首帧一致的角度，留一拍看清整体外观。"),
                approach("detail", "细节特写", `镜头贴近${item}表面一处可见的细节。`, "沿着这处细节缓慢横移，让纹理或边缘逐渐清晰。", "拉远镜头，让观众看到刚才的细节位于商品哪里。"),
                approach("orbit", "环绕展示", `从${item}的正面起镜，机位缓缓向侧面移动。`, "让镜头沿商品前方划过一段短弧，保持主体居中。", "回到正面，焦点从外缘落到主体。"),
            ];
        case "lifestyle":
            return [
                approach("day-in-use", "跟拍日常", `在${setting}中跟随人物的视线，找到${item}。`, "从人物肩后拍一次日常使用动作，再切近景跟住手部。", "拉回环境全景，商品仍处在刚刚使用的位置。"),
                approach("scene-first", "氛围开场", `先拍${setting}的一角，让${item}出现在景深里。`, "把焦点移到商品，保留前景，让观众看清它和周围生活物件的关系。", "回到最初的构图，让商品留在画面焦点上。"),
                approach("small-choice", "挑选瞬间", `人物的目光停在${item}上，切到主观视角。`, "用近景展示让人停下来的那处外观细节，再切回人物的目光。", `最后在${setting}中拍到商品全貌，交代刚才的选择。`),
            ];
        case "demo":
            return [
                approach("follow-steps", "跟着做一遍", `俯拍${item}，用手势标出操作的起点。`, "用一个连续镜头演示已确认的使用步骤，让接触位置和动作顺序清楚可见。", "松开手，停在操作结束的状态，让观众看清实际变化。"),
                approach("start-with-result", "先看结果", `开场展示${item}一次实际操作后的状态。`, "切回操作前，以近景重现达到这个状态的那一步。", "切回和开场相同的角度，前后动作接起来。"),
                approach("answer-question", "解答一个疑问", `镜头停在${item}上，用「从哪里开始用？」引出问题。`, "用手指引到正确的操作位置，再放慢展示一个经确认的使用动作。", "给刚才的位置一个清楚的定格，让画面回答开场的问题。"),
            ];
    }
}

export const salesVideoVoiceLabels = { host: "出镜口播", voiceover: "画外解说", silent: "无口播" } as const;
export type SalesVideoVoiceMode = keyof typeof salesVideoVoiceLabels;

const salesVideoStyles = {
    "host-pick": { title: "达人口播推荐", voiceMode: "host" },
    "buyer-qa": { title: "买家问答", voiceMode: "host" },
    "show-and-tell": { title: "边用边讲", voiceMode: "host" },
    "daily-pick": { title: "日常种草", voiceMode: "voiceover" },
    unboxing: { title: "开箱分享", voiceMode: "voiceover" },
    "shopping-skit": { title: "情景带货", voiceMode: "host" },
    "how-to": { title: "使用演示", voiceMode: "silent" },
    "solve-a-problem": { title: "痛点解决", voiceMode: "voiceover" },
    "buying-checklist": { title: "选购对照", voiceMode: "silent" },
} as const satisfies Record<string, { title: string; voiceMode: SalesVideoVoiceMode }>;

export function salesVideoStyle(id?: string) {
    if (!id || !Object.hasOwn(salesVideoStyles, id)) return undefined;
    return { id, ...salesVideoStyles[id as keyof typeof salesVideoStyles] };
}

export function productSalesVideoApproaches(purpose: ProductVideoPurpose, draft: Pick<EcommerceDraft, "productName" | "scene" | "audience">, facts: string, closing = "") {
    const item = shortReference(draft.productName, "这件商品");
    const setting = shortReference(draft.scene, "日常场景");
    const viewer = shortReference(draft.audience, "购买者");
    // Keep qualifications attached to a claim. A long fact remains in the full brief.
    const firstFact = facts
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
    const focus = firstFact ? (Array.from(firstFact).length <= 72 ? `结合已确认的「${firstFact}」。` : "结合已确认的商品卖点。") : "用原图中能看清的一处细节作例子。";
    function salesApproach(id: keyof typeof salesVideoStyles, opening: string, demonstration: string, ending: string) {
        const { title, voiceMode } = salesVideoStyles[id];
        return { ...approach(id, title, opening, demonstration, closing.trim() ? `${ending} 按「${closing.trim()}」收尾。` : ending), voiceMode };
    }
    switch (purpose) {
        case "showcase":
            return [
                salesApproach(
                    "host-pick",
                    `主播在桌边拿起${item}，面对镜头，从${viewer}挑这类商品时会关心的一件事聊起。`,
                    `主播边讲边指给观众看，切到手指所指的位置。${focus}`,
                    "回到人货同框，主播用一句话说清哪种需要值得考虑这款，随后把刚才的细节留给观众看。",
                ),
                salesApproach("buyer-qa", `主播拿着${item}，说出${viewer}购买前可能会问的一个具体问题。`, `主播在镜头前用实物回答，问题和手上的动作一一对应。${focus}`, "主播给出可以自行核对的挑选建议，把商品转向观众收尾。"),
                salesApproach(
                    "show-and-tell",
                    `主播把${item}放到手边，让${viewer}看清要演示的部位，开口交代这一步和选购有什么关系。`,
                    `边讲边连续演示一个有依据的使用动作；缺少操作资料时用手指示可见结构。${focus}`,
                    "主播把刚才的部位再指给观众看，用一句口语化的选择建议收尾。",
                ),
            ];
        case "lifestyle":
            return [
                salesApproach("daily-pick", `从${viewer}在${setting}里会遇到的日常需求切入，把${item}带进这个场景。`, `用第一视角拍一件具体的小事，旁白解释为什么留意这件商品。${focus}`, "把商品留在刚才使用的位置，用旁白点明什么情况下可以考虑它。"),
                salesApproach(
                    "unboxing",
                    `在${setting}给${viewer}近距离看${item}：让手把商品带进画面，有包装依据时再拍拆开包装。`,
                    `用画外音带观众看拿到手后会先检查的地方，在手部近景中演示。${focus}`,
                    "把挑选时值得确认的部位朝向镜头，用一句拆看后的选购提示收尾。",
                ),
                salesApproach("shopping-skit", `在${setting}里，一位${viewer}停下来挑${item}，向同伴问一个购买问题。`, `同伴拿起商品边回应边指向实物，两人的注意力落在同一处。${focus}`, "买家复述自己会怎么选，同伴把商品递近给对方看，在对话中自然收尾。"),
            ];
        case "demo":
            return [
                salesApproach("how-to", `从${viewer}查看${item}的视角，用手势提示要看哪个部位、要做什么。`, `固定机位拍完整的一个操作，缺少已核实步骤时改用手势示意可见部位。${focus}`, "将商品留在操作结束的位置，把关键部位展示清楚，让观众判断是否顺手。"),
                salesApproach(
                    "solve-a-problem",
                    `从${viewer}在挑${item}时遇到的具体不便开场，拍手上的情境。`,
                    `旁白用实物解释应当核对哪一点，拍清该处和实际使用场景的关系。${focus}`,
                    "旁白说明什么情况下这一点值得考虑；镜头停在刚才的问题和商品同框的位置。",
                ),
                salesApproach("buying-checklist", `从${viewer}的角度拿起${item}，以一个可见细节提出选购要点。`, `在同一件实物上来回指示整体和局部，画面帮助买家逐项核对。${focus}`, "用手势最后指一次关键细节，留出对照自己需求的时间。"),
            ];
    }
}
