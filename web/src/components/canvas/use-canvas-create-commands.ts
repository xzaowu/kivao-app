import { resolveAddNodeMenuCommands, type AddNodeMenuContext } from "@/lib/canvas/tool-registry";
import { usePluginStore } from "@/stores/use-plugin-store";

import type { CanvasCreateCommand } from "./canvas-create-menu";

export function useCanvasCreateCommands(context: AddNodeMenuContext, runCommand?: (command: () => void) => void): CanvasCreateCommand[] {
    const pluginStates = usePluginStore((state) => state.pluginStates);
    const enabledPluginIds = new Set(
        Object.values(pluginStates)
            .filter((state) => state.effectiveEnabled)
            .map((state) => state.pluginId),
    );

    return resolveAddNodeMenuCommands({ ...context, enabledPluginIds }).map((command) => ({
        id: command.id,
        label: command.label,
        icon: command.icon,
        badge: command.badge,
        section: command.section,
        onClick: () => {
            const run = () => command.run(context);
            if (runCommand) runCommand(run);
            else run();
        },
    }));
}
