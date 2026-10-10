import { ImageSizePicker } from "@/components/image-size-picker";
import { ApimartMjOptionsPanel } from "@/components/apimart-mj-options-panel";
import { isApimartMjProtocol, apimartMjSummary } from "@/lib/apimart-mj-options";
import { useApimartMjOptionsStore } from "@/stores/use-apimart-mj-options-store";
import { Lk888MjOptionsPanel } from "@/components/lk888-mj-options-panel";
import { isLk888MjProtocol, lk888MjSummary } from "@/lib/lk888-mj-options";
import { useLk888MjOptionsStore } from "@/stores/use-lk888-mj-options-store";
import { Lk888Image25OptionsPanel } from "@/components/lk888-image-options-panel";
import { isTtImage25, lk888Image25Summary } from "@/lib/lk888-image-options";
import { useLk888ImageOptionsStore } from "@/stores/use-lk888-image-options-store";
import { imageResolutionUsesQuality } from "@/lib/image-size-presets";
import { createPortal } from "react-dom";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type RefObject } from "react";
import { Button, Popover } from "antd";
import { useWorkspaceTopBarMount } from "@/components/layout/workspace-top-bar-extension";
import { Tooltip } from "@/components/ui/base/tooltip";
import { Reorder, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { ArrowUp, Brain, ChevronDown, ChevronLeft, ChevronRight, Clapperboard, Clock3, Film, History, Image as ImageIcon, Images, LoaderCircle, Maximize2, MessageSquareText, Minimize2, Plus, SlidersHorizontal, Trash2, WandSparkles, Waves, X } from "lucide-react";

import { WorkingGlow } from "@/components/ai/working-indicator";
import { formatVideoResolutionLabel as videoResolutionLabel } from "@/lib/video-generation-options";
import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import { VoiceRecordingButton } from "@/components/conversation/voice-recording-button";
import { HoverBorderGradient } from "@/components/ui/aceternity/hover-border-gradient";
import { SpotlightSurface } from "@/components/ui/aceternity/spotlight-surface";
import { ModelPicker } from "@/components/model-picker";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { ASSET_CATEGORY_LABELS } from "@/lib/asset-category";
import { formatShotOrdinal } from "@/lib/shot-label";
import { buildImageResolutionOptions, formatImageResolutionSize, supportsImageResolutionPresets } from "@/lib/image-resolution-tiers";
import { modelCapabilityConfigFor, normalizeVideoValue, videoDurationOptions, type ImageCapabilityConfig, type VideoCapabilityConfig } from "@/lib/model-capabilities";
import { mergedImageCapabilityConfig, type ModelRequirements } from "@/lib/model-selection";
import { imageQualityLabel } from "@/lib/image-quality";
import { modelQuoteDescription, modelQuoteRequest } from "@/lib/model-pricing";
import { quoteModel, type LogicalModelQuote } from "@/services/api/logical-models";
import { modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";
import { VIDEO_GENERATION_MODE_OPTIONS, supportedVideoGenerationModes, type VideoGenerationMode, type VideoModeCapabilityLike } from "@/lib/video-generation-mode";
import { useUserStore } from "@/stores/use-user-store";
import type { PromptOptimizerProvider } from "@/lib/plugins/plugin-types";
import { type CreationReference, type CreationReferenceLimits } from "./creation-references";
import { creationAttachmentKind, type CreationAttachment, type CreationMode } from "./creation-assets";
import { isImageAttachment } from "./creation-conversations";
import { countOptions, modeLabels, qualityOptions, resolutionOptions, type CreationShotRailEntry } from "./creation-types";
import "./creation-product.css";
import "./creation-scrollbars.css";
import { CreationAttachmentThumbnail, CreationMediaPreviewModal } from "./creation-workspace-messages";

export { CreationHistoryDrawer } from "./creation-workspace-history";
export { CreationMessageView } from "./creation-workspace-messages";
export { CreationEmptyBanner, CreationEmptySuggest, CreationFeaturedWorks } from "./creation-workspace-empty";

const CanvasPromptOptimizerDrawer = lazy(() => import("@/components/canvas/canvas-prompt-optimizer-drawer").then((module) => ({ default: module.CanvasPromptOptimizerDrawer })));

export const creationAssetCategoryLabels: Record<string, string> = { all: "全部素材", ...ASSET_CATEGORY_LABELS };

export function CreationWorkspaceToolbar({ shots, onJumpToShot, onNewConversation, onOpenHistory, onContinueCanvas, openingCanvas }: { shots: CreationShotRailEntry[]; onJumpToShot: (shot: CreationShotRailEntry) => void; onNewConversation: () => void; onOpenHistory: () => void; onContinueCanvas: () => void; openingCanvas: boolean }) {
    const [railOpen, setRailOpen] = useState(false);
    const railRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!railOpen) return;
        const onPointerDown = (event: MouseEvent) => { if (railRef.current && !railRef.current.contains(event.target as Node)) setRailOpen(false); };
        window.addEventListener("mousedown", onPointerDown);
        return () => window.removeEventListener("mousedown", onPointerDown);
    }, [railOpen]);
    const mount = useWorkspaceTopBarMount();
    const toolbar = <header className="creation-thread-toolbar">
        <div className="creation-toolbar-shots" ref={railRef}>
            <button type="button" className="creation-rail-trigger" aria-expanded={railOpen} aria-haspopup="listbox" onClick={() => setRailOpen((open) => !open)}><Clapperboard />镜头时间线{shots.length > 0 ? <em className="creation-rail-count">{shots.length}</em> : null}</button>
            {railOpen ? <div className="creation-rail-pop" role="listbox" aria-label="镜头时间线">
                <div className="creation-rail-pop-head"><span className="creation-rail-pop-title">镜头时间线<small>{shots.length ? `共 ${shots.length} 镜` : "空轨道"}</small></span><button type="button" className="creation-rail-pop-close" aria-label="关闭镜头列表" onClick={() => setRailOpen(false)}><X /></button></div>
                {shots.length ? <ol className="creation-rail-list">{shots.map((shot) => {
                    const resultStatus = shot.result?.status;
                    const statusLabel = resultStatus === "done" ? "完成" : resultStatus === "error" ? "生成失败" : resultStatus === "pending" ? "生成中" : resultStatus === "cancelled" ? "已停止" : "待生成";
                    return <li key={shot.key}><button type="button" role="option" aria-selected="false" className="creation-rail-row" onClick={() => { setRailOpen(false); onJumpToShot(shot); }}>
                        <span className="creation-rail-row-shot">{formatShotOrdinal(shot.ordinal - 1)}</span>
                        <span className="creation-rail-row-prompt">{shot.user.content || "视频镜头"}</span>
                        <span className={`creation-rail-row-state is-${resultStatus || "idle"}`}>{statusLabel}</span>
                    </button></li>;
                })}</ol> : <p className="creation-rail-empty">在下方发送一条视频消息，就会自动成为第 1 镜。</p>}
            </div> : null}
        </div>
        <div className="creation-toolbar-actions">
            <Button size="small" loading={openingCanvas} onClick={onContinueCanvas}>画布中继续</Button>
            <Tooltip title="新建创作"><button type="button" aria-label="新建创作" className="creation-toolbar-action" onClick={onNewConversation}><Plus /></button></Tooltip>
            <Tooltip title="历史对话"><button type="button" aria-label="查看历史对话" className="creation-toolbar-action" onClick={onOpenHistory}><History /></button></Tooltip>
        </div>
    </header>;
    if (mount) return createPortal(toolbar, mount);
    if (mount === null) return null;
    return toolbar;
}

