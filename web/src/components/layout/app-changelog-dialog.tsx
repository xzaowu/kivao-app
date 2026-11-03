import { motion, useReducedMotion } from "motion/react";
import { ScrollText } from "lucide-react";
import ReactMarkdown from "react-markdown";

import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";
import { updateAnnouncementVersion } from "@/lib/update-announcement";
import { UpdateAnnouncementContent } from "./update-announcement-content";

export function AppChangelogDialog({ open, onClose, technical = false }: { open: boolean; onClose: () => void; technical?: boolean }) {
    const reducedMotion = useReducedMotion();
    const updates = useAppearanceStore((state) => state.appearance.updates);
    const isAdmin = useUserStore((state) => state.hydrated && state.user?.role === "admin");
    const version = technical ? updateAnnouncementVersion(undefined, __APP_VERSION__) : updates?.enabled ? updateAnnouncementVersion(updates, __APP_VERSION__) : "";
    if (technical && !isAdmin) return null;

    return (
        <AppModal
            rootClassName="app-spatial-modal app-changelog-modal"
            title={
                <div className="app-changelog-heading">
                    <span className="app-changelog-heading-icon">
                        <ScrollText className="size-4" />
                    </span>
                    <div className="app-changelog-heading-copy">
                        <div className="app-changelog-heading-title">{technical ? "技术更新记录" : "更新公告"}</div>
                        <div className="app-changelog-heading-description">{technical ? "应用源码随附的上游技术记录，仅管理员可见" : "本站发布的产品公告与功能介绍"}</div>
                    </div>
                    {version ? <span className="app-changelog-current-version">当前版本 {version}</span> : null}
                </div>
            }
            open={open}
            width={820}
            footer={null}
            centered
            onCancel={onClose}
            modalRender={(node) => (
                <motion.div initial={reducedMotion ? false : { opacity: 0, y: 14, scale: 0.975 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: aceternityMotion.duration.panel, ease: aceternityMotion.easing.enter }}>
                    {node}
                </motion.div>
            )}
        >
            <div className="app-changelog-scroll thin-scrollbar">
                {technical ? (
                    <ReactMarkdown
                        components={{
                            h1: () => null,
                            h2: ({ children }) => {
                                const label = String(children);
                                const latest = label === "Unreleased";

                                return (
                                    <h3 className={`app-changelog-section-heading${latest ? " is-latest" : ""}`}>
                                        <span className="app-changelog-section-marker" aria-hidden="true" />
                                        <span>{latest ? "开发中" : label}</span>
                                        {latest ? <span className="app-changelog-latest-badge">最新</span> : null}
                                    </h3>
                                );
                            },
                            ul: ({ children }) => <ul className="app-changelog-list">{children}</ul>,
                            li: ({ children }) => <li>{children}</li>,
                            p: ({ children }) => <p className="app-changelog-paragraph">{children}</p>,
                            code: ({ children }) => <code className="app-changelog-code">{children}</code>,
                        }}
                    >
                        {__APP_CHANGELOG__}
                    </ReactMarkdown>
                ) : updates?.enabled && updates.releases.length ? (
                    <UpdateAnnouncementContent value={updates} />
                ) : (
                    <p className="update-announcement-empty">暂无已发布的产品公告。</p>
                )}
            </div>
        </AppModal>
    );
}
