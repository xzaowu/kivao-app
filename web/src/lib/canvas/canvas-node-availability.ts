import type { FeatureAvailability } from "@/stores/use-user-store";
import { CanvasNodeType, type CanvasNodeTypeId } from "@/types/canvas";

export type CanvasNodeFeatures = Pick<FeatureAvailability, "canvasConversionEnabled" | "canvasDrawingEnabled" | "canvasFolderEnabled" | "canvasFrameEnabled">;

// These flags control creation entrances; existing canvas data remains readable.
export function canvasNodeCreationEnabled(type: CanvasNodeTypeId | "folder", features?: Partial<CanvasNodeFeatures>): boolean {
    switch (type) {
        case CanvasNodeType.MediaConversion:
            return features?.canvasConversionEnabled === true;
        case CanvasNodeType.Drawing:
            return features?.canvasDrawingEnabled === true;
        case "folder":
            return features?.canvasFolderEnabled === true;
        case CanvasNodeType.Frame:
            return features?.canvasFrameEnabled === true;
        default:
            return true;
    }
}
