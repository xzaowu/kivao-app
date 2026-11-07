import type { WorkbenchPromptPreset, WorkbenchTool } from "@/services/api/workbench";

export function workbenchSlots(tool: Pick<WorkbenchTool, "inputContract"> | null, preset?: WorkbenchPromptPreset | null) {
    const keys = preset?.defaultParameters?.workbenchInputs?.slotKeys;
    return (tool?.inputContract?.slots || []).filter((slot) => slot.common !== false || !keys || keys.includes(slot.key));
}

export function workbenchNoticeEnabled(preset: WorkbenchPromptPreset | null, slotKey: string) {
    return preset?.defaultParameters?.workbenchInputs?.noticeSlotKeys?.includes(slotKey) === true;
}
