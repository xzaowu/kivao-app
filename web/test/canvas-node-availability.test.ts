import { expect, test } from "bun:test";
import { canvasNodeCreationEnabled } from "../src/lib/canvas/canvas-node-availability";
import { resolveAddNodeMenuCommands, resolveToolbarTools, type AddNodeMenuContext, type ToolContext } from "../src/lib/canvas/tool-registry";
import { defaultFeatureAvailability } from "../src/stores/use-user-store";
import { CanvasNodeType } from "../src/types/canvas";

const controlled = [
    [CanvasNodeType.MediaConversion, "canvasConversionEnabled"],
    [CanvasNodeType.Drawing, "canvasDrawingEnabled"],
    ["folder", "canvasFolderEnabled"],
    [CanvasNodeType.Frame, "canvasFrameEnabled"],
] as const;

test("canvas creation defaults off and each switch restores only its own entry", () => {
    const context = { workspaceMode: "professional", isProjectLinked: false, handlers: {} } as AddNodeMenuContext;
    for (const [type, key] of controlled) {
        expect(defaultFeatureAvailability[key]).toBe(false);
        expect(canvasNodeCreationEnabled(type)).toBe(false);
        expect(resolveAddNodeMenuCommands(context).some((command) => command.id === type)).toBe(false);
        const nodeFeatures = { ...defaultFeatureAvailability, [key]: true };
        const commands = resolveAddNodeMenuCommands({ ...context, nodeFeatures });
        for (const [other] of controlled) {
            expect(canvasNodeCreationEnabled(other, nodeFeatures)).toBe(other === type);
            expect(commands.some((command) => command.id === other)).toBe(other === type);
        }
        expect(commands.some((command) => command.id === CanvasNodeType.Image)).toBe(true);
        expect(commands.some((command) => command.id === CanvasNodeType.Video)).toBe(true);
    }
});

test("frame-based group creation respects the switch even with saved toolbar preferences", () => {
    const ids = ["selection-create-storyboard", "selection-create-reference-group"];
    const context = { selectedCount: 2, nodeFeatures: defaultFeatureAvailability } as ToolContext;
    const prefs = { order: ids, hidden: [] };
    expect(resolveToolbarTools("selection", context, prefs).filter((tool) => ids.includes(tool.id))).toHaveLength(0);
    context.nodeFeatures = { ...defaultFeatureAvailability, canvasFrameEnabled: true };
    expect(resolveToolbarTools("selection", context, prefs).filter((tool) => ids.includes(tool.id))).toHaveLength(2);
});
