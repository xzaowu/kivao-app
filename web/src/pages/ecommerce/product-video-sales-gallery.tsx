import { Check } from "lucide-react";
import { useId } from "react";
import type { EcommerceDraft } from "@/services/api/ecommerce";
import { productSalesVideoApproaches, productVideoPurposes, salesVideoVoiceLabels, type ProductVideoApproach, type ProductVideoPurpose } from "./product-video-approaches";
import type { ProductVideoStory } from "./product-video-storyboard";
import "./product-video-sales.css";

type Props = {
    draft: Pick<EcommerceDraft, "productName" | "scene" | "audience">;
    facts: string;
    closing: string;
    story: ProductVideoStory | null;
    disabled: boolean;
    onSelect: (purpose: ProductVideoPurpose, approach: ProductVideoApproach) => void;
};

export function ProductVideoSalesGallery({ draft, facts, closing, story, disabled, onSelect }: Props) {
    const group = useId();
    return (
        <fieldset className="ec-sales-gallery" disabled={disabled}>
            <legend>选择拍法</legend>
            <div className="ec-sales-posters">
                {productVideoPurposes.flatMap(({ id: purpose }) =>
                    productSalesVideoApproaches(purpose, draft, facts, closing).map((approach) => {
                        const selected = story?.approachId === approach.id;
                        const modeId = `${group}-${approach.id}-mode`;
                        return (
                            <label key={approach.id} className="ec-sales-poster">
                                <input type="radio" name={group} value={approach.id} aria-label={approach.title} aria-describedby={modeId} checked={selected} onChange={() => onSelect(purpose, approach)} />
                                <img src={`/commerce/sales-video/${approach.id}.webp`} alt="" width={480} height={320} />
                                <span className="ec-sales-poster-caption">
                                    <span className="ec-sales-poster-title">{approach.title}</span>
                                    <span className="ec-sales-poster-mode" id={modeId}>
                                        {salesVideoVoiceLabels[approach.voiceMode]}
                                    </span>
                                </span>
                                {selected && (
                                    <span className="ec-sales-poster-check" aria-hidden="true">
                                        <Check size={14} strokeWidth={3} />
                                    </span>
                                )}
                            </label>
                        );
                    }),
                )}
            </div>
        </fieldset>
    );
}
