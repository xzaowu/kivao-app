import { describe, expect, test } from "bun:test";

import { AGENT_DOCK_DEFAULT_WIDTH, AGENT_DOCK_MIN_VIEWPORT, clampAgentDockWidth, restoreAgentPanelDock } from "../src/lib/canvas/agent-panel-dock";

describe("画布助手默认停靠", () => {
    test("没有偏好或偏好损坏时默认固定靠右", () => {
        for (const value of [null, "broken", "{}", '{"docked":true,"width":"420"}']) {
            expect(restoreAgentPanelDock(value)).toEqual({ docked: true, width: AGENT_DOCK_DEFAULT_WIDTH });
        }
    });

    test("尊重用户明确保存的浮动模式和宽度", () => {
        expect(restoreAgentPanelDock('{"docked":false,"width":480}')).toEqual({ docked: false, width: 480 });
        expect(restoreAgentPanelDock('{"docked":true,"width":560}')).toEqual({ docked: true, width: 560 });
        expect(clampAgentDockWidth(2000, AGENT_DOCK_MIN_VIEWPORT)).toBe(480);
    });
});
