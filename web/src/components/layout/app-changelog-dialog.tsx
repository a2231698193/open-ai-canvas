import { motion, useReducedMotion } from "motion/react";
import { ScrollText } from "lucide-react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";

import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { aceternityMotion } from "@/lib/aceternity-motion";

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
    const version = `v${__APP_VERSION__.replace(/^v/, "")}`;
    const userFacing = audience === "user";

    return (
        <AppModal
            flush
            rootClassName="app-spatial-modal app-changelog-modal"
            title={
                <div className="flex min-w-0 items-start gap-3 pr-8">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-muted/45 text-foreground">
                        <ScrollText className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="text-[var(--fs-heading-lg)] font-semibold leading-snug text-foreground">{userFacing ? "产品更新" : "更新日志"}</div>
                        <div className="mt-0.5 text-[var(--fs-caption)] font-normal leading-5 text-foreground/45">{userFacing ? "了解近期上线的创作能力与体验改进" : "按版本查看产品能力、交互与稳定性变化"}</div>
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
            <div className="max-h-[min(64vh,640px)] overflow-y-auto overscroll-contain px-6 pb-6 thin-scrollbar">
                <ReactMarkdown
                    components={{
                        h1: () => null,
                        h2: ({ children }) => {
                            const label = markdownText(children).trim();
                            const latest = label === "Unreleased" || label === "最新";
                            const title = label === "Unreleased" ? "开发中" : label === "最新" ? "近期更新" : label;

                            return (
                                <h3 className="mt-8 mb-3 flex items-center gap-2 text-[var(--fs-heading)] font-semibold leading-none text-foreground first:mt-1">
                                    <span className="size-1.5 rounded-full bg-foreground/70" aria-hidden="true" />
                                    <span>{title}</span>
                                    {latest ? <span className="rounded-full bg-muted/50 px-2 py-0.5 text-[var(--fs-tiny)] font-medium text-foreground/50">最新</span> : null}
                                </h3>
                            );
                        },
                        ul: ({ children }) => <ul className="m-0 flex list-none flex-col gap-2.5 p-0">{children}</ul>,
                        li: ({ children }) => (
                            <li className="relative pl-4 text-[var(--fs-body)] leading-6 text-foreground/72 before:absolute before:top-[0.7em] before:left-0 before:size-1 before:rounded-full before:bg-foreground/28">
                                {children}
                            </li>
                        ),
                        p: ({ children }) => <p className="m-0 text-[var(--fs-body)] leading-6 text-foreground/70">{children}</p>,
                        code: ({ children }) => <code className="rounded-sm bg-muted/50 px-1 py-px font-mono text-[var(--typ-code)] text-foreground/80">{children}</code>,
                    }}
                >
                    {userFacing ? __USER_CHANGELOG__ : __APP_CHANGELOG__}
                </ReactMarkdown>
            </div>
        </AppModal>
    );
}
