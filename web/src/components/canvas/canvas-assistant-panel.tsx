import { canvasThemes } from "@/lib/canvas-theme";
import { Button, Modal } from "antd";
import { Tooltip } from "@/components/ui/base/tooltip";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

import { motion } from "motion/react";

import { resolveModelRequestConfig, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { nanoid } from "nanoid";
import { type ResponseInputMessage, type ResponseToolCall } from "@/services/api/image";
import { runBackendToolGenerationTask } from "@/services/api/generation-task";
import { inspectAgentImage } from "@/services/agent-image-preview";
import { listAgentCapabilities, readAgentPluginDocumentation, readAgentPluginNode } from "@/services/agent-capabilities";
import { readAgentStoryboard } from "@/lib/canvas/canvas-agent-storyboard";
import { canvasStylePresets, userStylePreset, type CanvasStylePreset } from "./canvas-style-picker-modal";
import { listStyleProfiles } from "@/services/api/style-profiles";
import { getActiveUserScope } from "@/lib/user-scope";
import { isPluginEffectivelyEnabled } from "@/stores/use-plugin-store";
import { consumeGenerationTaskAgent } from "@/services/project-asset-sync";
import { applyGenerationConsumerEffect, generationEffectApplied } from "@/services/generation-consumer-dedupe";
import { activeGenerationConsumerController } from "@/services/generation-consumer-lifecycle";
import { useAssetStore } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { navigateToSettings } from "@/lib/settings-navigation";
import { cinematicAgentSessionOpsJson, createCinematicAgentSession, isAgentSessionPollingAbort, resumeCinematicAgentSession } from "@/lib/canvas/canvas-agent-session";
import { summarizeCanvasContext } from "@/lib/canvas/canvas-context-summary";
import { AgentChatComposer, AgentChatMessage, AgentWorkingMessage, type CanvasAgentMode } from "./canvas-agent-chat-ui";
import { VoiceRecordingButton } from "@/components/conversation/voice-recording-button";
import { AgentChatEmptyState, AgentPanelChrome } from "./canvas-agent-panel-chrome";
import { useResolvedCanvasResourceReferences } from "./use-resolved-canvas-resource-references";
import { type CanvasAssistantMessage, type CanvasAssistantPendingBackendSession, type CanvasAssistantReference, type CanvasAssistantSession, type CanvasNodeData } from "@/types/canvas";
import { useCanvasAgentStore } from "@/stores/canvas/use-canvas-agent-store";
import { canvasAgentPostconditionMessage, summarizeCanvasAgentOps, verifyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { buildCanvasAgentContext, findCanvasAgentNodes, getCanvasAgentConnection, getCanvasAgentGenerationTasks, getCanvasAgentNode, getCanvasAgentResources, validateCanvasAgentOps } from "@/lib/canvas/canvas-agent-context";
import { resolveStoryboardGenerationContext } from "@/lib/canvas/canvas-storyboard-context";
import { isWritableToolCall } from "@/lib/canvas/canvas-agent-protocol";
import { listAddedSkills, type Skill } from "@/services/api/skills";
import { buildSkillMentionReferences, skillRuntime } from "@/services/skill-runtime";
import { handleCinematicContinuationFailure, canvasCinematicContinuationEntryAdapters, type CinematicContinuationFailureDisposition, type CinematicContinuationLiveSessionState } from "./canvas-cinematic-continuation";
import { CanvasCreativeInteraction, canvasCreativeDetail, creativeInteractionSeed, creativeProposalFailure, type CanvasCreativeDetail } from "./canvas-creative-interaction";
import { creativePlan, type CreativeReference } from "@/lib/creation/creative-agent-state";
import { CreativePlanBar } from "@/components/creation/creative-agent-cards";
import { AgentTextModelPicker, AssistantHistory, AssistantReferenceChip, MessageReferences, assistantImageReferenceLabel, assistantMessageToChatMessage, assistantReferencesToMentionReferences, promptAlreadyHasMention } from "./canvas-assistant-panel-views";
import { backendAgentProviderConfig, buildAssistantReferences, buildToolAgentMessages, capabilityBatchTitle, cinematicSessionMessageId, compactSnapshot, createSession, describeCanvasSnapshot, explainNoop, nodeToReference, objectDetail, onlineToolToOps, parseToolArguments, previewOnlineToolCalls, requestOnlineAgentModel, requireOps, requireString, snapshotSignature, summarizeToolCalls, toolCallToResponseInput, toolCallsFromDetail, toolResultText, upsertAssistantMessage, type CreativeOnlineContext, type OnlineToolResult } from "./canvas-assistant-online-tools";
import { CREATIVE_AGENT_TOOLS } from "@/lib/creation/creative-agent-tools";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { recoverCreativeResponse } from "@/services/creative-agent-recovery";

export const CANVAS_AGENT_PANEL_MOTION_MS = 500;
const PANEL_MOTION_SECONDS = CANVAS_AGENT_PANEL_MOTION_MS / 1000;
const ONLINE_AGENT_MAX_STEPS = 8;

type OnlineAgentTab = "chat" | "history";
type OnlineLoopContext = { step: number };
type OnlineExecutedToolCall = { toolCallId: string; name: string; result: OnlineToolResult };
type PendingOnlineToolContext = { messages: ResponseInputMessage[]; toolCalls: ResponseToolCall[]; assistantId: string; step: number };
type CanvasAssistantPanelProps = {
    nodes: CanvasNodeData[];
    selectedNodeIds: Set<string>;
    snapshot: CanvasAgentSnapshot;
    projectId: string;
    sessions: CanvasAssistantSession[];
    activeSessionId: string | null;
    onSelectNodeIds: (ids: Set<string>) => void;
    onSessionsChange: (sessions: CanvasAssistantSession[], activeSessionId: string | null) => void;
    onApplyOps: (ops?: CanvasAgentOp[], context?: { conversationId?: string; messageId?: string; source?: "online" | "local" }) => Promise<CanvasAgentSnapshot>;
    onApplyStyle: (preset: CanvasStylePreset) => Promise<void>;
    onStartArtCritique: (nodeId: string, restart: boolean) => void;
    onGenerateStoryboard: (nodeId: string, prompt: string, signal?: AbortSignal) => Promise<boolean | undefined>;
    canUndoOps: boolean;
    undoOpsCount: number;
    onUndoOps: () => CanvasAgentSnapshot | null;
    onPasteImage: (file: File) => void;
    agentMode: CanvasAgentMode;
    closing: boolean;
    onCollapse: () => void;
    cinematicEntry?: boolean;
    onCinematicEntryConsumed?: () => void;
    resizing?: boolean;
};

function buildCreativeOnlineContext(history: CanvasAssistantMessage[], snapshot: CanvasAgentSnapshot, config: AiConfig): CreativeOnlineContext {
    const seed = creativeInteractionSeed(history);
    const previous = history.findLast((message) => canvasCreativeDetail(message));
    const previousState = previous ? canvasCreativeDetail(previous)!.state : undefined;
    const previousDetail = previous ? canvasCreativeDetail(previous)! : undefined;
    const validationError = previousDetail ? creativeProposalFailure(previousDetail, config) : undefined;
    const rejectedProposal = validationError
        ? {
              error: validationError,
              input: previousDetail!.input,
              instruction: "此方案校验失败，未获得用户批准，未创建节点或生成媒体。修正错误并重新用 creative_respond 返回完整方案；不得省略 generationItems 来规避校验。",
          }
        : undefined;
    const proposalMessage = history.findLast((message) => Boolean(canvasCreativeDetail(message)?.state.proposal));
    const proposalDetail = proposalMessage ? canvasCreativeDetail(proposalMessage)! : undefined;
    const proposal = proposalDetail?.state.proposal;
    const previousProposal =
        proposal && proposalDetail?.state.canvasApplied
            ? {
                  contextSummary: true,
                  instruction: "已落地方案的结构摘要，未包含原方案正文和生成提示词。需要修改具体内容时先读取对应画布节点，不得用摘要覆盖正文。",
                  id: proposal.id,
                  version: proposal.version,
                  title: proposal.title,
                  summary: proposal.summary,
                  deliverables: proposal.deliverables,
                  generationItems: proposal.generationItems,
                  nodes: proposal.workflow.nodes.map((node) => ({ ref: node.ref, kind: node.kind, title: node.title, referenceRefs: node.referenceRefs, referenceNodeIds: node.referenceNodeIds })),
                  edges: proposal.workflow.edges,
              }
            : proposal;
    const executionByRun = new Map(
        history.flatMap((message) => {
            const detail = canvasCreativeDetail(message);
            return detail && (detail.state.canvasApplied || detail.state.media.some((item) => item.taskId || item.error))
                ? [
                      [
                          detail.runId || message.id,
                          {
                              runId: detail.runId,
                              status: detail.status,
                              proposal: detail.state.proposal?.title,
                              canvasApplied: detail.state.canvasApplied,
                              approvedProposalVersion: detail.approvedProposalVersion,
                              media: detail.state.media.map((item) => ({ ref: item.ref, nodeId: item.nodeId, taskId: item.taskId, status: item.status, error: item.error })),
                          },
                      ] as const,
                  ]
                : [];
        }),
    );
    return {
        scene: seed.scene,
        brief: seed.brief,
        plan: seed.dynamicPlan,
        previousProposal,
        rejectedProposal,
        previousQuestions: previousState?.questions,
        answers: previousState?.answers,
        executionResults: [...executionByRun.values()],
        media: previousState?.media,
        references: creativeCanvasReferences(snapshot),
        sourceContext: history.flatMap((message) => {
            const detail = objectDetail(message.detail);
            return detail.kind === "creation-handoff" ? [{ messageId: message.id, ...detail }] : [];
        }),
    };
}

function creativeCanvasReferences(snapshot: CanvasAgentSnapshot): CreativeReference[] {
    return snapshot.nodes.flatMap((node): CreativeReference[] =>
        node.type === "image" && node.metadata?.storageKey && resourceIdFromStorageKey(node.metadata.storageKey)
            ? [
                  {
                      id: node.id,
                      title: node.title || "画布图片",
                      kind: "image",
                      storageKey: node.metadata.storageKey,
                      assetId: node.metadata.assetId,
                      mimeType: node.metadata.mimeType,
                      width: node.metadata.naturalWidth,
                      height: node.metadata.naturalHeight,
                  },
              ]
            : [],
    );
}

export { handleCinematicContinuationFailure, runCanvasCinematicContinuationBoundary, canvasCinematicContinuationEntryAdapters } from "./canvas-cinematic-continuation";
export type { CinematicContinuationFailureDisposition } from "./canvas-cinematic-continuation";
export function CanvasAssistantPanel({
    nodes,
    selectedNodeIds,
    snapshot,
    projectId,
    sessions,
    activeSessionId,
    onSelectNodeIds,
    onSessionsChange,
    onApplyOps,
    onApplyStyle,
    onStartArtCritique,
    onGenerateStoryboard,
    canUndoOps,
    undoOpsCount,
    onUndoOps,
    onPasteImage,
    agentMode,
    closing,
    onCollapse,
    cinematicEntry = false,
    onCinematicEntryConsumed,
    resizing = false,
}: CanvasAssistantPanelProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const user = useUserStore((state) => state.user);
    const effectiveConfig = useEffectiveConfig();
    const cleanupImages = useAssetStore((state) => state.cleanupImages);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const confirmTools = useCanvasAgentStore((state) => state.confirmTools);
    const setAgentState = useCanvasAgentStore((state) => state.setAgentState);
    const [view, setView] = useState<OnlineAgentTab>("chat");
    const [prompt, setPrompt] = useState("");
    const [isRunning, setIsRunning] = useState(false);
    const [creativeBusy, setCreativeBusy] = useState<Record<string, boolean>>({});
    const [deleteChatIds, setDeleteChatIds] = useState<string[]>([]);
    const [composerSkills, setComposerSkills] = useState<Skill[]>([]);
    const [attachedReferenceIds, setAttachedReferenceIds] = useState<Set<string>>(() => new Set());
    const [localSessions, setLocalSessionsState] = useState<CanvasAssistantSession[]>(() => (sessions.length ? sessions : [createSession()]));
    const localSessionsRef = useRef(localSessions);
    const [localActiveSessionId, setLocalActiveSessionIdState] = useState<string | null>(activeSessionId);
    const localActiveSessionIdRef = useRef(localActiveSessionId);
    const setLocalActiveSessionId = (activeId: string | null) => {
        localActiveSessionIdRef.current = activeId;
        setLocalActiveSessionIdState(activeId);
    };
    const setLocalSessions = (value: CanvasAssistantSession[] | ((previous: CanvasAssistantSession[]) => CanvasAssistantSession[])) => {
        const next = typeof value === "function" ? value(localSessionsRef.current) : value;
        localSessionsRef.current = next;
        setLocalSessionsState(next);
        onSessionsChange(next, localActiveSessionIdRef.current);
    };
    const chatListRef = useRef<HTMLDivElement>(null);
    const composerRef = useRef<HTMLDivElement>(null);
    const snapshotRef = useRef(snapshot);
    const pendingToolContextRef = useRef(new Map<string, PendingOnlineToolContext>());
    const inspectedImagesRef = useRef(new Map<string, { title: string; url: string; encodedBytes: number }>());
    const cinematicSessionControllersRef = useRef(new Map<string, AbortController>());
    const generationConsumerControllerRef = useRef(new AbortController());

    useEffect(() => {
        let cancelled = false;
        listAddedSkills()
            .then((result) => {
                if (!cancelled) setComposerSkills(result.skills || []);
            })
            .catch(() => {
                if (!cancelled) setComposerSkills([]);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!sessions.length) {
            onSessionsChange(localSessionsRef.current, localActiveSessionIdRef.current);
            return;
        }
        localSessionsRef.current = sessions;
        setLocalSessionsState(sessions);
        localActiveSessionIdRef.current = activeSessionId;
        setLocalActiveSessionIdState(activeSessionId);
    }, [activeSessionId, sessions, onSessionsChange]);

    useEffect(() => {
        snapshotRef.current = snapshot;
    }, [snapshot]);

    useEffect(() => {
        generationConsumerControllerRef.current = activeGenerationConsumerController(generationConsumerControllerRef.current);
        return () => {
            // 收起面板或刷新页面时只停止前端查询，后台任务由下次挂载根据持久化 ID 继续接管。
            cinematicSessionControllersRef.current.forEach((controller) => controller.abort());
            cinematicSessionControllersRef.current.clear();
            generationConsumerControllerRef.current.abort();
            inspectedImagesRef.current.clear();
        };
    }, []);

    const safeSessions = localSessions.length ? localSessions : [createSession()];
    const activeSession = useMemo(() => safeSessions.find((session) => session.id === localActiveSessionId) || safeSessions[0] || null, [localActiveSessionId, safeSessions]);
    const historySessions = safeSessions.filter((session) => session.messages.length > 0);
    const messages = activeSession?.messages || [];
    const hasMessages = messages.length > 0;
    const agentBusy = isRunning || Object.values(creativeBusy).some(Boolean) || safeSessions.some((session) => session.pendingBackendSession?.status === "pending");
    const activeCreativeId = messages.findLast((message) => Boolean(canvasCreativeDetail(message)))?.id;
    const latestAssistantMessage = messages.findLast((message) => message.role === "assistant");
    const currentCreativeState = activeCreativeId ? canvasCreativeDetail(messages.find((message) => message.id === activeCreativeId)!)?.state : latestAssistantMessage ? canvasCreativeDetail(latestAssistantMessage)?.state : undefined;
    const selectedReferences = useMemo(() => buildAssistantReferences(nodes, attachedReferenceIds), [attachedReferenceIds, nodes]);
    const composerImageReferences = useMemo(() => assistantReferencesToMentionReferences(selectedReferences), [selectedReferences]);
    const resolvedComposerImageReferences = useResolvedCanvasResourceReferences(composerImageReferences);
    const composerReferences = useMemo(() => [...buildSkillMentionReferences(composerSkills), ...resolvedComposerImageReferences], [composerSkills, resolvedComposerImageReferences]);
    const resolvedPreviewById = useMemo(() => new Map(resolvedComposerImageReferences.map((item) => [item.id, item.previewUrl || ""])), [resolvedComposerImageReferences]);
    const contextSummary = useMemo(() => summarizeCanvasContext(nodes, selectedNodeIds), [nodes, selectedNodeIds]);
    const iconButtonStyle = { color: theme.node.muted };

    useEffect(() => {
        if (agentMode !== "online" || view !== "chat") return;
        const frame = requestAnimationFrame(() => chatListRef.current?.scrollTo({ top: chatListRef.current.scrollHeight }));
        return () => cancelAnimationFrame(frame);
    }, [agentBusy, agentMode, localActiveSessionId, messages, view]);

    useEffect(() => {
        setAttachedReferenceIds((current) => {
            const nodeById = new Map(nodes.map((node) => [node.id, node]));
            const next = new Set(current);
            let changed = false;
            selectedNodeIds.forEach((id) => {
                const node = nodeById.get(id);
                if (!node || !nodeToReference(node) || next.has(id)) return;
                next.add(id);
                changed = true;
            });
            return changed ? next : current;
        });
    }, [nodes, selectedNodeIds]);

    useEffect(() => {
        setAttachedReferenceIds((current) => {
            const nodeIds = new Set(nodes.map((node) => node.id));
            const next = new Set(Array.from(current).filter((id) => nodeIds.has(id)));
            return next.size === current.size ? current : next;
        });
    }, [nodes]);

    const updateSession = (sessionId: string, updater: (session: CanvasAssistantSession) => CanvasAssistantSession) => {
        const next = localSessionsRef.current.map((session) => (session.id === sessionId ? updater(session) : session));
        localSessionsRef.current = next;
        setLocalSessions(next);
        return next;
    };

    const readCinematicSessionState = (): CinematicContinuationLiveSessionState => ({ sessions: localSessionsRef.current, activeChatId: localActiveSessionIdRef.current });

    const restoreCinematicSessions = (sessions: CanvasAssistantSession[], activeId: string | null) => {
        localSessionsRef.current = sessions;
        setLocalSessions(sessions);
        setLocalActiveSessionId(activeId);
    };
    const restoreCinematicSnapshot = (state: Pick<CanvasAgentSnapshot, "nodes" | "connections">) => {
        snapshotRef.current = { ...snapshotRef.current, nodes: state.nodes, connections: state.connections };
    };

    const hasAgentGenerationEffect = (sessionId: string, effectKey?: string) => {
        const session = localSessionsRef.current.find((candidate) => candidate.id === sessionId);
        return Boolean(session && generationEffectApplied(session, effectKey));
    };

    const appendMessage = (sessionId: string, message: CanvasAssistantMessage) => {
        updateSession(sessionId, (session) => ({
            ...session,
            title: session.messages.length ? session.title : message.text.slice(0, 18) || "新对话",
            messages: [...session.messages, message],
            updatedAt: new Date().toISOString(),
        }));
    };

    const upsertMessage = (sessionId: string, message: CanvasAssistantMessage) => {
        updateSession(sessionId, (session) => {
            const exists = session.messages.some((item) => item.id === message.id);
            return {
                ...session,
                title: session.messages.length ? session.title : message.text.slice(0, 18) || "新对话",
                messages: exists ? session.messages.map((item) => (item.id === message.id ? { ...item, ...message } : item)) : [...session.messages, message],
                updatedAt: new Date().toISOString(),
            };
        });
    };

    const setPendingCinematicSession = (sessionId: string, backendSessionId: string) => {
        const startedAt = new Date().toISOString();
        const pending: CanvasAssistantPendingBackendSession = {
            id: backendSessionId,
            kind: "cinematic",
            messageId: cinematicSessionMessageId(backendSessionId),
            status: "pending",
            startedAt,
        };
        updateSession(sessionId, (session) => ({
            ...session,
            pendingBackendSession: pending,
            messages: upsertAssistantMessage(session.messages, {
                id: pending.messageId,
                role: "assistant",
                title: "影视项目生成中",
                text: "后端影视 Agent 正在处理。即使页面刷新，也会在重新进入画布后继续等待结果。",
                detail: { kind: "cinematic", backendSessionId, status: "pending", startedAt },
            }),
            updatedAt: startedAt,
        }));
    };

    const completeCinematicSession = (sessionId: string, backendSessionId: string, ops: CanvasAgentOp[], recovered = false, effectKey?: string) => {
        return updateSession(sessionId, (session) => {
            const pending = session.pendingBackendSession;
            if (pending?.id !== backendSessionId) return session;
            const completedAt = new Date().toISOString();
            const summary = summarizeCanvasAgentOps(ops) || "影视项目已写回当前画布。";
            const completed = {
                ...session,
                pendingBackendSession: undefined,
                messages: upsertAssistantMessage(session.messages, {
                    id: pending.messageId,
                    role: "assistant",
                    title: recovered ? "影视项目已恢复并写回" : "影视项目已写回",
                    text: recovered ? `页面重新连接后已恢复后台结果：${summary}` : summary,
                    detail: { kind: "cinematic", backendSessionId, status: "completed", recovered, completedAt },
                }),
                updatedAt: completedAt,
            };
            return effectKey ? applyGenerationConsumerEffect(completed, effectKey, (current) => current).value : completed;
        });
    };

    const failCinematicSession = (sessionId: string, backendSessionId: string, error: unknown) => {
        updateSession(sessionId, (session) => {
            const pending = session.pendingBackendSession;
            if (pending?.id !== backendSessionId) return session;
            const failedAt = new Date().toISOString();
            const text = error instanceof Error ? error.message : "影视项目生成失败";
            return {
                ...session,
                pendingBackendSession: undefined,
                messages: upsertAssistantMessage(session.messages, {
                    id: pending.messageId,
                    role: "error",
                    title: "影视项目生成失败",
                    text,
                    detail: { kind: "cinematic", backendSessionId, status: "failed", failedAt },
                }),
                updatedAt: failedAt,
            };
        });
    };

    const runCinematicSession = async (sessionId: string, text: string, current: CanvasAgentSnapshot, config: AiConfig, onCreated?: (backendSessionId: string) => void) => {
        const requestConfig = resolveModelRequestConfig(config, config.textModel || config.model);
        const storyboardContext = resolveStoryboardGenerationContext(current.nodes);
        const controller = new AbortController();
        const requestKey = `creating:${nanoid()}`;
        let backendSessionId = "";
        cinematicSessionControllersRef.current.set(requestKey, controller);
        try {
            const detail = await createCinematicAgentSession(
                {
                    projectId,
                    prompt: text,
                    canvasSnapshot: compactSnapshot(current) as unknown as Record<string, unknown>,
                    projectStyle: storyboardContext.projectStyle,
                    characters: storyboardContext.characters,
                    config: backendAgentProviderConfig(requestConfig),
                },
                {
                    signal: controller.signal,
                    onCreated: (created) => {
                        backendSessionId = created.session.id;
                        cinematicSessionControllersRef.current.delete(requestKey);
                        cinematicSessionControllersRef.current.set(backendSessionId, controller);
                        setPendingCinematicSession(sessionId, backendSessionId);
                        onCreated?.(backendSessionId);
                    },
                },
            );
            return {
                backendSessionId: detail.session.id,
                ops: requireOps(JSON.parse(cinematicAgentSessionOpsJson(detail))),
                continuationTask: [...detail.tasks].reverse().find((task) => task.status === "succeeded"),
            };
        } catch (error) {
            if (backendSessionId && !isAgentSessionPollingAbort(error)) failCinematicSession(sessionId, backendSessionId, error);
            throw error;
        } finally {
            cinematicSessionControllersRef.current.delete(requestKey);
            if (backendSessionId) cinematicSessionControllersRef.current.delete(backendSessionId);
        }
    };

    const startChatSession = () => {
        if (activeSession && activeSession.messages.length === 0) {
            setLocalActiveSessionId(activeSession.id);
            return;
        }
        const session = createSession();
        setLocalSessions((prev) => [session, ...prev]);
        setLocalActiveSessionId(session.id);
    };

    const removeSessions = (ids: string[]) => {
        const next = safeSessions.filter((session) => !ids.includes(session.id));
        if (!next.length) {
            const session = createSession();
            setLocalSessions([session]);
            setLocalActiveSessionId(session.id);
        } else {
            setLocalSessions(next);
            setLocalActiveSessionId(localActiveSessionId && ids.includes(localActiveSessionId) ? next[0].id : localActiveSessionId);
        }
        void cleanupImages({ sessions: next });
    };

    const clearSessions = () => {
        const session = createSession();
        setLocalSessions([session]);
        setLocalActiveSessionId(session.id);
        void cleanupImages({ sessions: [session] });
    };

    const sendMessage = async (text: string, history: CanvasAssistantMessage[], savedReferences?: CanvasAssistantReference[]) => {
        const requestConfig = { ...effectiveConfig, model: effectiveConfig.textModel || effectiveConfig.model };
        if (!isAiConfigReady(requestConfig, requestConfig.model)) {
            navigateToSettings({ continueCreation: true });
            return;
        }

        const session = activeSession || createSession();
        if (!activeSession) {
            setLocalSessions([session]);
            setLocalActiveSessionId(session.id);
        }

        const refs = savedReferences || selectedReferences;
        const userMessage: CanvasAssistantMessage = { id: nanoid(), role: "user", text, references: refs };
        const assistantId = nanoid();
        appendMessage(session.id, userMessage);
        setPrompt("");
        setIsRunning(true);
        void runOnlineAgentStep(session.id, assistantId, history, userMessage, { step: 1 });
    };

    const runOnlineAgentStep = async (sessionId: string, assistantId: string, history: CanvasAssistantMessage[], userMessage: CanvasAssistantMessage, loop: OnlineLoopContext) => {
        const requestConfig = { ...effectiveConfig, model: effectiveConfig.textModel || effectiveConfig.model };
        try {
            setIsRunning(true);
            const messages = await buildToolAgentMessages(snapshotRef.current, history, userMessage, composerSkills, {
                config: effectiveConfig,
                confirmTools,
                creative: buildCreativeOnlineContext(history, snapshotRef.current, effectiveConfig),
            });
            let streamed = "";
            const initial = await requestOnlineAgentModel({ ...requestConfig, systemPrompt: "" }, messages, "required", userMessage.text, (text) => {
                streamed = text;
                if (text.trim()) upsertMessage(sessionId, { id: assistantId, role: "assistant", text });
            });
            const result = await repairCreativeReply(initial, messages, userMessage.text, history);
            if (presentCreativeResponse(sessionId, assistantId, result)) return;
            if (result.toolCalls.length) {
                const writableCalls = result.toolCalls.filter(isWritableToolCall);
                if (confirmTools && writableCalls.length) {
                    upsertMessage(sessionId, { id: assistantId, role: "assistant", text: result.content || streamed || "准备执行工具，等待确认。" });
                    const toolMessageId = nanoid();
                    pendingToolContextRef.current.set(toolMessageId, { messages, toolCalls: result.toolCalls, assistantId, step: loop.step });
                    const toolMessage: CanvasAssistantMessage = {
                        id: toolMessageId,
                        role: "tool",
                        title: `确认${capabilityBatchTitle(result.toolCalls)}`,
                        text: summarizeToolCalls(result.toolCalls),
                        detail: { status: "pending", step: loop.step, toolCalls: result.toolCalls, impact: previewOnlineToolCalls(result.toolCalls, snapshotRef.current, effectiveConfig) },
                    };
                    appendMessage(sessionId, toolMessage);
                    return;
                }
                await continueOnlineToolLoop(sessionId, assistantId, messages, result, loop.step);
            } else {
                if (!result.content.trim()) throw new Error("模型没有返回工具调用，画布操作未执行。");
                upsertMessage(sessionId, { id: assistantId, role: "assistant", text: result.content || streamed || "没有返回内容。" });
            }
        } catch (error) {
            if (isAgentSessionPollingAbort(error)) return;
            appendMessage(sessionId, { id: nanoid(), role: "error", title: "操作失败", text: error instanceof Error ? error.message : "操作失败" });
        } finally {
            setIsRunning(false);
        }
    };

    const presentCreativeResponse = (sessionId: string, assistantId: string, result: { content: string; toolCalls: ResponseToolCall[] }) => {
        const call = result.toolCalls.find((item) => item.function.name === "creative_respond");
        if (!call) return false;
        const input = parseToolArguments(call.function.arguments);
        const history = localSessionsRef.current.find((session) => session.id === sessionId)?.messages || [];
        const state = creativeInteractionSeed(history.filter((message) => message.id !== assistantId));
        state.references = creativeCanvasReferences(snapshotRef.current);
        const detail: CanvasCreativeDetail = { kind: "creative-interaction", input, state };
        upsertMessage(sessionId, {
            id: assistantId,
            role: "assistant",
            text: typeof input.message === "string" ? input.message : result.content || "已整理当前需求。",
            detail,
        });
        return true;
    };

    const repairCreativeReply = async (reply: { content: string; toolCalls: ResponseToolCall[] }, protocol: ResponseInputMessage[], latestInput: string, history: CanvasAssistantMessage[]) => {
        const state = creativeInteractionSeed(history);
        state.references = creativeCanvasReferences(snapshotRef.current);
        const config = { ...effectiveConfig, model: effectiveConfig.textModel || effectiveConfig.model, systemPrompt: "" };
        return recoverCreativeResponse(
            reply,
            protocol,
            { config, state, latestInput },
            (messages) =>
                runBackendToolGenerationTask({
                    prompt: "根据程序校验反馈修正创作交互",
                    config,
                    messages,
                    tools: CREATIVE_AGENT_TOOLS,
                    toolChoice: "required",
                    signal: generationConsumerControllerRef.current.signal,
                }),
            () => undefined,
        );
    };

    const continueOnlineToolLoop = async (sessionId: string, assistantId: string, messages: ResponseInputMessage[], result: { content: string; toolCalls: ResponseToolCall[] }, step: number) => {
        const toolResults = await executeOnlineToolCalls(sessionId, result.toolCalls);
        appendMessage(sessionId, {
            id: nanoid(),
            role: "tool",
            title: "工具自动执行完成",
            text: toolResults.map((item) => toolResultText(item.result)).join("\n"),
            detail: { status: "completed", step, toolCalls: result.toolCalls, results: toolResults },
        });
        await continueOnlineToolLoopAfterResults(sessionId, assistantId, messages, result.toolCalls, toolResults, step);
    };

    const continueOnlineToolLoopAfterResults = async (sessionId: string, assistantId: string, messages: ResponseInputMessage[], toolCalls: ResponseToolCall[], toolResults: OnlineExecutedToolCall[], step: number) => {
        const waiting = toolResults.find((item) => item.result.ok && item.result.waitForUser);
        if (waiting) {
            upsertMessage(sessionId, { id: assistantId, role: "assistant", text: waiting.result.message });
            return;
        }
        const nextMessages: ResponseInputMessage[] = [...messages, ...toolCalls.map(toolCallToResponseInput), ...toolResults.map((item) => ({ role: "tool" as const, tool_call_id: item.toolCallId, content: JSON.stringify(item.result) }))];
        if (step >= ONLINE_AGENT_MAX_STEPS) {
            upsertMessage(sessionId, { id: assistantId, role: "assistant", text: toolResults.map((item) => toolResultText(item.result)).join("\n") || "工具已执行。" });
            return;
        }
        const requestConfig = { ...effectiveConfig, model: effectiveConfig.textModel || effectiveConfig.model };
        let streamed = "";
        const next = await requestOnlineAgentModel({ ...requestConfig, systemPrompt: "" }, nextMessages, "auto", "继续处理画布工具结果", (text) => {
            streamed = text;
            if (text.trim()) upsertMessage(sessionId, { id: assistantId, role: "assistant", text });
        });
        const history = localSessionsRef.current.find((session) => session.id === sessionId)?.messages || [];
        const repaired = await repairCreativeReply(next, nextMessages, history.findLast((message) => message.role === "user")?.text || "", history);
        if (presentCreativeResponse(sessionId, assistantId, repaired)) return;
        if (repaired.toolCalls.length) {
            const writableCalls = repaired.toolCalls.filter(isWritableToolCall);
            if (confirmTools && writableCalls.length) {
                upsertMessage(sessionId, { id: assistantId, role: "assistant", text: repaired.content || streamed || "准备执行工具，等待确认。" });
                const toolMessageId = nanoid();
                pendingToolContextRef.current.set(toolMessageId, { messages: nextMessages, toolCalls: repaired.toolCalls, assistantId, step: step + 1 });
                appendMessage(sessionId, {
                    id: toolMessageId,
                    role: "tool",
                    title: `确认${capabilityBatchTitle(repaired.toolCalls)}`,
                    text: summarizeToolCalls(repaired.toolCalls),
                    detail: { status: "pending", step: step + 1, toolCalls: repaired.toolCalls, impact: previewOnlineToolCalls(repaired.toolCalls, snapshotRef.current, effectiveConfig) },
                });
                return;
            }
            await continueOnlineToolLoop(sessionId, assistantId, nextMessages, repaired, step + 1);
            return;
        }
        upsertMessage(sessionId, { id: assistantId, role: "assistant", text: repaired.content || streamed || toolResults.map((item) => toolResultText(item.result)).join("\n") || "工具已执行。" });
    };

    const executeOps = async (ops: CanvasAgentOp[], context?: { conversationId?: string; messageId?: string; source?: "online" | "local" }) => {
        const beforeSnapshot = snapshotRef.current;
        const validation = validateCanvasAgentOps(beforeSnapshot, ops);
        if (!validation.ok) {
            throw new Error(`画布操作校验失败：${validation.issues.filter((item) => item.severity === "error").map((item) => item.message).join("；")}`);
        }
        const before = snapshotSignature(beforeSnapshot);
        const next = await onApplyOps(ops, context);
        snapshotRef.current = next;
        const verification = verifyCanvasAgentOps(beforeSnapshot, next, ops);
        const noopReason = verification.changed ? "" : explainNoop(ops, beforeSnapshot);
        return { ...verification, verification, snapshot: next, ops, noopReason, before: JSON.parse(before), after: JSON.parse(snapshotSignature(next)) };
    };

    const executeOnlineTool = async (sessionId: string, name: string, args: Record<string, unknown>, messageId?: string): Promise<OnlineToolResult> => {
            const current = snapshotRef.current;
            try {
            const expectedRevision = typeof args.expectedRevision === "number" ? args.expectedRevision : undefined;
            if (expectedRevision !== undefined && expectedRevision !== (current.revision ?? 0)) return { ok: false, message: "画布 revision 已变化，请重新读取 canvas_get_context 后再执行写操作。" };
            const expectedStateHash = typeof args.expectedStateHash === "string" ? args.expectedStateHash : "";
            if (expectedStateHash && expectedStateHash !== buildCanvasAgentContext(current).stateHash) return { ok: false, message: "画布状态已变化，请重新读取 canvas_get_context 后再执行写操作。" };
            const currentSkills = skillRuntime.agentToolNames("onlineAgent").has(name) ? (await listAddedSkills()).skills : composerSkills;
            const skillToolResult = await skillRuntime.executeAgentTool("onlineAgent", name, args, currentSkills);
            if (skillToolResult) return skillToolResult;
            if (name === "canvas_generate_storyboard") {
                const { node, readiness } = readAgentStoryboard(current, requireString(args.nodeId, "nodeId"));
                if (!readiness.canGenerateStoryboard) throw new Error(readiness.blockingReason || "请先配置项目画风");
                const prompt = requireString(args.prompt ?? node.metadata?.composerContent, "剧本与拆镜要求");
                const completed = await onGenerateStoryboard(node.id, prompt, generationConsumerControllerRef.current.signal);
                if (!completed) return { ok: true, waitForUser: true, message: "分镜生成未完成或已取消，请查看节点提示；未完成不代表已生成，不要自动重复发起。", data: { nodeId: node.id, completed: false } };
                return { ok: true, message: "专业拆镜任务已完成并写入真实分镜表。请读取分镜表检查时长与镜头内容，再继续后续操作。", data: { nodeId: node.id, completed: true } };
            }
            if (name === "canvas_start_art_critique") {
                const nodeId = requireString(args.nodeId, "nodeId");
                const node = current.nodes.find((item) => item.id === nodeId && item.type === "ai-art-critique");
                if (!node || !isPluginEffectivelyEnabled("ai-art-critique")) throw new Error("审美插件未启用或节点不存在");
                const sources = current.nodes.filter((item) => item.type === "image" && current.connections.some((edge) => edge.fromNodeId === item.id && edge.toNodeId === nodeId));
                if (sources.length !== 1) throw new Error("审美分析需要明确连接一张图片，请先整理输入连线");
                const result = readAgentPluginNode(current, nodeId);
                if (args.retry !== true && result.data.status === "completed") return { ok: true, message: "已复用当前图片的审美报告。", data: result };
                onStartArtCritique(nodeId, args.retry === true);
                return { ok: true, waitForUser: true, message: "已打开审美分析，请在面板中核对并确认费用。分析完成后，可让我读取报告并继续处理。", data: { nodeId, status: "analysis_requested", paymentApproved: false } };
            }
            if (name === "canvas_read_plugin_node") return { ok: true, message: "已读取插件节点状态。", data: readAgentPluginNode(current, requireString(args.nodeId, "nodeId")) };
            if (name === "canvas_read_storyboard") {
                const { node, rows, readiness } = readAgentStoryboard(current, requireString(args.nodeId, "nodeId"));
                return { ok: true, message: "已读取分镜表及画风前置条件。", data: { nodeId: node.id, title: node.title, rows, readiness } };
            }
            if (name === "canvas_list_styles" || name === "canvas_apply_style") {
                const originScope = getActiveUserScope();
                const source = args.source || "system";
                if (source !== "system" && source !== "user") throw new Error("画风来源必须是 system 或 user");
                const presets = source === "system" ? canvasStylePresets.map((preset) => ({ id: preset.id, preset })) : (await listStyleProfiles()).profiles.flatMap((entity) => { const preset = userStylePreset(entity); return preset ? [{ id: entity.id, preset }] : []; });
                if (getActiveUserScope() !== originScope || snapshotRef.current.projectId !== current.projectId || generationConsumerControllerRef.current.signal.aborted) throw new Error("画布或账号已切换，请重新读取画风");
                if (name === "canvas_list_styles") {
                    const query = typeof args.query === "string" ? args.query.toLocaleLowerCase().trim() : "";
                    return { ok: true, message: "已读取画风目录。", data: presets.filter(({ preset }) => !query || `${preset.title} ${preset.description} ${preset.tags.join(" ")}`.toLocaleLowerCase().includes(query)).map(({ id, preset }) => ({ id, source, title: preset.title, description: preset.description, tags: preset.tags })) };
                }
                const selected = presets.find((item) => item.id === args.id);
                if (!selected) throw new Error("画风不存在或已移除，请先读取真实画风目录");
                await onApplyStyle(selected.preset);
                return { ok: true, message: `已应用画风“${selected.preset.title}”。`, data: { source, id: selected.id, presetId: selected.preset.id, prompt: selected.preset.prompt } };
            }
            if (name === "canvas_read_plugin") return { ok: true, message: "已读取插件用法。", data: readAgentPluginDocumentation(requireString(args.pluginId, "pluginId")) };
            if (name === "canvas_list_capabilities") return { ok: true, message: "已读取当前能力目录。", data: listAgentCapabilities(typeof args.query === "string" ? args.query : "") };
            if (name === "canvas_inspect_image") {
                const readSignal = generationConsumerControllerRef.current.signal;
                const node = current.nodes.find((item) => item.id === args.id && item.type === "image");
                if (!node || !messageId) throw new Error("未找到当前画布中的图片节点，请先检索真实节点 id。");
                const detail = args.detail;
                if (detail !== "preview" && detail !== "original" && detail !== "crop") throw new Error("请指定 preview、original 或 crop 看图方式。");
                const crop = args.crop as { x: number; y: number; width: number; height: number } | undefined;
                const image = await inspectAgentImage({ storageKey: node.metadata?.storageKey, dataUrl: node.metadata?.content }, detail, crop);
                if (readSignal.aborted) throw new DOMException("页面已关闭", "AbortError");
                if (snapshotRef.current.projectId !== current.projectId || !snapshotRef.current.nodes.some((item) => item.id === node.id && item.metadata?.storageKey === node.metadata?.storageKey && item.metadata?.content === node.metadata?.content)) throw new Error("画布素材已变化，请重新读取。");
                if ([...inspectedImagesRef.current.values()].reduce((sum, item) => sum + item.encodedBytes, image.encodedBytes) > 6 * 1024 * 1024) throw new Error("本轮看图预算已满，请先分析已读取图片，下一轮再读其他图片。");
                inspectedImagesRef.current.set(messageId, { title: `${node.title}（${detail}${crop ? ` ${JSON.stringify(crop)}` : ""}）`, url: image.storageKey, encodedBytes: image.encodedBytes });
                return { ok: true, message: `已读取图片《${node.title}》，将以${detail === "preview" ? "构图预览" : detail === "crop" ? "原始像素局部" : "原图"}提供给模型。`, data: { nodeId: node.id, detail, crop } };
            }
            if (name === "canvas_get_state") return { ok: true, message: describeCanvasSnapshot(current), data: compactSnapshot(current) };
            if (name === "canvas_get_context") return { ok: true, message: "已读取语义化画布上下文。", data: buildCanvasAgentContext(current) };
            if (name === "canvas_find_nodes") return { ok: true, message: "已按条件检索真实节点。", data: findCanvasAgentNodes(current, args as Parameters<typeof findCanvasAgentNodes>[1]) };
            if (name === "canvas_get_node") {
                const data = getCanvasAgentNode(current, { id: requireString(args.id, "id") });
                return { ok: true, message: data.found ? "已精确读取节点。" : "未找到指定节点。", data };
            }
            if (name === "canvas_get_connection") {
                const data = getCanvasAgentConnection(current, { id: requireString(args.id, "id") });
                return { ok: true, message: data.found ? "已精确读取连线。" : "未找到指定连线。", data };
            }
            if (name === "canvas_get_generation_tasks") return { ok: true, message: "已读取画布生成任务观察状态。", data: getCanvasAgentGenerationTasks(current, args as Parameters<typeof getCanvasAgentGenerationTasks>[1]) };
            if (name === "canvas_get_resources") return { ok: true, message: "已读取画布资源清单。", data: getCanvasAgentResources(current, args as Parameters<typeof getCanvasAgentResources>[1]) };
            if (name === "canvas_validate_ops") {
                const result = validateCanvasAgentOps(current, requireOps(args.ops));
                return { ok: result.ok, message: result.ok ? "操作校验通过。" : "操作校验失败。", data: result };
            }
            if (name === "canvas_export_snapshot") return { ok: true, message: describeCanvasSnapshot(current), data: compactSnapshot(current) };
            if (name === "canvas_get_selection") {
                const ids = new Set(current.selectedNodeIds || []);
                return { ok: true, message: `当前选中 ${ids.size} 个节点。`, data: { nodes: compactSnapshot({ ...current, nodes: current.nodes.filter((node) => ids.has(node.id)) }).nodes } };
            }
            if (name === "canvas_create_cinematic_session") {
                const cinematic = await runCinematicSession(sessionId, requireString(args.prompt, "prompt"), current, effectiveConfig);
                let continuationResult: OnlineToolResult | undefined;
                const applyContinuation = async ({ effectKey, signal }: { effectKey?: string; signal?: AbortSignal } = {}) => {
                    if (hasAgentGenerationEffect(sessionId, effectKey)) return;
                    const result = await canvasCinematicContinuationEntryAdapters["online-tool"]({
                        projectId,
                        effectKey,
                        signal,
                        readSnapshot: () => snapshotRef.current,
                        executeOps: () => executeOps(cinematic.ops),
                        completeSession: (key) => completeCinematicSession(sessionId, cinematic.backendSessionId, cinematic.ops, false, key),
                        readLiveSessionState: readCinematicSessionState,
                        restoreLiveSessions: restoreCinematicSessions,
                        restoreLiveSnapshot: restoreCinematicSnapshot,
                        failProvider: (failure) => failCinematicSession(sessionId, cinematic.backendSessionId, failure),
                    });
                    continuationResult = { ok: result.changed, message: result.changed ? summarizeCanvasAgentOps(cinematic.ops) || "后端影视 Agent 已写回画布。" : result.noopReason, data: result };
                };
                if (cinematic.continuationTask) {
                    await consumeGenerationTaskAgent(cinematic.continuationTask, cinematic.backendSessionId, applyContinuation, { signal: generationConsumerControllerRef.current.signal });
                } else {
                    await applyContinuation();
                }
                return continuationResult ?? { ok: true, message: "后端影视 Agent 已完成。" };
            }
            const ops = onlineToolToOps(name, args, current, effectiveConfig);
            const result = await executeOps(ops, { source: "online", conversationId: sessionId, messageId: messageId || sessionId });
            const { snapshot: _snapshot, before: _before, after: _after, ...cleanData } = result;
            return { ok: result.ok, message: result.changed ? canvasAgentPostconditionMessage(result) : result.noopReason, data: cleanData };
        } catch (error) {
            if (isAgentSessionPollingAbort(error)) throw error;
            return { ok: false, message: error instanceof Error ? error.message : "工具执行失败" };
        }
    };

    const executeOnlineToolCall = async (sessionId: string, toolCall: ResponseToolCall): Promise<OnlineExecutedToolCall> => {
        try {
            const result = await executeOnlineTool(sessionId, toolCall.function.name, parseToolArguments(toolCall.function.arguments), toolCall.id);
            return { toolCallId: toolCall.id, name: toolCall.function.name, result };
        } catch (error) {
            if (isAgentSessionPollingAbort(error)) throw error;
            return { toolCallId: toolCall.id, name: toolCall.function.name, result: { ok: false, message: error instanceof Error ? error.message : "工具参数错误" } };
        }
    };

    const executeOnlineToolCalls = async (sessionId: string, toolCalls: ResponseToolCall[]) => {
        const results: OnlineExecutedToolCall[] = [];
        let stopReason = "";
        for (const toolCall of toolCalls) {
            if (stopReason) {
                results.push({ toolCallId: toolCall.id, name: toolCall.function.name, result: { ok: false, message: stopReason } });
                continue;
            }
            const result = await executeOnlineToolCall(sessionId, toolCall);
            results.push(result);
            if (!result.result.ok) stopReason = "前一个工具调用失败，未继续执行。";
            else if (result.result.waitForUser) stopReason = "已打开待确认面板，同批后续操作暂不执行。";
        }
        return results;
    };

    const approveOnlineTool = async (messageId: string) => {
        const message = safeSessions.flatMap((session) => session.messages).find((item) => item.id === messageId);
        const detail = objectDetail(message?.detail);
        const pendingContext = pendingToolContextRef.current.get(messageId);
        const toolCalls = pendingContext?.toolCalls || toolCallsFromDetail(detail);
        const previousMessages = pendingContext?.messages || [];
        const session = safeSessions.find((session) => session.messages.some((item) => item.id === messageId));
        const assistantId = pendingContext?.assistantId || "";
        if (!session) return;
        if (!toolCalls.length || !previousMessages.length || !assistantId) {
            upsertMessage(session.id, { id: messageId, role: "tool", title: "工具执行失败", text: "工具上下文不完整，无法执行。", detail: { ...detail, status: "failed" } });
            return;
        }
        try {
            setIsRunning(true);
            const results = await executeOnlineToolCalls(session.id, toolCalls);
            upsertMessage(session.id, { id: messageId, role: "tool", title: "工具执行完成", text: results.map((item) => toolResultText(item.result)).join("\n"), detail: { ...detail, results, status: "completed" } });
            pendingToolContextRef.current.delete(messageId);
            await continueOnlineToolLoopAfterResults(session.id, assistantId, previousMessages, toolCalls, results, pendingContext?.step || Number(detail.step) || 1);
        } catch (error) {
            if (isAgentSessionPollingAbort(error)) return;
            appendMessage(session.id, { id: nanoid(), role: "error", title: "操作失败", text: error instanceof Error ? error.message : "操作失败" });
        } finally {
            setIsRunning(false);
        }
    };

    const rejectOnlineTool = (messageId: string) => {
        const session = safeSessions.find((session) => session.messages.some((item) => item.id === messageId));
        pendingToolContextRef.current.delete(messageId);
        if (session) upsertMessage(session.id, { id: messageId, role: "tool", title: "已拒绝执行", text: "工具调用已取消", detail: { ...objectDetail(session.messages.find((item) => item.id === messageId)?.detail), status: "rejected" } });
    };

    const undoLastOnlineBatch = () => {
        const restored = onUndoOps();
        if (!restored) return;
        snapshotRef.current = restored;
        if (activeSession) appendMessage(activeSession.id, { id: nanoid(), role: "tool", title: "已撤销最近修改", text: "画布已恢复。已提交的生成任务和费用不受影响。", detail: { status: "completed", remainingUndoCount: Math.max(0, undoOpsCount - 1) } });
    };

    const submit = async () => {
        const text = prompt.trim();
        if (!text || agentBusy) return;
        await sendMessage(text, messages);
    };

    const submitQuickAction = (text: string) => {
        if (!text.trim() || agentBusy) return;
        void sendMessage(text.trim(), messages);
    };

    useEffect(() => {
        if (!cinematicEntry) return;
        setView("chat");
        onCinematicEntryConsumed?.();
    }, [cinematicEntry, onCinematicEntryConsumed]);

    const resumePendingCinematicSession = async (sessionId: string, pending: CanvasAssistantPendingBackendSession) => {
        if (cinematicSessionControllersRef.current.has(pending.id)) return;
        const controller = new AbortController();
        cinematicSessionControllersRef.current.set(pending.id, controller);
        setIsRunning(true);
        let continuationFailureDisposition: CinematicContinuationFailureDisposition | undefined;
        try {
            const detail = await resumeCinematicAgentSession(pending.id, { signal: controller.signal });
            const ops = requireOps(JSON.parse(cinematicAgentSessionOpsJson(detail)));
            const continuationTask = [...detail.tasks].reverse().find((task) => task.status === "succeeded");
            const applyContinuation = async ({ effectKey, signal }: { effectKey?: string; signal?: AbortSignal } = {}) => {
                if (hasAgentGenerationEffect(sessionId, effectKey)) return;
                await canvasCinematicContinuationEntryAdapters["resume-cinematic"]({
                    projectId,
                    effectKey,
                    signal,
                    readSnapshot: () => snapshotRef.current,
                    executeOps: () => executeOps(ops),
                    completeSession: (key) => completeCinematicSession(sessionId, pending.id, ops, true, key),
                    readLiveSessionState: readCinematicSessionState,
                    restoreLiveSessions: restoreCinematicSessions,
                    restoreLiveSnapshot: restoreCinematicSnapshot,
                    failProvider: (failure) => {
                        failCinematicSession(sessionId, pending.id, failure);
                    },
                    onFailureDisposition: (disposition, error) => {
                        continuationFailureDisposition = disposition;
                    },
                });
            };
            if (continuationTask) {
                await consumeGenerationTaskAgent(continuationTask, pending.id, applyContinuation, { signal: controller.signal });
            } else {
                await applyContinuation();
            }
        } catch (error) {
            if (continuationFailureDisposition) return;
            const disposition = handleCinematicContinuationFailure(error, (failure) => {
                failCinematicSession(sessionId, pending.id, failure);
            });
        } finally {
            if (cinematicSessionControllersRef.current.get(pending.id) === controller) cinematicSessionControllersRef.current.delete(pending.id);
            if (cinematicSessionControllersRef.current.size === 0) setIsRunning(false);
        }
    };

    useEffect(() => {
        localSessions.forEach((session) => {
            const pending = session.pendingBackendSession;
            if (pending?.kind === "cinematic" && pending.status === "pending") void resumePendingCinematicSession(session.id, pending);
        });
    }, [localSessions]);

    const addImagesToCanvas = (files: FileList | File[] | null) => {
        const file = Array.from(files || []).find((item) => item.type.startsWith("image/"));
        if (file) onPasteImage(file);
    };

    const collapse = () => {
        onCollapse();
    };

    const onlineContent = (
        <>
            {view === "history" ? (
                <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3">
                    <div className="mb-2 flex items-center justify-between gap-2 px-1">
                        <div className="text-xs font-medium" style={{ color: theme.node.muted }}>历史会话</div>
                        <Tooltip title="清空历史">
                            <Button type="text" shape="circle" className="!h-7 !w-7 !min-w-7" style={iconButtonStyle} icon={<X className="size-3.5" />} disabled={!historySessions.length} onClick={() => setDeleteChatIds(historySessions.map((session) => session.id))} aria-label="清空历史会话" />
                        </Tooltip>
                    </div>
                    <AssistantHistory
                        sessions={historySessions}
                        activeSession={activeSession}
                        onOpen={(id) => {
                            setLocalActiveSessionId(id);
                            setView("chat");
                        }}
                        onDelete={(id) => setDeleteChatIds([id])}
                    />
                </div>
            ) : (
                <div ref={chatListRef} className="thin-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
                    {messages.length ? (
                        <>
                            {messages.map((message, index) => (
                                <Fragment key={message.id}>
                                {agentBusy && index === messages.findLastIndex((item) => item.role === "user") + 1 ? <div className="creative-agent-thinking-wrap"><AgentWorkingMessage theme={theme} /></div> : null}
                                <div className={message.role === "tool" ? "agent-tool-message" : "space-y-2"}>
                                    <AgentChatMessage item={assistantMessageToChatMessage(message)} theme={theme} user={user} isStreaming={agentBusy && message.id === messages.at(-1)?.id && message.role === "assistant" && !canvasCreativeDetail(message)} onRejectTool={rejectOnlineTool} onApproveTool={approveOnlineTool} onQuickAction={submitQuickAction} />
                                    {canvasCreativeDetail(message) && <CanvasCreativeInteraction
                                        message={message} sessionId={activeSession!.id} active={message.id === activeCreativeId && !isRunning && agentMode === "online"} config={effectiveConfig}
                                        superseded={message.id !== activeCreativeId}
                                        canvas={{ canvasId: projectId, read: () => snapshotRef.current, apply: async (ops) => { const next = await onApplyOps(ops, { source: "online", conversationId: activeSession!.id, messageId: message.id }); snapshotRef.current = next; return next; } }}
                                        onUpdate={(next) => upsertMessage(activeSession!.id, next)}
                                        onContinue={(text) => { void sendMessage(text, localSessionsRef.current.find((session) => session.id === activeSession!.id)?.messages || []); }}
                                        onReview={() => { void sendMessage("继续当前创作，在我已授权的范围内完成下一步。根据真实执行结果保留已完成作品，必要时自行读取素材；只有缺少关键信息或需要新的方案、费用确认时再停下来。", localSessionsRef.current.find((session) => session.id === activeSession!.id)?.messages || []); }}
                                        onEditPrompt={(text) => {
                                            setPrompt(text);
                                            requestAnimationFrame(() => composerRef.current?.querySelector<HTMLElement>('textarea, [contenteditable="true"]')?.focus());
                                        }}
                                        onBusy={(id, busy) => setCreativeBusy((current) => current[id] === busy ? current : { ...current, [id]: busy })}
                                    />}
                                    {message.references?.length ? <MessageReferences message={message} /> : null}
                                </div>
                                </Fragment>
                            ))}
                            {agentBusy && messages.findLastIndex((item) => item.role === "user") === messages.length - 1 ? <div className="creative-agent-thinking-wrap"><AgentWorkingMessage theme={theme} /></div> : null}
                        </>
                    ) : (
                        <AgentChatEmptyState
                            theme={theme}
                            nodeCount={contextSummary.nodeCount}
                            onSelect={(text) => {
                                setPrompt(text);
                                void sendMessage(text, messages);
                            }}
                        />
                    )}
                </div>
            )}

            {view === "chat" ? (
                <>
                    {selectedReferences.length ? (
                        <div className="thin-scrollbar flex max-w-full items-center gap-1.5 overflow-x-auto px-3 pb-1" role="group" aria-label="待发送引用">
                            <span className="shrink-0 text-xs text-muted-foreground">待发送引用</span>
                            {selectedReferences.map((item, index) => (
                                <AssistantReferenceChip
                                    key={item.id}
                                    item={item}
                                    label={assistantImageReferenceLabel(selectedReferences, index)}
                                    previewUrl={resolvedPreviewById.get(item.id) || item.dataUrl}
                                    onRemove={() => {
                                        setAttachedReferenceIds((prev) => {
                                            const next = new Set(prev);
                                            next.delete(item.id);
                                            return next;
                                        });
                                        if (selectedNodeIds.has(item.id)) onSelectNodeIds(new Set(Array.from(selectedNodeIds).filter((nodeId) => nodeId !== item.id)));
                                    }}
                                    onInsertMention={(label) => {
                                        const token = `@${label} `;
                                        setPrompt((prev) => (promptAlreadyHasMention(prev, label) ? prev : prev.trim() ? `${prev.replace(/\s+$/u, "")} ${token}` : token));
                                    }}
                                />
                            ))}
                        </div>
                    ) : null}
                    {currentCreativeState && <div className="creative-agent-plan-docked" data-canvas-no-zoom data-canvas-wheel-scroll>
                        <CreativePlanBar plan={creativePlan(currentCreativeState)} onLocateNode={(id) => onSelectNodeIds(new Set([id]))} />
                    </div>}
                    <div ref={composerRef}>
                    <AgentChatComposer
                        prompt={prompt}
                        sending={agentBusy}
                        placeholder={currentCreativeState?.modificationRequested ? "在这里告诉我想改哪里，调整后再确认…" : "描述创作需求，或告诉我如何调整画布…"}
                        theme={theme}
                        references={composerReferences}
                        slashSkills={composerSkills}
                        onPromptChange={setPrompt}
                        onSubmit={submit}
                        onAddFiles={addImagesToCanvas}
                        left={
                            <>
                                <VoiceRecordingButton disabled={agentBusy} onTranscribed={(text) => setPrompt((prev) => (prev.trim() ? `${prev} ${text}` : text))} />
                                <AgentTextModelPicker config={effectiveConfig} value={effectiveConfig.textModel} onChange={(model) => updateConfig("textModel", model)} />
                            </>
                        }
                    />
                    </div>
                </>
            ) : null}

            <Modal
                title="删除对话记录？"
                open={deleteChatIds.length > 0}
                centered
                onCancel={() => setDeleteChatIds([])}
                footer={
                    <>
                        <Button onClick={() => setDeleteChatIds([])}>取消</Button>
                        <Button
                            danger
                            type="primary"
                            onClick={() => {
                                deleteChatIds.length === historySessions.length ? clearSessions() : removeSessions(deleteChatIds);
                                setDeleteChatIds([]);
                            }}
                        >
                            删除
                        </Button>
                    </>
                }
            >
                <p className="text-sm opacity-60">将删除 {deleteChatIds.length} 条对话记录，此操作不可撤销。</p>
            </Modal>
        </>
    );

    return (
        <motion.aside
            className="pointer-events-auto relative flex h-full w-full flex-col overflow-hidden rounded-[var(--panel-radius)]"
            initial={{ x: 48, opacity: 0 }}
            animate={{ x: closing ? 28 : 0, opacity: closing ? 0 : 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
            style={{
                background: theme.spatial.elevated,
                color: theme.node.text,
                boxShadow: `-18px 0 48px ${theme.spatial.shadow}, 0 24px 72px ${theme.spatial.shadow}`,
            }}
        >
            <AgentPanelChrome
                theme={theme}
                context={contextSummary}
                referenceCount={selectedReferences.length}
                confirmTools={confirmTools}
                canUndo={canUndoOps}
                undoCount={undoOpsCount}
                onConfirmToolsChange={(confirmTools) => setAgentState({ confirmTools })}
                onUndo={undoLastOnlineBatch}
                onCollapse={collapse}
                historyCount={historySessions.length}
                historyActive={view === "history"}
                onOpenHistory={() => setView((current) => current === "history" ? "chat" : "history")}
                onNewChat={() => { startChatSession(); setView("chat"); }}
                newChatDisabled={false}
            />
            {onlineContent}
        </motion.aside>
    );
}