type ComposerProps = {
    variant: "empty" | "thread";
    mode: CreationMode;
    prompt: string;
    setPrompt: (value: string) => void;
    busy: boolean;
    generationActive: boolean;
    referenceReplacementBusy: boolean;
    attachments: CreationAttachment[];
    referenceImageSize?: { width: number; height: number };
    maxReferences: number;
    /** 全能参考模式的上限（同名模型组并集）；其余视频模式由模式本身决定，不使用它。 */
    videoReferenceLimits?: CreationReferenceLimits;
    references: CreationReference[];
    onRemoveAttachment: (id: string) => void;
    onClearAttachments: () => void;
    onClearComposer: () => void;
    onReorderAttachments: (attachments: CreationAttachment[]) => void;
    onReplaceAttachment: (targetAttachmentId: string, replacement: CreationAttachment) => void;
    onReplaceReferenceFiles: (targetAttachmentId: string, files: File[]) => void;
    onOpenLibrary: () => void;
    onModeChange: (mode: CreationMode) => void;
    model: string;
    modelRequirements: ModelRequirements;
    videoProfile: VideoCapabilityConfig;
    videoMode: VideoGenerationMode;
    setVideoMode: (value: VideoGenerationMode) => void;
    videoStartFrameAttachmentId?: string;
    setVideoStartFrameAttachmentId: (value?: string) => void;
    videoEndFrameAttachmentId?: string;
    setVideoEndFrameAttachmentId: (value?: string) => void;
    imageProfile: ImageCapabilityConfig;
    config: AiConfig;
    onModelChange: (value: string) => void;
    ratio: string;
    setRatio: (value: string) => void;
    seconds: string;
    setSeconds: (value: string) => void;
    quality: string;
    setQuality: (value: string) => void;
    videoQuality: string;
    setVideoQuality: (value: string) => void;
    count: string;
    setCount: (value: string) => void;
    textStreaming: boolean;
    setTextStreaming: (value: boolean) => void;
    textThinking: boolean;
    setTextThinking: (value: boolean) => void;
    promptOptimizerProvider: PromptOptimizerProvider | null;
    composerFocusRef: RefObject<HTMLTextAreaElement | null>;
    onPromptFocus: () => void;
    placeholderOverride?: string;
    onSubmit: () => void;
};

type CreationReferenceFilter = "all" | "image" | "video" | "audio" | "file";

