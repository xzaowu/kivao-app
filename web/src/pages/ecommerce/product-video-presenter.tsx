import { useId } from "react";
import type { ProductVideoPresenter } from "@/services/api/task-center";
import { productVideoPresenterDeliveries } from "./product-video";
import type { ProductVideoStory } from "./product-video-storyboard";

type Delivery = ProductVideoPresenter["delivery"];

const presenterShots: Record<Delivery, [string, string, string]> = {
    recommend: ["从同框首帧接续，人物看向镜头说第一句，让商品正面和嘴部同时入画。", "镜头顺着人物的手势靠近商品，清楚展示与这句台词对应的一处细节。", "镜头回到人物，人物看向观众说完最后一句，商品留在手中。"],
    demonstrate: ["从同框首帧接续，人物自然开口，看向商品并把演示部位转向镜头。", "跟随手部拍清一个连贯的使用动作，让讲到的细节在同一时刻出现。", "镜头拉回人货同框，人物展示动作结束时的商品状态，面向镜头说完台词。"],
    answer: ["从同框首帧接续，人物拿着商品对镜开口，在第一句的停顿处看向商品。", "镜头跟随人物手指切近商品，拍清能支撑回答的细节，延续同一段人声。", "回到人物正面，人物把商品展示给观众，在台词结束时自然停顿。"],
};

export function defaultPresenterStory(delivery: Delivery): ProductVideoStory {
    return { purpose: delivery === "demonstrate" ? "demo" : "showcase", shots: [...presenterShots[delivery]], edited: false };
}

export function ProductVideoPresenterDelivery({ delivery, onChange, disabled }: { delivery: Delivery; onChange: (next: Delivery) => void; disabled: boolean }) {
    const name = useId();
    return (
        <fieldset className="ec-presenter-delivery" disabled={disabled}>
            <legend>口播方式</legend>
            {(Object.keys(productVideoPresenterDeliveries) as Delivery[]).map((key) => (
                <label key={key}>
                    <input type="radio" name={name} value={key} checked={delivery === key} onChange={() => onChange(key)} />
                    {productVideoPresenterDeliveries[key]}
                </label>
            ))}
        </fieldset>
    );
}
