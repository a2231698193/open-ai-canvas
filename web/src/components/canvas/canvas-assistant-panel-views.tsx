import { Button, Select } from "antd";
import { Tooltip } from "@/components/ui/base/tooltip";
import { useMemo, useState } from "react";
import { AtSign, Cpu, Trash2, X } from "lucide-react";

import { modelDisplayName, modelIcon, resolveModelChannel, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { AgentImagePreview, type CanvasAgentChatMessage } from "./canvas-agent-chat-ui";
import { ModelLogo } from "@/components/model-logo";
import { useResolvedCanvasResourceReferences } from "./use-resolved-canvas-resource-references";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { CanvasNodeType, type CanvasAssistantMessage, type CanvasAssistantReference, type CanvasAssistantSession } from "@/types/canvas";
import { useThemeStore } from "@/stores/use-theme-store";

export function AgentTextModelPicker({ config, value, onChange }: { config: AiConfig; value: string; onChange: (model: string) => void }) {
    const options = useMemo(() => Array.from(new Set([value, ...selectableModelsByCapability(config, "text")].filter(Boolean))), [config, value]);
    const current = value || "";
    return (
        <div className="min-w-0 max-w-[240px]" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <Select<string>
                size="small"
                variant="borderless"
                value={current || undefined}
                className="agent-text-model-select w-full"
                popupMatchSelectWidth={288}
                options={options.map((model) => ({ value: model, label: agentModelLabel(config, model) }))}
                notFoundContent={<span className="block py-2 text-center text-xs text-foreground/48">暂无文本模型</span>}
                optionRender={(option) => {
                    const model = String(option.value);
                    return (
                        <span className="flex min-w-0 items-center gap-2">
                            <AgentModelIcon config={config} model={model} />
                            <span className="min-w-0 flex-1 truncate">{modelDisplayName(config, model)}</span>
                            {agentModelSource(config, model) ? <span className="shrink-0 text-xs opacity-55">{agentModelSource(config, model)}</span> : null}
                        </span>
                    );
                }}
                labelRender={() => (
                    <span className="flex min-w-0 items-center gap-1.5">
                        <AgentModelIcon config={config} model={current} />
                        <span className="min-w-0 truncate">{current ? modelDisplayName(config, current) : "选择文本模型"}</span>
                        {current && agentModelSource(config, current) ? <span className="shrink-0 opacity-55">{agentModelSource(config, current)}</span> : null}
                    </span>
                )}
                onChange={onChange}
                aria-label="选择 Agent 文本模型"
                title={current ? agentModelLabel(config, current) : "选择文本模型"}
            />
        </div>
    );
}

export function agentModelSource(config: AiConfig, model: string) {
    const channel = resolveModelChannel(config, model);
    return channel.scope === "system" ? "" : channel.name;
}

export function agentModelLabel(config: AiConfig, model: string) {
    const source = agentModelSource(config, model);
    return source ? `${modelDisplayName(config, model)} · ${source}` : modelDisplayName(config, model);
}

export function AgentModelIcon({ config, model }: { config: AiConfig; model: string }) {
    const icon = modelIcon(config, model);
    return icon ? <span className="inline-flex size-4 shrink-0 items-center justify-center"><ModelLogo icon={icon} size={16} /></span> : <Cpu className="size-4 shrink-0 opacity-70" />;
}

export function AssistantHistory({ sessions, activeSession, onOpen, onDelete }: { sessions: CanvasAssistantSession[]; activeSession: CanvasAssistantSession | null; onOpen: (id: string) => void; onDelete: (id: string) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div className="space-y-3">
            <div className="text-sm" style={{ color: theme.node.muted }}>
                {sessions.length ? `${sessions.length} 条历史` : "暂无历史"}
            </div>
            {sessions.map((session) => (
                <div key={session.id} className="rounded-md px-2.5 py-2 transition-colors" style={{ background: session.id === activeSession?.id ? theme.accent.primarySoft : "transparent", color: theme.node.text }}>
                    <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-1.5">
                                {session.id === activeSession?.id ? (
                                    <span className="shrink-0 text-[var(--fs-tiny)] font-medium" style={{ color: theme.node.text }}>
                                        当前
                                    </span>
                                ) : null}
                                <div className="truncate text-sm font-medium leading-5">{session.title}</div>
                            </div>
                            <div className="truncate text-[var(--fs-label)] leading-4 opacity-65">{sessionPreview(session)}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            <span className="text-[var(--fs-tiny)] opacity-55">{formatSessionTime(session.updatedAt || session.createdAt)}</span>
                            <Button size="small" className="!h-6 !px-2" onClick={() => onOpen(session.id)}>
                                进入
                            </Button>
                            <Tooltip title="删除记录">
                                <Button size="small" danger type="text" className="!h-6 !w-6 !min-w-6" icon={<Trash2 className="size-3.5" />} onClick={() => onDelete(session.id)} />
                            </Tooltip>
                        </div>
                    </div>
                </div>
            ))}
            {!sessions.length ? (
                <div className="px-3 py-8 text-center text-sm" style={{ color: theme.node.muted }}>
                    网站 Agent 的对话记录会显示在这里
                </div>
            ) : null}
        </div>
    );
}

export function MessageReferences({ message }: { message: CanvasAssistantMessage }) {
    return (
        <div className={`flex max-w-[88%] flex-wrap gap-2 ${message.role === "user" ? "ml-auto justify-end" : "ml-11 justify-start"}`}>
            {message.references?.map((item, index, references) => (
                <AssistantReferenceChip key={item.id} item={item} label={assistantImageReferenceLabel(references, index)} />
            ))}
        </div>
    );
}

export function promptAlreadyHasMention(prompt: string, label: string) {
    const token = `@${label}`;
    let from = 0;
    while (from <= prompt.length) {
        const index = prompt.indexOf(token, from);
        if (index < 0) return false;
        const next = prompt[index + token.length];
        if (!next || /\s|[,.!?;:，。！？；：、)\]}】）]/.test(next)) return true;
        from = index + 1;
    }
    return false;
}

