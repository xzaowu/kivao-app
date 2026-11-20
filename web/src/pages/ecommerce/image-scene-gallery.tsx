import { Blend, GalleryHorizontalEnd, Image, Images, Layers3, Megaphone, PanelTop, type LucideIcon } from "lucide-react";
import { Select } from "@/components/ui/base/select";
import { commerceScenes, type CommerceScene } from "./scenes";
import "./content-type-picker.css";

const typeIcons: Record<string, LucideIcon> = {
    detail: PanelTop,
    set: Layers3,
    white: Blend,
    single: Image,
    marketing: Megaphone,
};

const sceneOptions = commerceScenes.map((scene) => ({
    value: scene.label,
    label: scene.label,
    Icon: scene.distribution ? GalleryHorizontalEnd : typeIcons[scene.imageType] || Images,
    scene,
}));

export function ImageSceneGallery({ selected, onChoose }: { selected: string; onChoose: (scene: CommerceScene) => void }) {
    const SelectedIcon = sceneOptions.find((option) => option.value === selected)?.Icon || Images;
    return (
        <Select<string, (typeof sceneOptions)[number]>
            ariaLabel="内容类型"
            className="ec-content-type-trigger"
            classNames={{ popup: { root: "ec-content-type-menu" } }}
            appearance="pill"
            value={selected}
            options={sceneOptions}
            prefix={<SelectedIcon size={15} aria-hidden="true" />}
            virtual={false}
            listHeight={300}
            placement="topLeft"
            popupMatchSelectWidth={184}
            showSearch={false}
            optionRender={({ data: { label, Icon } }) => (
                <span className="ec-content-type-option">
                    <Icon size={15} aria-hidden="true" /> {label}
                </span>
            )}
            onChange={(_, option) => {
                if (option && !Array.isArray(option)) onChoose(option.scene);
            }}
        />
    );
}
