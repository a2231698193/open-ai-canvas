import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Camera, Settings2 } from "lucide-react";
import { Button } from "antd";

import { ImageSettingsPanel, imageQualityLabel, imageSizeLabel } from "@/components/image-settings-panel";
import { CanvasNodeCameraPanel } from "@/components/canvas/canvas-node-camera-dialog";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { canvasThemes } from "@/lib/canvas-theme";
import { modelCapabilityConfigFor, normalizeImageValue } from "@/lib/model-capabilities";
import type { CameraControlOptions } from "@/lib/canvas/camera-prompt-library";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";

type CanvasImageSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
    onMissingConfig?: () => void;
    onOpenChange?: (open: boolean) => void;
    buttonClassName?: string;
    getPopupContainer?: (triggerNode: HTMLElement) => HTMLElement;
    placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
    autoAdjustOverflow?: boolean;
    showCount?: boolean;
    cameraControl?: CameraControlOptions;
    onCameraControlChange?: (options: CameraControlOptions) => void;
};

export function CanvasImageSettingsPopover({ config, onConfigChange, onOpenChange, buttonClassName, placement = "topLeft", showCount = true, cameraControl, onCameraControlChange }: CanvasImageSettingsPopoverProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const buttonRef = useRef<HTMLSpanElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
    const [cameraOpen, setCameraOpen] = useState(false);
    const profile = modelCapabilityConfigFor(config, config.model || config.imageModel).image!;
    const normalized = normalizeImageValue(profile, config);
    const summaryParts = [
        ...(profile.size.parameter !== "none" ? [imageSizeLabel(normalized.size)] : []),
        ...(profile.quality.supported ? [imageQualityLabel(normalized.quality)] : []),
        ...(showCount && profile.maxOutputs > 1 ? [`${normalized.count} 张`] : []),
        ...(profile.transparentBackground.supported && normalized.transparentBackground === "true" ? ["透明"] : []),
    ];
    const summary = summaryParts.join(" · ");
    const hasSettings = profile.size.parameter !== "none" || profile.quality.supported || profile.transparentBackground.supported || (showCount && profile.maxOutputs > 1);
    const updateOpen = (nextOpen: boolean) => {
        setOpen(nextOpen);
        onOpenChange?.(nextOpen);
    };

    useEffect(() => {
        if (!open) return;
        const syncPosition = () => setButtonRect(buttonRef.current?.getBoundingClientRect() || null);
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            if (document.activeElement instanceof HTMLElement && panelRef.current?.contains(document.activeElement)) document.activeElement.blur();
            setOpen(false);
            onOpenChange?.(false);
        };

        syncPosition();
        window.addEventListener("resize", syncPosition);
        window.addEventListener("scroll", syncPosition, true);
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        return () => {
            window.removeEventListener("resize", syncPosition);
            window.removeEventListener("scroll", syncPosition, true);
            window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
        };
    }, [onOpenChange, open]);

    const panel = open && buttonRect ? <ImageSettingsPortal buttonRect={buttonRect} panelRef={panelRef} placement={placement} theme={theme} config={config} showCount={showCount} onConfigChange={onConfigChange} /> : null;

    if (!hasSettings && !onCameraControlChange) return null;

    const cameraEnabled = cameraControl?.enabled === true;

    return (
        <>
            {onCameraControlChange && (
                <Button
                    size="small"
                    type="text"
                    className="canvas-camera-control-trigger !h-8 !rounded-full !px-2.5"
                    style={{
                        background: cameraEnabled ? theme.node.activeStroke : theme.node.fill,
                        color: cameraEnabled ? theme.node.panel : theme.node.text,
                    }}
                    icon={<Camera className="size-3.5" />}
                    aria-pressed={cameraEnabled}
                    aria-label="摄像机控制"
                    title={`摄像机控制${cameraEnabled ? " · 已启用" : ""}`}
                    onClick={() => setCameraOpen(true)}
                />
            )}
            {hasSettings && (
                <span ref={buttonRef} className="inline-flex min-w-0">
                    <Button size="small" type="text" className={`canvas-generation-settings-trigger ${buttonClassName || "!h-8 !max-w-[180px] !justify-start !rounded-full !px-2.5"}`} style={{ background: theme.node.fill, color: theme.node.text }} icon={<Settings2 className="size-3.5" />} aria-expanded={open} aria-label={`图像设置：${summary}`} title={`图像设置 · ${summary}`} onClick={() => updateOpen(!open)}>
                        <span className="truncate">{summary}</span>
                    </Button>
                </span>
            )}
            {panel}
            {cameraOpen && onCameraControlChange && (
                <AppModal title="摄像机控制" open centered footer={null} width={780} flush onCancel={() => setCameraOpen(false)}>
                    <CanvasNodeCameraPanel
                        cameraControl={cameraControl}
                        onClose={() => setCameraOpen(false)}
                        onConfirm={(options, _prompt) => {
                            onCameraControlChange(options);
                            setCameraOpen(false);
                        }}
                    />
                </AppModal>
            )}
        </>
    );
}

function ImageSettingsPortal({
    buttonRect,
    panelRef,
    placement,
    theme,
    config,
    showCount,
    onConfigChange,
}: {
    buttonRect: DOMRect;
    panelRef: RefObject<HTMLDivElement | null>;
    placement: CanvasImageSettingsPopoverProps["placement"];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    config: AiConfig;
    showCount: boolean;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
}) {
    const gap = 8;
    const margin = 12;
    const width = Math.min(420, window.innerWidth - margin * 2);
    const alignRight = placement?.endsWith("Right");
    const alignCenter = placement === "top" || placement === "bottom";
    const left = alignCenter ? buttonRect.left + buttonRect.width / 2 - width / 2 : alignRight ? buttonRect.right - width : buttonRect.left;
    const topPlacement = placement?.startsWith("top");
    const style = {
        position: "fixed",
        zIndex: "var(--z-dialog-popover)",
        width,
        left: Math.max(margin, Math.min(window.innerWidth - width - margin, left)),
        ...(topPlacement ? { bottom: window.innerHeight - buttonRect.top + gap, maxHeight: Math.max(260, buttonRect.top - margin * 2) } : { top: buttonRect.bottom + gap, maxHeight: Math.max(260, window.innerHeight - buttonRect.bottom - margin * 2) }),
        background: theme.canvas.background,
        border: `1px solid ${theme.toolbar.border}`,
        borderRadius: 10,
        boxShadow: `0 24px 72px ${theme.spatial.shadow}`,
        padding: 12,
        overflowY: "auto",
        color: theme.node.text,
    } as const;

    return createPortal(
        <div
            ref={panelRef}
            className="canvas-image-settings-popover aceternity-floating-panel backdrop-blur-2xl"
            style={style}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            <ImageSettingsPanel config={config} onConfigChange={(key, value) => onConfigChange(key, value)} theme={theme} showCount={showCount} quickCount={3} className="space-y-3" />
        </div>,
        document.body,
    );
}