export function CreationComposer(props: ComposerProps) {
    const [previewUrl, setPreviewUrl] = useState("");
    const [previewType, setPreviewType] = useState<"image" | "video">("image");
    const [promptOptimizerOpen, setPromptOptimizerOpen] = useState(false);
    const [referenceFilter, setReferenceFilter] = useState<CreationReferenceFilter>("all");
    const [canDragReferences, setCanDragReferences] = useState(false);
    const [dropTargetReferenceId, setDropTargetReferenceId] = useState<string | null>(null);
    const attachmentTrackRef = useRef<HTMLUListElement>(null);
    const cardDragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);
    const suppressAttachmentClickRef = useRef(false);
    const [trackState, setTrackState] = useState({ canScrollLeft: false, canScrollRight: false, isExpanded: true, isDragging: false });
    const previousAttachmentCountRef = useRef(0);
    const interactionBusy = props.busy || props.referenceReplacementBusy;
    const canSubmit = Boolean(props.prompt.trim()) && !interactionBusy;
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const priceChannel = resolveModelChannel(props.config, props.model);
    const [routeQuote, setRouteQuote] = useState<LogicalModelQuote | null>(null);
    const canOptimizePrompt = Boolean(props.promptOptimizerProvider) && (props.mode === "image" || props.mode === "video");
    const optimizerReferences = props.references.filter((reference) => reference.active && reference.kind !== "skill");
    const pricingCapability = props.mode === "text" ? undefined : props.mode;
    const pricingConfig = useMemo(() => ({
        ...props.config,
        model: props.model,
        imageModel: props.mode === "image" ? props.model : props.config.imageModel,
        videoModel: props.mode === "video" ? props.model : props.config.videoModel,
        size: props.ratio || props.config.size,
        quality: props.quality || props.config.quality,
        vquality: props.videoQuality || props.config.vquality,
        videoSeconds: props.mode === "video" ? props.seconds : props.config.videoSeconds,
        count: props.mode === "image" ? props.count : props.config.count,
    }), [props.config, props.count, props.mode, props.model, props.quality, props.ratio, props.seconds, props.videoQuality]);
    const quoteRequest = useMemo(() => modelQuoteRequest(pricingConfig, props.model, pricingCapability, props.modelRequirements), [pricingCapability, pricingConfig, props.model, props.modelRequirements]);
    const configuredCredits = requestCreditCost({
        channelMode: priceChannel.scope === "system" ? "remote" : "local",
        modelCosts: priceChannel.modelCosts,
        model: modelOptionName(props.model),
        count: props.mode === "image" ? props.count : 1,
        seconds: props.mode === "video" ? props.seconds : 1,
        capability: pricingCapability,
        config: pricingConfig,
        requirements: props.modelRequirements,
    });
    useEffect(() => {
        if (!creditsEnabled || !quoteRequest) {
            setRouteQuote(null);
            return;
        }
        const controller = new AbortController();
        setRouteQuote(null);
        quoteModel(quoteRequest, controller.signal)
            .then(({ quote }) => setRouteQuote(quote))
            .catch(() => {
                if (!controller.signal.aborted) setRouteQuote(null);
            });
        return () => controller.abort();
    }, [creditsEnabled, quoteRequest]);
    const generationCredits = routeQuote ? routeQuote.amountMicrocredits / 1_000_000 : configuredCredits;
    const showCost = creditsEnabled && generationCredits !== null && generationCredits !== undefined;
    const formattedCredits = generationCredits?.toLocaleString("zh-CN", { maximumFractionDigits: 6 });
    const actionLabel = props.referenceReplacementBusy ? "正在替换参考图" : interactionBusy || (props.generationActive && !canSubmit) ? "生成中" : showCost ? `${routeQuote?.estimated ? "预估" : "消耗"} ${formattedCredits} 积分，发送` : "发送";
    // Send-button working state must span the WHOLE generation (not just the
    // submit-lock window): spinner + glow stay while a message is pending and
    // the composer is empty; typing a next prompt returns the arrow so the
    // user knows a new send is possible.
    const showWorkingSpinner = interactionBusy || (props.generationActive && !canSubmit);
    const showWorkingGlow = props.generationActive && !canSubmit;
    const placeholder = props.mode === "text"
        ? "描述你的故事、角色或想继续讨论的创意"
        : props.mode === "image"
            ? "描述画面、人物、场景、构图与风格"
            : "描述镜头内容、运动、光线与节奏";
    const emptyPlaceholder = "输入你的镜头、画面或故事。也可以添加参考图开始创作";
    const referenceCounts = useMemo(() => props.attachments.reduce((counts, attachment) => {
        const kind = creationAttachmentKind(attachment);
        counts[kind] += 1;
        return counts;
    }, { image: 0, video: 0, audio: 0, file: 0 }), [props.attachments]);
    const imageReferencesSupported = props.imageProfile.references.maxImages > 0;
    const referencesSupported = props.mode === "image"
        ? imageReferencesSupported
        : props.mode !== "video" || props.maxReferences > 0;
    const videoReferenceLimits = props.videoReferenceLimits ?? props.videoProfile.references;
    const canAddMoreReferences = referencesSupported && (props.mode === "video"
        ? props.videoMode === "image" || props.videoMode === "keyframes"
            ? true
            : referenceCounts.image < videoReferenceLimits.maxImages
                    || referenceCounts.video < videoReferenceLimits.maxVideos
                    || referenceCounts.audio < videoReferenceLimits.maxAudios
        : props.attachments.length < props.maxReferences);
    const addReferenceLabel = interactionBusy
        ? props.referenceReplacementBusy ? "正在替换参考图" : "生成中暂不能添加参考内容"
        : canAddMoreReferences ? "添加更多参考内容" : props.mode === "video" && props.videoMode === "text" ? "文生视频不使用参考素材" : "已达到当前模型的参考素材上限";
    const imageAttachments = useMemo(() => props.attachments.filter(isImageAttachment), [props.attachments]);
    const activeVideoAttachmentIds = useMemo(() => {
        if (props.mode !== "video") return new Set(props.attachments.map((item) => item.id));
        if (props.videoMode === "reference") return new Set(props.attachments.filter((item) => creationAttachmentKind(item) !== "file").map((item) => item.id));
        if (props.videoMode === "text") return new Set<string>();
        const start = imageAttachments.find((item) => item.id === props.videoStartFrameAttachmentId) || imageAttachments[0];
        if (props.videoMode === "image") return new Set(start ? [start.id] : []);
        const end = imageAttachments.find((item) => item.id === props.videoEndFrameAttachmentId && item.id !== start?.id) || imageAttachments.find((item) => item.id !== start?.id);
        return new Set([start?.id, end?.id].filter((value): value is string => Boolean(value)));
    }, [imageAttachments, props.attachments, props.mode, props.videoEndFrameAttachmentId, props.videoMode, props.videoStartFrameAttachmentId]);
    const visibleAttachments = useMemo(() => referenceFilter === "all"
        ? props.attachments
        : props.attachments.filter((attachment) => creationAttachmentKind(attachment) === referenceFilter), [props.attachments, referenceFilter]);
    const imageSettingsSupported = props.imageProfile.size.parameter !== "none" || props.imageProfile.quality.supported || props.imageProfile.maxOutputs > 1;
    const updateTrackScrollState = useCallback(() => {
        const track = attachmentTrackRef.current;
        if (!track) return;
        setTrackState((current) => ({
            ...current,
            canScrollLeft: track.scrollLeft > 1,
            canScrollRight: track.scrollLeft + track.clientWidth < track.scrollWidth - 1,
        }));
    }, []);
    const setReferencePanelExpanded = useCallback((isExpanded: boolean) => {
        setTrackState((current) => ({ ...current, isExpanded }));
        if (!isExpanded) setReferenceFilter("all");
    }, []);
    useEffect(() => {
        const hadAttachments = previousAttachmentCountRef.current > 0;
        if (!props.attachments.length) setReferencePanelExpanded(false);
        else if (!hadAttachments) setReferencePanelExpanded(true);
        previousAttachmentCountRef.current = props.attachments.length;
        updateTrackScrollState();
    }, [props.attachments.length, setReferencePanelExpanded, updateTrackScrollState]);
    useEffect(() => {
        const query = window.matchMedia("(hover: hover) and (pointer: fine)");
        const update = () => setCanDragReferences(query.matches);
        update();
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);
    useEffect(() => {
        const frame = window.requestAnimationFrame(updateTrackScrollState);
        return () => window.cancelAnimationFrame(frame);
    }, [referenceFilter, trackState.isExpanded, updateTrackScrollState, visibleAttachments.length]);
    const beginCardDrag = (event: PointerEvent<HTMLElement>) => {
        if (event.button !== 0 || interactionBusy || !trackState.isExpanded) return;
        if ((event.target as HTMLElement).closest(".creation-reference-card-remove")) return;
        cardDragRef.current = { startX: event.clientX, startY: event.clientY, moved: false };
    };
    const endCardDrag = (event: PointerEvent<HTMLElement>) => {
        const drag = cardDragRef.current;
        if (!drag) return;
        cardDragRef.current = null;
        if (drag.moved) {
            suppressAttachmentClickRef.current = true;
            window.setTimeout(() => { suppressAttachmentClickRef.current = false; }, 0);
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        setTrackState((current) => ({ ...current, isDragging: false }));
    };
    const moveCardDrag = (event: PointerEvent<HTMLElement>) => {
        const drag = cardDragRef.current;
        if (!drag || drag.moved) return;
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= 4) return;
        drag.moved = true;
        setTrackState((current) => ({ ...current, isDragging: true, isExpanded: true }));
    };
    const previewAttachment = (type: "image" | "video", url: string) => {
        if (suppressAttachmentClickRef.current || cardDragRef.current?.moved) return;
        setPreviewType(type);
        setPreviewUrl(url);
    };
    const reorderVisibleAttachments = useCallback((next: CreationAttachment[]) => {
        if (referenceFilter === "all") {
            props.onReorderAttachments(next);
            return;
        }
        const visibleIds = new Set(visibleAttachments.map((attachment) => attachment.id));
        const reordered = [...next];
        props.onReorderAttachments(props.attachments.map((attachment) => visibleIds.has(attachment.id) ? reordered.shift() || attachment : attachment));
    }, [props.attachments, props.onReorderAttachments, referenceFilter, visibleAttachments]);
    useEffect(() => {
        if (!canOptimizePrompt) setPromptOptimizerOpen(false);
    }, [canOptimizePrompt]);

    const scrollAttachmentTrack = (direction: -1 | 1) => {
        const track = attachmentTrackRef.current;
        if (!track) return;
        track.scrollBy({ left: direction * Math.max(track.clientWidth * 0.72, 120), behavior: "smooth" });
        window.setTimeout(updateTrackScrollState, 180);
    };
    const imageReferenceAtPoint = (x: number, y: number) => {
        for (const element of document.elementsFromPoint(x, y)) {
            const chip = element.closest<HTMLElement>("[data-mention-reference-id]");
            const referenceId = chip?.dataset.mentionReferenceId;
            const reference = referenceId ? props.references.find((item) => item.id === referenceId) : undefined;
            if (reference?.kind === "image" && reference.attachmentId) return reference;
        }
        return undefined;
    };
    const composer = <HoverBorderGradient as="div" duration={2.2} containerClassName="creation-composer-shell" className="creation-composer-shell-inner">
        <SpotlightSurface
            className={`creation-chat-composer is-${props.variant}`}
            contentClassName="contents"
            spotlightColor="color-mix(in srgb, var(--user-ink) 12%, transparent)"
            spotlightRadius={280}
        >
        <div className="creation-chat-writing-surface">
            <div className="creation-chat-editor">
                <CanvasResourceMentionTextarea ref={props.composerFocusRef} value={props.prompt} references={props.references} mentionMenuWidth={400} sendOnEnter onFocus={props.onPromptFocus} onChange={props.setPrompt} onSubmit={props.onSubmit} containerClassName="creation-chat-mention-container" className="creation-chat-mention-editor creation-scrollbar" style={{ color: "var(--creation-text)" }} placeholder={props.placeholderOverride || (props.variant === "empty" ? emptyPlaceholder : placeholder)} aria-label="创作提示词，可使用 @ 引用当前参考内容或技能；回车发送，Shift+回车换行" spellCheck disabled={interactionBusy} activeDropReferenceId={dropTargetReferenceId} onReferenceFilesDrop={(reference, files) => { const target = props.references.find((item) => item.id === reference.id); if (target?.attachmentId) props.onReplaceReferenceFiles(target.attachmentId, files); }} />
                {props.attachments.length || referencesSupported ? <div className={`creation-reference-panel${trackState.isExpanded ? " is-expanded" : ""}`} aria-busy={interactionBusy}>
                    {props.mode === "video" && props.videoMode !== "reference" && props.videoMode !== "text" ? <VideoFrameAssignments
                        mode={props.videoMode}
                        images={imageAttachments}
                        startId={props.videoStartFrameAttachmentId}
                        endId={props.videoEndFrameAttachmentId}
                        onStartChange={props.setVideoStartFrameAttachmentId}
                        onEndChange={props.setVideoEndFrameAttachmentId}
                    /> : null}
                    {trackState.isExpanded ? <div className="creation-reference-panel-header">
                        <div className="creation-reference-filter-tabs" role="group" aria-label="筛选参考内容">
                            {([
                                { id: "all", label: "全部", count: props.attachments.length },
                                { id: "image", label: "图片", count: referenceCounts.image },
                                { id: "video", label: "视频", count: referenceCounts.video },
                                { id: "audio", label: "音频", count: referenceCounts.audio },
                                { id: "file", label: "文件", count: referenceCounts.file },
                            ] as const).map((filter) => <button key={filter.id} type="button" aria-pressed={referenceFilter === filter.id} className={referenceFilter === filter.id ? "is-active" : undefined} onClick={() => setReferenceFilter(filter.id)}>{filter.label}{filter.count ? ` (${filter.count})` : ""}</button>)}
                        </div>
                        <div className="creation-reference-panel-actions">
                            {props.attachments.length ? <button type="button" onClick={props.onClearAttachments} disabled={interactionBusy}>清空全部素材</button> : null}
                            <Tooltip title="收起素材面板"><button type="button" className="creation-reference-panel-collapse" onClick={() => setReferencePanelExpanded(false)} aria-label="收起素材面板"><Minimize2 aria-hidden="true" /></button></Tooltip>
                        </div>
                    </div> : null}
                    <div className="creation-reference-track-wrapper">
                        <div className="creation-reference-stack-shell">
                            {trackState.canScrollLeft ? <button type="button" className="creation-reference-track-button is-left" onClick={() => scrollAttachmentTrack(-1)} aria-label="向左浏览参考内容" title="向左浏览参考内容"><ChevronLeft aria-hidden="true" /></button> : null}
                            <Reorder.Group<CreationAttachment[]>
                                as="ul"
                                ref={attachmentTrackRef}
                                className={`creation-reference-track${trackState.isExpanded ? " is-expanded" : ""}${trackState.isDragging ? " is-dragging" : ""}${visibleAttachments.length ? "" : " is-empty"}`}
                                axis="x"
                                values={visibleAttachments}
                                onReorder={reorderVisibleAttachments}
                                layoutScroll
                                role="list"
                                aria-label="参考内容轨道"
                                onScroll={updateTrackScrollState}
                            >
                                {visibleAttachments.map((item) => <Reorder.Item<CreationAttachment>
                                    key={item.id}
                                    value={item}
                                    layout="position"
                                    drag={trackState.isExpanded && canDragReferences && !interactionBusy}
                                    className={`creation-reference-stack-card${props.mode === "video" && !activeVideoAttachmentIds.has(item.id) ? " is-inactive" : ""}`}
                                    onPointerDown={beginCardDrag}
                                    onPointerMove={moveCardDrag}
                                    onPointerUp={endCardDrag}
                                    onPointerCancel={endCardDrag}
                                    onDragStart={() => { setDropTargetReferenceId(null); setTrackState((current) => ({ ...current, isDragging: true, isExpanded: true })); }}
                                    onDrag={(_, info) => {
                                        if (creationAttachmentKind(item) !== "image") return;
                                        const target = imageReferenceAtPoint(info.point.x, info.point.y);
                                        setDropTargetReferenceId(target?.attachmentId !== item.id ? target?.id || null : null);
                                    }}
                                    onDragEnd={(_, info) => {
                                        const target = creationAttachmentKind(item) === "image" ? imageReferenceAtPoint(info.point.x, info.point.y) : undefined;
                                        setDropTargetReferenceId(null);
                                        setTrackState((current) => ({ ...current, isDragging: false, isExpanded: true }));
                                        if (target?.attachmentId && target.attachmentId !== item.id) props.onReplaceAttachment(target.attachmentId, item);
                                    }}
                                >
                                    <CreationAttachmentThumbnail item={item} onPreview={previewAttachment} onRemove={props.onRemoveAttachment} />
                                    {props.mode === "video" && !activeVideoAttachmentIds.has(item.id) ? <span className="creation-reference-inactive-label">当前模式不使用</span> : null}
                                </Reorder.Item>)}
                                {!visibleAttachments.length && props.attachments.length ? <li className="creation-reference-filter-empty">该类型暂无参考内容</li> : null}
                                {referencesSupported ? <li className="creation-reference-add-slot"><Tooltip title={addReferenceLabel}><button type="button" className="creation-reference-add-button" onClick={props.onOpenLibrary} disabled={interactionBusy || !canAddMoreReferences} aria-label={addReferenceLabel}><Plus aria-hidden="true" /><span>参考内容</span></button></Tooltip></li> : null}
                            </Reorder.Group>
                            {trackState.canScrollRight ? <button type="button" className="creation-reference-track-button is-right" onClick={() => scrollAttachmentTrack(1)} aria-label="向右浏览参考内容" title="向右浏览参考内容"><ChevronRight aria-hidden="true" /></button> : null}
                            {!trackState.isExpanded && props.attachments.length ? <Tooltip title="查看全部"><button type="button" className="creation-reference-panel-expand" onClick={() => setReferencePanelExpanded(true)} aria-label={`查看全部 ${props.attachments.length} 个参考内容`} aria-expanded="false"><Maximize2 aria-hidden="true" /></button></Tooltip> : null}
                        </div>
                    </div>
                </div> : null}
            </div>
        </div>
        <footer className="creation-chat-dock">
            <div className="creation-chat-controls">
                {props.variant === "thread" ? <ModePicker mode={props.mode} onModeChange={props.onModeChange} /> : null}
                <VoiceRecordingButton
                    className="creation-voice-trigger"
                    disabled={interactionBusy}
                    onTranscribed={(text) => props.setPrompt(props.prompt.trim() ? `${props.prompt} ${text}` : text)}
                />
                {canOptimizePrompt ? <Tooltip title="用 AI 优化提示词">
                    <button
                        type="button"
                        className="creation-chat-control"
                        onClick={() => setPromptOptimizerOpen(true)}
                        aria-label="优化提示词"
                        aria-expanded={promptOptimizerOpen}
                        aria-haspopup="dialog"
                    >
                        <WandSparkles />
                        <span>优化</span>
                    </button>
                </Tooltip> : null}
				<ModelPicker config={props.config} value={props.model} onChange={props.onModelChange} capability={props.mode} requirements={props.modelRequirements} className="creation-model-picker" placeholder={`选择${modeLabels[props.mode]}模型`} showSelectedPrice={false} showOptionPrices variant="creation" />
                {props.mode === "video" ? <VideoModeMenu value={props.videoMode} onChange={props.setVideoMode} videoProfile={modelCapabilityConfigFor(props.config, props.model).video} /> : null}
                {props.mode === "video" || (props.mode === "image" && imageSettingsSupported) ? <GenerationSettingsMenu {...props} /> : null}
                {props.mode === "video" ? <DurationMenu profile={props.videoProfile} seconds={props.seconds} onChange={props.setSeconds} /> : null}
                {props.mode === "text" ? <>
                    <Tooltip title={interactionBusy ? "生成中，此开关将在下次发送时生效" : (props.textStreaming ? "流式输出已开启" : "流式输出已关闭")}><button type="button" className="creation-chat-control" aria-pressed={props.textStreaming} disabled={interactionBusy} onClick={() => props.setTextStreaming(!props.textStreaming)}><Waves /><span>流式</span></button></Tooltip>
                    <Tooltip title={interactionBusy ? "生成中，此开关将在下次发送时生效" : (props.textThinking ? "思考已开启，会展示模型返回的推理摘要" : "开启模型思考")}><button type="button" className="creation-chat-control" aria-pressed={props.textThinking} disabled={interactionBusy} onClick={() => props.setTextThinking(!props.textThinking)}><Brain /><span>思考</span></button></Tooltip>
                </> : null}
                {props.prompt.trim() || props.attachments.length || props.references.some((reference) => reference.active) ? <Tooltip title="清空提示词和参考内容"><button type="button" className="creation-chat-control is-clear" onClick={props.onClearComposer} disabled={interactionBusy} aria-label="清空提示词和参考内容"><Trash2 /><span>清空</span></button></Tooltip> : null}
            </div>
            <Button
                type="text"
                className={`creation-submit ${showCost ? "has-cost" : ""}`}
                disabled={interactionBusy || !canSubmit}
                style={{
                    position: "relative",
                    color: "var(--user-ink)",
                } as CSSProperties}
                onClick={interactionBusy ? undefined : props.onSubmit}
                aria-label={actionLabel}
                title={!canSubmit && !interactionBusy ? "输入创作想法后即可生成" : actionLabel}
            >
                {showWorkingGlow ? <WorkingGlow active color="var(--creation-text)" radius="999px" /> : null}
                {showCost ? <span className="creation-submit-cost" title={routeQuote ? modelQuoteDescription(routeQuote) : undefined}><CreditSymbol /><span>{routeQuote?.estimated ? `预估:${formattedCredits}` : formattedCredits}</span></span> : null}
                <span className="creation-submit-action" aria-hidden>{showWorkingSpinner ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}<span>{showWorkingSpinner ? "生成中" : "开始创作"}</span></span>
            </Button>
        </footer>
        <CreationMediaPreviewModal url={previewUrl} type={previewType} onClose={() => setPreviewUrl("")} />
        </SpotlightSurface>
    </HoverBorderGradient>;

    if (!promptOptimizerOpen) return composer;

    return (
        <Suspense fallback={composer}><CanvasPromptOptimizerDrawer
            open={promptOptimizerOpen}
            prompt={props.prompt}
            generationMode={props.mode === "video" ? "video" : "image"}
            targetModel={modelOptionName(props.model) || props.model}
            targetProtocol={priceChannel.modelCosts?.find((item) => item.model === modelOptionName(props.model))?.protocol || priceChannel.interfaceType}
            config={props.config}
            optimizerModel={props.config.textModel}
            references={optimizerReferences}
            provider={props.promptOptimizerProvider}
            onClose={() => setPromptOptimizerOpen(false)}
            onApply={props.setPrompt}
        >
            {composer}
        </CanvasPromptOptimizerDrawer></Suspense>
    );
}

