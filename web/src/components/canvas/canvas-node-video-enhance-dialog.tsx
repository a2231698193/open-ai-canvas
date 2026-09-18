import { useEffect, useMemo, useState } from "react";
import { Button, Modal, Select, Segmented } from "antd";
import { WandSparkles } from "lucide-react";

import {
    defaultVideoEnhanceParams,
    estimateVideoEnhanceCredits,
    findVideoEnhanceModel,
    formatVideoEnhanceCredits,
    videoEnhanceDurationError,
    videoEnhanceDurationSeconds,
    VIDEO_ENHANCE_FPS_OPTIONS,
    VIDEO_ENHANCE_RESOLUTION_OPTIONS,
    VIDEO_ENHANCE_SCENE_OPTIONS,
    VIDEO_ENHANCE_STYLE_OPTIONS,
    VIDEO_ENHANCE_VERSION_OPTIONS,
    type VideoEnhanceFps,
    type VideoEnhanceParams,
    type VideoEnhanceResolution,
    type VideoEnhanceScene,
    type VideoEnhanceStyle,
    type VideoEnhanceVersion,
} from "@/lib/canvas/canvas-video-enhance";
import { modelDisplayName, type AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeData } from "@/types/canvas";

export function CanvasNodeVideoEnhanceDialog({
    node,
    open,
    config,
    onClose,
    onConfirm,
}: {
    node: CanvasNodeData;
    open: boolean;
    config: AiConfig;
    onClose: () => void;
    onConfirm: (params: VideoEnhanceParams) => void;
}) {
    const [params, setParams] = useState<VideoEnhanceParams>(defaultVideoEnhanceParams);
    const model = useMemo(() => findVideoEnhanceModel(config), [config]);
    const durationMs = node.metadata?.durationMs;
    const seconds = videoEnhanceDurationSeconds(durationMs);
    const durationError = videoEnhanceDurationError(durationMs);
    const hasKnownDuration = Boolean(durationMs && durationMs > 0);
    const estimatedCredits = estimateVideoEnhanceCredits(params, seconds);
    const sceneEnabled = params.toolVersion === "standard";
    const canSubmit = Boolean(model) && !durationError;

    useEffect(() => {
        if (!open) return;
        setParams(defaultVideoEnhanceParams);
    }, [node.id, open]);

    return (
        <Modal title={null} open={open} onCancel={onClose} footer={null} width={640} centered destroyOnHidden>
            <div className="space-y-5">
                <div>
                    <h2 className="text-xl font-semibold">视频超分</h2>
                    <p className="mt-2 text-sm opacity-60">提高清晰度并可选插帧，结果另存为新视频，不覆盖原片。源视频最长 10 分钟，输出时长与原片相同。</p>
                </div>
                <div className="rounded-xl border px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                        <span className="opacity-60">源视频</span>
                        <span className="truncate font-medium">{node.title || "未命名视频"}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                        <span className="opacity-60">时长</span>
                        <span className="font-medium">{hasKnownDuration ? `${seconds} 秒` : "未知，按实际上游时长计费"}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                        <span className="opacity-60">模型</span>
                        <span className="font-medium">{model ? modelDisplayName(config, model) : "未配置"}</span>
                    </div>
                </div>
                {!model ? <div className="text-sm font-medium text-[#ef4444]">后台尚未配置「视频超分」模型，请在云桥渠道添加 video-enhance。</div> : null}
                {durationError ? <div className="text-sm font-medium text-[#ef4444]">{durationError}</div> : null}
                <div className="space-y-2">
                    <div className="font-medium opacity-75">清晰度</div>
                    <Segmented
                        block
                        value={params.resolution}
                        options={VIDEO_ENHANCE_RESOLUTION_OPTIONS}
                        onChange={(value) => setParams((current) => ({ ...current, resolution: value as VideoEnhanceResolution }))}
                    />
                </div>
                <div className="space-y-2">
                    <div className="font-medium opacity-75">帧率</div>
                    <Segmented
                        block
                        value={params.fps}
                        options={VIDEO_ENHANCE_FPS_OPTIONS.map((item) => ({
                            value: item.value,
                            label: (
                                <span className="flex min-h-12 flex-col justify-center leading-5">
                                    <span className="font-medium">{item.label}</span>
                                    <span className="text-xs opacity-55">{item.description}</span>
                                </span>
                            ),
                        }))}
                        onChange={(value) => setParams((current) => ({ ...current, fps: value as VideoEnhanceFps }))}
                    />
                </div>
                <div className="space-y-2">
                    <div className="font-medium opacity-75">版本</div>
                    <Segmented
                        block
                        value={params.toolVersion}
                        options={VIDEO_ENHANCE_VERSION_OPTIONS.map((item) => ({
                            value: item.value,
                            label: (
                                <span className="flex min-h-12 flex-col justify-center leading-5">
                                    <span className="font-medium">{item.label}</span>
                                    <span className="text-xs opacity-55">{item.description}</span>
                                </span>
                            ),
                        }))}
                        onChange={(value) => setParams((current) => ({
                            ...current,
                            toolVersion: value as VideoEnhanceVersion,
                            scene: value === "professional" ? undefined : current.scene,
                        }))}
                    />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                        <div className="font-medium opacity-75">场景</div>
                        <Select
                            allowClear
                            className="w-full"
                            disabled={!sceneEnabled}
                            placeholder={sceneEnabled ? "可选" : "仅标准版可用"}
                            value={sceneEnabled ? params.scene : undefined}
                            options={VIDEO_ENHANCE_SCENE_OPTIONS}
                            onChange={(value) => setParams((current) => ({ ...current, scene: value as VideoEnhanceScene | undefined }))}
                        />
                    </div>
                    <div className="space-y-2">
                        <div className="font-medium opacity-75">增强风格</div>
                        <Select
                            allowClear
                            className="w-full"
                            placeholder="可选"
                            value={params.enhanceStyle}
                            options={VIDEO_ENHANCE_STYLE_OPTIONS}
                            onChange={(value) => setParams((current) => ({ ...current, enhanceStyle: value as VideoEnhanceStyle | undefined }))}
                        />
                    </div>
                </div>
                <div className="rounded-xl border px-4 py-3 text-sm">
                    <div className="flex items-center justify-between">
                        <span className="opacity-60">预估积分</span>
                        <span className="font-semibold">{formatVideoEnhanceCredits(estimatedCredits)}</span>
                    </div>
                    <p className="mt-2 text-xs opacity-55">按上游最低价 1 元 = 10 积分估算。专业版 10 倍，60fps 2 倍，120fps 4 倍；后台若只配了清晰度档，实际扣费以价格档为准。</p>
                </div>
                <div className="flex justify-end">
                    <Button type="primary" size="large" icon={<WandSparkles className="size-4" />} disabled={!canSubmit} onClick={() => onConfirm(params)}>
                        生成超分视频
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

