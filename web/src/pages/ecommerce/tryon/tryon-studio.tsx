import { App } from "antd";
import { useState } from "react";

import { SegmentedControl } from "@/components/ui/base/segmented-control/segmented-control";

import "./tryon-chrome.css";
import "./tryon.css";
import { TryOnComposerSections, TryOnFooter } from "./tryon-composer";
import { TryOnEntryBlock } from "./tryon-entry";
import { tryOnFunction, type TryOnFunction, type TryOnSlotKey } from "./tryon-kinds";
import { usesAiModel } from "./tryon-plan";
import { TryOnResults } from "./tryon-results";
import type { TryOnMarket } from "./tryon-runtime";
import type { TryOnBatch } from "./tryon-store";
import { useTryOn } from "./use-tryon";

/** 桌面并排展示创作和作品，手机在两者间切换。 */
export default function TryOnStudio({
    scope,
    fn,
    allowed,
    market,
    defaultModel,
    hidden = false,
    onPickFunction,
}: {
    scope: string;
    fn: TryOnFunction;
    /** 当前账号可用的换装功能（后台关闭的功能对普通用户不显示）。 */
    allowed: TryOnFunction[];
    market: TryOnMarket;
    defaultModel?: string;
    hidden?: boolean;
    onPickFunction: (fn: TryOnFunction) => void;
}) {
    const { message } = App.useApp();
    const state = useTryOn({ scope, fn, allowed, market, defaultModel });
    const [mobileView, setMobileView] = useState<"create" | "works">("create");
    const config = tryOnFunction(fn);
    // 作品区「用这张继续换装」放进当前功能的人物位：模特位优先，姿势参考放进主体位。
    const personSlot: TryOnSlotKey | null = config.slots.some((slot) => slot.key === "model") && !usesAiModel(state.draft) ? "model" : config.slots.some((slot) => slot.key === "subject") ? "subject" : null;
    const running = state.shown.reduce(
        (sum, batch) => sum + batch.jobs.filter((job) => !job.hidden && (job.state === "waiting" || job.state === "submitting" || (job.taskId && !["succeeded", "failed", "cancelled"].includes(state.tasks[job.taskId]?.status || "running")))).length,
        0,
    );
    const edit = (batch: TryOnBatch) => {
        if (allowed && !allowed.includes(batch.fn)) {
            message.warning(`「${tryOnFunction(batch.fn).label}」暂未开放，不能恢复这批设置`);
            return;
        }
        onPickFunction(batch.fn);
        if (state.restoreBatch(batch.id)) {
            setMobileView("create");
            message.success("已恢复这批的素材与设置，可调整后重新生成");
        }
    };
    return (
        <div className="ecv-shell ect-shell" data-mobile-view={mobileView} hidden={hidden}>
            <div className="ecs-mobile-tabs">
                <SegmentedControl<"create" | "works">
                    block
                    ariaLabel="切换换装面板与作品"
                    value={mobileView}
                    onChange={setMobileView}
                    options={[
                        { value: "create", label: "创作" },
                        { value: "works", label: running ? `作品 · ${running}` : "作品" },
                    ]}
                />
            </div>
            <TryOnResults
                state={state}
                activeSlot={personSlot}
                onPickFunction={(id) => {
                    onPickFunction(id);
                    setMobileView("create");
                }}
                onEdit={edit}
                onUseAsInput={(resourceId, slot) => {
                    state.addResources(slot, [{ resourceId, name: "换装成片" }]);
                    setMobileView("create");
                    message.success(`已放进「${config.slots.find((item) => item.key === slot)?.label || "模特"}」，可以继续换装`);
                }}
            />
            <aside className="ecs-composer" aria-label="批量换装面板">
                <div className="ecs-composer-scroll ect-scroll" data-canvas-wheel-scroll>
                    <TryOnEntryBlock active={fn} allowed={allowed} onPick={onPickFunction} />
                    <div key={fn} className="ect-sections">
                        <TryOnComposerSections state={state} />
                    </div>
                </div>
                <TryOnFooter state={state} onSubmitted={() => setMobileView("works")} />
            </aside>
        </div>
    );
}