export function AssistantReferenceChip({ item, label, previewUrl, onRemove, onInsertMention }: { item: CanvasAssistantReference; label?: string; previewUrl?: string; onRemove?: () => void; onInsertMention?: (label: string) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [previewOpen, setPreviewOpen] = useState(false);
    const mentionReference = useMemo(() => assistantReferencesToMentionReferences([item]), [item]);
    const resolvedReference = useResolvedCanvasResourceReferences(mentionReference)[0];
    const text = (item.text || item.title).replace(/\s+/g, " ").trim().slice(0, 1) || "文";
    const imageUrl = previewUrl || resolvedReference?.previewUrl || item.dataUrl;
    const hasImage = Boolean(imageUrl || item.storageKey);
    const chipStyle = { background: theme.spatial.surface, color: theme.node.text };
    const actionStyle = { background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text };

    if (hasImage) {
        return (
            <>
                <span className="group/chip relative inline-flex h-12 shrink-0 items-center overflow-visible rounded-md" style={chipStyle}>
                    <button
                        type="button"
                        className="grid size-12 shrink-0 overflow-hidden rounded-l-md border-0 p-0"
                        style={{ background: theme.toolbar.itemHover }}
                        title="点击放大预览"
                        aria-label={`预览 ${label || item.title}`}
                        disabled={!imageUrl}
                        onClick={() => imageUrl && setPreviewOpen(true)}
                        onDoubleClick={() => imageUrl && setPreviewOpen(true)}
                    >
                        {imageUrl ? (
                            <img src={imageUrl} alt="" className="size-full object-cover" />
                        ) : (
                            <span className="text-[var(--fs-micro)] opacity-50">…</span>
                        )}
                    </button>
                    {label && onInsertMention ? (
                        <button
                            type="button"
                            className="inline-flex h-12 max-w-[112px] min-w-0 items-center gap-1 border-0 bg-transparent px-2.5 text-[var(--fs-tiny)] opacity-80 hover:opacity-100"
                            title={`插入 @${label}`}
                            onClick={() => onInsertMention(label)}
                        >
                            <AtSign className="size-2.5 shrink-0" />
                            <span className="truncate">{label}</span>
                        </button>
                    ) : label ? (
                        <span className="inline-flex h-12 max-w-[112px] min-w-0 items-center gap-1 px-2.5 text-[var(--fs-tiny)] opacity-80">
                            <AtSign className="size-2.5 shrink-0" />
                            <span className="truncate">{label}</span>
                        </span>
                    ) : null}
                    {onRemove ? (
                        <button
                            type="button"
                            className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full border opacity-0 shadow-sm transition group-hover/chip:opacity-100 group-focus-within/chip:opacity-100"
                            style={actionStyle}
                            onClick={onRemove}
                            aria-label="移除引用"
                        >
                            <X className="size-3" />
                        </button>
                    ) : null}
                </span>
                {previewOpen && imageUrl ? <AgentImagePreview attachment={{ id: item.id, url: imageUrl, name: item.title || label || "图片" }} onClose={() => setPreviewOpen(false)} /> : null}
            </>
        );
    }

    return (
        <span className="group/chip relative inline-flex h-12 max-w-[168px] shrink-0 items-center gap-2 overflow-hidden rounded-md px-2.5 text-sm" style={chipStyle}>
            <span className="grid size-8 shrink-0 place-items-center rounded-md text-sm font-medium" style={{ background: theme.toolbar.itemHover }}>
                {text}
            </span>
            <span className="min-w-0 truncate text-[var(--fs-tiny)] opacity-80">{item.title}</span>
            {onRemove ? (
                <button
                    type="button"
                    className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full border opacity-0 shadow-sm transition group-hover/chip:opacity-100"
                    style={actionStyle}
                    onClick={onRemove}
                    aria-label="移除引用"
                >
                    <X className="size-3" />
                </button>
            ) : null}
        </span>
    );
}

export function assistantReferencesToMentionReferences(references: CanvasAssistantReference[]): CanvasResourceReference[] {
    return references.flatMap((item, index): CanvasResourceReference[] => {
        if (item.dataUrl || item.storageKey) {
            const label = assistantImageReferenceLabel(references, index) || item.title;
            return [{ id: item.id, nodeId: item.id, kind: "image", label, title: item.title, previewUrl: item.dataUrl, storageKey: item.storageKey, active: true }];
        }
        if (item.text) {
            const label = item.type === CanvasNodeType.Skill ? `技能${index + 1}` : `文本${index + 1}`;
            return [{ id: item.id, nodeId: item.id, kind: item.type === CanvasNodeType.Skill ? "skill" : "text", label, title: item.title, text: item.text, active: true }];
        }
        return [];
    });
}

export function assistantImageReferenceLabel(references: CanvasAssistantReference[], index: number) {
    if (!references[index]?.dataUrl && !references[index]?.storageKey) return undefined;
    const imageIndex = references.slice(0, index + 1).filter((item) => item.dataUrl || item.storageKey).length - 1;
    return imageIndex >= 0 ? imageReferenceLabel(imageIndex) : undefined;
}

export function assistantMessageToChatMessage(message: CanvasAssistantMessage): CanvasAgentChatMessage {
    return { id: message.id, role: message.role, title: message.title, text: message.text, meta: message.meta, detail: message.detail };
}

export function formatSessionTime(value?: string) {
    return value ? new Date(value).toLocaleString() : "";
}

export function sessionPreview(session: CanvasAssistantSession) {
    return session.messages.at(-1)?.text || `${session.messages.length} 条消息`;
}
