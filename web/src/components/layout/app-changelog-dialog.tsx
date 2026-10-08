import { motion, useReducedMotion } from "motion/react";
import { ScrollText } from "lucide-react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";

import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { updateAnnouncementVersion } from "@/lib/update-announcement";
import { UpdateAnnouncementContent } from "./update-announcement-content";

function markdownText(children: ReactNode): string {
    if (typeof children === "string" || typeof children === "number") return String(children);
    if (Array.isArray(children)) return children.map(markdownText).join("");
    if (children && typeof children === "object" && "props" in children) {
        return markdownText((children as { props?: { children?: ReactNode } }).props?.children);
    }
    return "";
}

export function AppChangelogDialog({ open, onClose, audience = "system" }: { open: boolean; onClose: () => void; audience?: "system" | "user" }) {
    const reducedMotion = useReducedMotion();
    const updates = useAppearanceStore((state) => state.appearance.updates);
    const userFacing = audience === "user";
    const custom = !userFacing && Boolean(updates?.enabled);
    const version = userFacing ? `v${__APP_VERSION__.replace(/^v/, "")}` : updateAnnouncementVersion(updates, __APP_VERSION__);

    return (
        <AppModal
            flush
            rootClassName="app-spatial-modal app-changelog-modal"
            title={
                <div className="flex min-w-0 items-start gap-3 pr-8">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-muted/45 text-foreground">
                        <ScrollText className="size-4" />
                    </span>
                    <div className="app-changelog-heading-copy">
                        <div className="app-changelog-heading-title">{userFacing ? "产品更新" : custom ? "更新公告" : "更新日志"}</div>
                        <div className="app-changelog-heading-description">{userFacing ? "了解近期上线的创作能力与体验改进" : custom ? "按版本查看本站发布的更新与功能介绍" : "按版本查看产品能力、交互与稳定性变化"}</div>
                    </div>
                    <span className="mt-1 shrink-0 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[var(--fs-tiny)] font-medium tabular-nums text-foreground/50">
                        {version}
                    </span>
                </div>
            }
            open={open}
            width={720}
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
                {userFacing ? (
                    <ReactMarkdown
                        components={{
                            h1: () => null,
                            h2: ({ children }) => {
                                const label = markdownText(children).trim();
                                const latest = label === "Unreleased" || label === "最新";
                                const title = label === "Unreleased" ? "开发中" : label === "最新" ? "近期更新" : label;
                                return (
                                    <h3 className={`app-changelog-section-heading${latest ? " is-latest" : ""}`}>
                                        <span className="app-changelog-section-marker" aria-hidden="true" />
                                        <span>{title}</span>
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
                        {__USER_CHANGELOG__}
                    </ReactMarkdown>
                ) : custom && updates ? (
                    <UpdateAnnouncementContent value={updates} />
                ) : (
                    <ReactMarkdown
                        components={{
                            h1: () => null,
                            h2: ({ children }) => {
                                const label = markdownText(children).trim();
                                const latest = label === "Unreleased" || label === "最新";
                                const title = label === "Unreleased" ? "开发中" : label === "最新" ? "近期更新" : label;
                                return (
                                    <h3 className={`app-changelog-section-heading${latest ? " is-latest" : ""}`}>
                                        <span className="app-changelog-section-marker" aria-hidden="true" />
                                        <span>{title}</span>
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
                )}
            </div>
        </AppModal>
    );
}
