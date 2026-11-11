import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ApprovalCard } from "@/components/canvas/canvas-cloud-agent-panel-parts";
import { canvasThemes } from "@/lib/canvas-theme";

test("连接未就绪不伪装成审批已提交", () => {
    const props = {
        approval: { approvalId: "approval", detail: { toolName: "canvas_apply_ops", arguments: { ops: [] } }, reason: "" },
        theme: canvasThemes.dark, onApprove: () => {}, onReject: () => {}, onReasonChange: () => {},
    };
    const blocked = renderToStaticMarkup(<ApprovalCard {...props} submitting={false} blockedReason="连接已断开" />);
    expect(blocked).toContain("连接已断开");
    expect(blocked).not.toContain("正在提交");
    expect(blocked).toMatch(/class="canvas-agent-approval-approve" disabled=""/);
    expect(blocked).toMatch(/class="canvas-agent-approval-reject" disabled=""/);
    const sending = renderToStaticMarkup(<ApprovalCard {...props} submitting />);
    expect(sending).toContain("正在提交");
    const ready = renderToStaticMarkup(<ApprovalCard {...props} submitting={false} />);
    expect(ready).not.toMatch(/class="canvas-agent-approval-approve" disabled/);
});