function VideoModeMenu({ value, onChange, videoProfile }: { value: VideoGenerationMode; onChange: (value: VideoGenerationMode) => void; videoProfile?: VideoModeCapabilityLike | null }) {
    const [open, setOpen] = useState(false);
    // 只列出模型支持的模式；当前模式不被支持时收敛到第一个可用项，避免选完到提交才报「不支持」。
    const allowedModes = supportedVideoGenerationModes(videoProfile);
    const modeOptions = allowedModes.length ? VIDEO_GENERATION_MODE_OPTIONS.filter((option) => allowedModes.includes(option.value)) : VIDEO_GENERATION_MODE_OPTIONS;
    const allowedKey = modeOptions.map((option) => option.value).join(",");
    const selected = modeOptions.find((item) => item.value === value) || modeOptions[0];
    useEffect(() => {
        if (modeOptions.some((item) => item.value === value)) return;
        onChange(modeOptions[0].value);
        // allowedKey 代替 modeOptions 作为依赖：数组每次渲染都是新引用。
    }, [allowedKey, value, onChange]); // eslint-disable-line react-hooks/exhaustive-deps
    return <Popover
        open={open}
        onOpenChange={setOpen}
        trigger="click"
        placement="bottom"
        arrow={false}
        classNames={{ root: "creation-control-popover", container: "creation-control-popover-surface", content: "creation-control-popover-content" }}
        content={<div className="creation-video-mode-menu" role="radiogroup" aria-label="视频生成模式">
            {modeOptions.map((option) => <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={option.value === value}
                className={option.value === value ? "is-selected" : undefined}
                onClick={() => { onChange(option.value); setOpen(false); }}
            ><strong>{option.label}</strong><small>{option.description}</small></button>)}
        </div>}
    >
        <button type="button" className="creation-chat-control" aria-label={`视频生成模式：${selected.label}`} aria-expanded={open}><Images /><span>{selected.label}</span><ChevronDown className={open ? "is-open" : ""} /></button>
    </Popover>;
}

