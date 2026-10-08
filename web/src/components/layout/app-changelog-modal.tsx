import { ScrollText } from "lucide-react";
import { lazy, Suspense, useState, type CSSProperties, type ReactNode } from "react";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { updateAnnouncementVersion } from "@/lib/update-announcement";
import { refreshPublicAppearance } from "@/services/appearance-bootstrap";

const AppChangelogDialog = lazy(() => import("@/components/layout/app-changelog-dialog").then((module) => ({ default: module.AppChangelogDialog })));

export const APP_VERSION = __APP_VERSION__;

type AppChangelogButtonProps = {
    className?: string;
    style?: CSSProperties;
    showVersion?: boolean;
    showLabel?: boolean;
    labelClassName?: string;
    versionClassName?: string;
    icon?: ReactNode;
    label?: ReactNode;
    audience?: "system" | "user";
};

export function AppChangelogButton({ className, style, showVersion = false, showLabel = false, labelClassName, versionClassName, icon, label, audience = "system" }: AppChangelogButtonProps) {
    const [open, setOpen] = useState(false);
    const updates = useAppearanceStore((state) => state.appearance.updates);
    const title = audience === "user" ? "产品更新" : updates?.enabled ? "更新公告" : "更新日志";
    const versionLabel = audience === "user" ? `v${APP_VERSION.replace(/^v/, "")}` : updateAnnouncementVersion(updates, APP_VERSION);

    return (
        <>
            <button
                type="button"
                className={className}
                style={style}
                onClick={() => {
                    void refreshPublicAppearance();
                    setOpen(true);
                }}
                aria-label={`查看${title}`}
                title={title}
            >
                {icon ?? <ScrollText className="size-4 shrink-0" />}
                {showLabel ? <span className={`whitespace-nowrap ${labelClassName || ""}`}>{label ?? title}</span> : null}
                {showVersion ? (
                    <span className={`${versionClassName || ""} min-w-0 truncate`} title={versionLabel}>
                        {versionLabel}
                    </span>
                ) : null}
            </button>
            {open ? (
                <Suspense fallback={null}>
                    <AppChangelogDialog open onClose={() => setOpen(false)} audience={audience} />
                </Suspense>
            ) : null}
        </>
    );
}