function VideoFrameAssignments({ mode, images, startId, endId, onStartChange, onEndChange }: {
    mode: "image" | "keyframes";
    images: CreationAttachment[];
    startId?: string;
    endId?: string;
    onStartChange: (value?: string) => void;
    onEndChange: (value?: string) => void;
}) {
    const options = images.map((item) => ({ value: item.id, label: item.name }));
    const resolvedStart = options.some((item) => item.value === startId) ? startId : options[0]?.value;
    const resolvedEnd = options.some((item) => item.value === endId && item.value !== resolvedStart) ? endId : options.find((item) => item.value !== resolvedStart)?.value;
    return <div className="creation-video-frame-assignments" aria-label={mode === "keyframes" ? "首尾帧设置" : "首帧设置"}>
        <label><span>首帧</span><select value={resolvedStart || ""} onChange={(event) => onStartChange(event.target.value || undefined)}><option value="">请选择图片</option>{options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        {mode === "keyframes" ? <label><span>尾帧</span><select value={resolvedEnd || ""} onChange={(event) => onEndChange(event.target.value || undefined)}><option value="">请选择另一张图片</option>{options.filter((item) => item.value !== resolvedStart).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label> : null}
    </div>;
}

export function CreationModeTabs({ mode, onModeChange, agentActive = false, onAgentSelect, orientation = "horizontal" }: { mode: CreationMode; onModeChange: (mode: CreationMode) => void; agentActive?: boolean; onAgentSelect?: () => void; orientation?: "horizontal" | "vertical" }) {
    const reducedMotion = useReducedMotion();
    const items: { mode: CreationMode; icon: ReactNode; label: string }[] = [
        { mode: "video", icon: <Film />, label: "视频" },
        { mode: "image", icon: <ImageIcon />, label: "图片" },
        { mode: "text", icon: <MessageSquareText />, label: "文本" },
    ];
    const indicator = (pressed: boolean) => pressed ? (
        <motion.span
            layoutId={`creation-mode-indicator-${orientation}`}
            className="creation-mode-indicator"
            aria-hidden
            transition={reducedMotion ? { duration: 0 } : aceternityMotion.spring.dock}
        />
    ) : null;
    return <LayoutGroup id={`creation-mode-tabs-${orientation}`}>
        <div className="creation-mode-tabs" role="group" aria-label="创作模式" data-active-mode={agentActive ? "agent" : mode} data-orientation={orientation} style={{ gridTemplateColumns: orientation === "vertical" ? "minmax(0, 1fr)" : `repeat(${onAgentSelect ? 4 : 3}, minmax(0, 1fr))` }}>
        {items.map((item) => (
            <button key={item.mode} type="button" className="creation-mode-button" data-mode={item.mode} aria-pressed={!agentActive && item.mode === mode} aria-label={`${item.label}生成`} onClick={() => onModeChange(item.mode)}>
                {indicator(!agentActive && item.mode === mode)}
                {item.icon}
                <span>{item.label}</span>
            </button>
        ))}
        {onAgentSelect ? <button type="button" className="creation-mode-button" data-mode="agent" aria-pressed={agentActive} onClick={onAgentSelect}>{indicator(agentActive)}<Brain /><span>Agent</span><i className="creation-mode-spark" aria-hidden /></button> : null}
        </div>
    </LayoutGroup>;
}

function ModePicker({ mode, onModeChange }: { mode: CreationMode; onModeChange: (mode: CreationMode) => void }) {
    return <CreationModeTabs mode={mode} onModeChange={onModeChange} />;
}

function GenerationSettingsMenu(props: ComposerProps) {
    const [open, setOpen] = useState(false);
    const mjOptions = useLk888MjOptionsStore((state) => state.options);
    const apimartMjOptions = useApimartMjOptionsStore((state) => state.options);
    const tt25Options = useLk888ImageOptionsStore((state) => state.options);
    const activeQualityOptions = props.imageProfile.quality.values.map((value) => qualityOptions.find((item) => item.value === value) || { value, label: imageQualityLabel(value), description: "模型支持的质量/分辨率" });
    const qualityLabel = activeQualityOptions.find((item) => item.value === props.quality)?.label || qualityOptions.find((item) => item.value === props.quality)?.label || props.quality || "自动";
    // 尺寸/比例/分辨率选项取同显示名分组内全部模型的并集，路由模型只决定发送参数。
    const mergedProfile = mergedImageCapabilityConfig(props.config, props.model || props.config.imageModel);
    const modelProtocol = resolveModelChannel(props.config, props.model).modelCosts?.find((item) => item.model === modelOptionName(props.model))?.protocol || resolveModelChannel(props.config, props.model).interfaceType;
    const showMjOptions = props.mode === "image" && isLk888MjProtocol(modelProtocol);
    const showApimartMjOptions = props.mode === "image" && isApimartMjProtocol(modelProtocol);
    const showTt25Options = props.mode === "image" && isTtImage25(modelProtocol, modelOptionName(props.model));
    const usesImageResolutionPicker = props.mode === "image" && supportsImageResolutionPresets(mergedProfile.size);
    const imageResolutionOptions = usesImageResolutionPicker ? buildImageResolutionOptions(mergedProfile.size.values) : [];
    const ratios = props.videoProfile.ratios;
    const referenceImageSize = props.mode === "image" && mergedProfile.size.allowCustom ? props.referenceImageSize : undefined;
    const referenceImageSizeValue = referenceImageSize ? String(referenceImageSize.width) + "x" + String(referenceImageSize.height) : "";
    const referenceImageSizeLabel = referenceImageSize ? String(referenceImageSize.width) + " × " + String(referenceImageSize.height) : "";
    const referenceImageSizeSelected = Boolean(referenceImageSizeValue && props.ratio === referenceImageSizeValue);
    const resolutions = props.mode === "video" ? props.videoProfile.resolutions.map((value) => ({ value: value.replace(/p$/i, ""), label: videoResolutionLabel(value) })) : resolutionOptions;
    const selectReferenceImageSize = () => {
        if (!referenceImageSizeValue) return;
        props.setRatio(referenceImageSizeValue);
    };
    const videoResolutionSupported = props.mode === "video" && resolutions.length > 0;
    const imageSummary = [
        ...(mergedProfile.size.parameter !== "none" ? [referenceImageSizeSelected ? referenceImageSizeLabel : usesImageResolutionPicker ? formatImageResolutionSize(props.ratio, imageResolutionOptions) : props.ratio] : []),
        ...(props.imageProfile.quality.supported ? [qualityLabel] : []),
        ...(props.imageProfile.maxOutputs > 1 ? [props.count] : []),
    ].join(" · ");
    const videoRatioSupported = props.mode === "video" && ratios.length > 0;
    const summary = props.mode === "video" ? [...(videoRatioSupported ? [props.ratio] : []), ...(videoResolutionSupported ? [videoResolutionLabel(props.videoQuality)] : [])].join(" · ") : [imageSummary, showMjOptions ? lk888MjSummary(mjOptions) : "", showApimartMjOptions ? apimartMjSummary(apimartMjOptions) : "", showTt25Options ? lk888Image25Summary(tt25Options) : ""].filter(Boolean).join(" · ");
    const panel = <div className="creation-parameter-menu">
        {props.mode === "image" ? <ImageSizePicker profile={mergedProfile} size={props.ratio} quality={props.quality} onChange={(size, quality) => { props.setRatio(size); if (quality) props.setQuality(quality); }} /> : videoRatioSupported ? <SettingSection title="画幅" value={props.ratio}><div className="creation-choice-grid is-ratio">{ratios.map((value) => <button key={value} type="button" aria-pressed={value === props.ratio} className={value === props.ratio ? "is-selected" : ""} onClick={() => props.setRatio(value)}><span className="creation-ratio-preview"><span style={ratioPreviewStyle(value)} /></span><span>{value}</span></button>)}</div></SettingSection> : null}
        {showMjOptions ? <Lk888MjOptionsPanel /> : null}
        {showApimartMjOptions ? <ApimartMjOptionsPanel /> : null}
        {showTt25Options ? <Lk888Image25OptionsPanel /> : null}
        {props.mode === "image" && referenceImageSizeValue ? <button type="button" className="creation-custom-trigger" onClick={selectReferenceImageSize}>使用参考图尺寸 · {referenceImageSizeLabel}</button> : null}
        {props.mode === "video" ? (videoResolutionSupported ? <SettingSection title="清晰度" value={videoResolutionLabel(props.videoQuality)}><div className="creation-choice-grid is-resolution">{resolutions.map((option) => <button key={option.value} type="button" aria-pressed={option.value === props.videoQuality} className={option.value === props.videoQuality ? "is-selected" : ""} onClick={() => props.setVideoQuality(option.value)}>{option.label}</button>)}</div></SettingSection> : null) : <>

            {props.imageProfile.quality.supported && !imageResolutionUsesQuality(mergedProfile) ? <SettingSection title={activeQualityOptions.some((item) => item.value === "1k" || item.value === "2k") ? "分辨率" : "图片质量"} value={qualityLabel}><div className="creation-choice-grid is-quality">{activeQualityOptions.map((option) => <button key={option.value} type="button" aria-pressed={option.value === props.quality} className={option.value === props.quality ? "is-selected" : ""} onClick={() => props.setQuality(option.value)}><span>{option.label}</span><small>{option.description}</small></button>)}</div></SettingSection> : null}
            {props.imageProfile.maxOutputs > 1 ? <SettingSection title="生成数量" value={`${props.count} 张`}><div className="creation-parameter-content"><div className="creation-choice-grid is-count">{countOptions.filter((option) => Number(option) <= props.imageProfile.maxOutputs).map((option) => <button key={option} type="button" aria-pressed={option === props.count} className={option === props.count ? "is-selected" : ""} onClick={() => props.setCount(option)}>{option}</button>)}</div><label className="creation-custom-value"><span>自定义</span><input inputMode="numeric" pattern="[0-9]*" value={props.count} onChange={(event) => props.setCount(String(Math.max(1, Math.min(props.imageProfile.maxOutputs, Number(event.target.value) || 1))))} aria-label={`生成数量，范围 1 到 ${props.imageProfile.maxOutputs}`} /><em>张</em></label></div></SettingSection> : null}
        </>}
    </div>;
    return <Popover open={open} onOpenChange={setOpen} trigger="click" placement="bottom" arrow={false} classNames={{ root: "creation-control-popover", container: "creation-control-popover-surface", content: "creation-control-popover-content" }} content={panel}>
        <button type="button" className="creation-chat-control" aria-label={`生成设置：${summary}`}><SlidersHorizontal /><span>{summary}</span><ChevronDown className={open ? "is-open" : ""} /></button>
    </Popover>;
}

function SettingSection({ title, value, children }: { title: string; value?: string; children: ReactNode }) {
    return <section className="creation-parameter-section"><header><h3>{title}</h3>{value ? <span>{value}</span> : null}</header>{children}</section>;
}

function DurationMenu({ profile, seconds, onChange }: { profile: VideoCapabilityConfig; seconds: string; onChange: (value: string) => void }) {
    const [open, setOpen] = useState(false);
    const value = Number(normalizeVideoValue(profile, { seconds }).seconds);
    const presets = profile.duration.selection === "enum" ? videoDurationOptions(profile) : [];
    const fallbackPreset = presets.length ? presets : [profile.duration.default];
    const min = profile.duration.selection === "range" ? profile.duration.min || 1 : Math.min(...fallbackPreset);
    const max = profile.duration.selection === "range" ? Math.max(min, profile.duration.max || min) : Math.max(...fallbackPreset);
    const step = Math.max(1, profile.duration.step || 1);
    const durationControl = profile.duration.selection === "range" ? <>
        <input className="h-8 w-full" style={{ accentColor: "var(--creation-text)" }} type="range" min={min} max={max} step={step} value={value} aria-label="视频时长（秒）" onChange={(event) => onChange(event.target.value)} />
        <div className="flex justify-between px-0.5 text-[var(--fs-tiny)] text-[var(--creation-muted)]"><span>{min}s</span><span>{max}s</span></div>
        <label className="creation-custom-value is-duration"><span>自定义时长</span><span className="creation-duration-custom-field"><input type="number" min={min} max={max} step={step} inputMode="numeric" value={seconds} onFocus={(event) => event.currentTarget.select()} onBlur={() => onChange(String(value))} onChange={(event) => onChange(event.target.value)} aria-label="自定义视频时长，单位秒" /><em>秒</em></span></label>
    </> : <div className="creation-duration-choices">{presets.map((item) => <button key={item} type="button" className={item === value ? "is-selected" : ""} onClick={() => onChange(String(item))}>{item}s</button>)}</div>;
    return <Popover open={open} onOpenChange={setOpen} trigger="click" placement="bottom" arrow={false} classNames={{ root: "creation-control-popover", container: "creation-control-popover-surface", content: "creation-control-popover-content" }} content={<div className="creation-duration-menu"><div className="creation-duration-heading"><span>时长</span><strong>{value} 秒</strong></div>{durationControl}</div>}>
        <button type="button" className="creation-chat-control is-duration" aria-label={`视频时长：${value}秒`}><Clock3 /><span>{value}s</span><ChevronDown className={open ? "is-open" : ""} /></button>
    </Popover>;
}

function ratioPreviewStyle(value: string) {
    const [width, height] = value.replace("x", ":").split(":").map(Number);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { width: 10, height: 10 };
    // 画幅容器的可用空间是 14×10；同时计算宽高，避免 CSS 的 max-width/max-height 把宽银幕比例压扁。
    const scale = Math.min(14 / width, 10 / height);
    return { width: Math.max(4, Math.round(width * scale)), height: Math.max(4, Math.round(height * scale)) };
}
