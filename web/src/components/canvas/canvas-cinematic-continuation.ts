import { isCanvasGenerationDurableAckError, persistCanvasCinematicSessionContinuationEffect } from "@/services/canvas-generation-consumer";
import { isAgentSessionPollingAbort } from "@/lib/canvas/canvas-agent-session";
import type { CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasAssistantSession } from "@/types/canvas";

export type CinematicContinuationFailureDisposition = "abort" | "durable-ack" | "provider-failed";

export type CinematicContinuationLiveSessionState = { sessions: CanvasAssistantSession[]; activeChatId: string | null };

type CanvasCinematicContinuationBoundaryInput<T> = {
    projectId: string;
    effectKey?: string;
    signal?: AbortSignal;
    readSnapshot: () => CanvasAgentSnapshot;
    executeOps: () => Promise<T>;
    completeSession: (effectKey?: string) => CanvasAssistantSession[];
    readLiveSessionState: () => CinematicContinuationLiveSessionState;
    restoreLiveSessions: (sessions: CanvasAssistantSession[], activeChatId: string | null) => void;
    restoreLiveSnapshot: (state: Pick<CanvasAgentSnapshot, "nodes" | "connections">) => void;
    failProvider: (error: unknown) => void;
    onFailureDisposition?: (disposition: CinematicContinuationFailureDisposition, error: unknown) => void;
    persistContinuation?: typeof persistCanvasCinematicSessionContinuationEffect;
};

export function handleCinematicContinuationFailure(error: unknown, failProvider: (error: unknown) => void): CinematicContinuationFailureDisposition {
    if (isAgentSessionPollingAbort(error)) return "abort";
    if (isCanvasGenerationDurableAckError(error)) return "durable-ack";
    failProvider(error);
    return "provider-failed";
}

export async function runCanvasCinematicContinuationBoundary<T>(input: CanvasCinematicContinuationBoundaryInput<T>) {
    const previousSnapshot = input.readSnapshot();
    const previousSessionState = input.readLiveSessionState();
    try {
        if (input.signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
        const result = await input.executeOps();
        const attemptedSnapshot = input.readSnapshot();
        input.completeSession(input.effectKey);
        const attemptedSessionState = input.readLiveSessionState();
        if (input.effectKey) {
            await (input.persistContinuation ?? persistCanvasCinematicSessionContinuationEffect)({
                projectId: input.projectId,
                effectKey: input.effectKey,
                previousNodes: previousSnapshot.nodes,
                nodes: attemptedSnapshot.nodes,
                previousConnections: previousSnapshot.connections,
                connections: attemptedSnapshot.connections,
                previousChatSessions: previousSessionState.sessions,
                chatSessions: attemptedSessionState.sessions,
                previousActiveChatId: previousSessionState.activeChatId,
                activeChatId: attemptedSessionState.activeChatId,
                signal: input.signal,
                readLiveSessionState: input.readLiveSessionState,
                restoreLiveSessions: input.restoreLiveSessions,
                restoreLiveSnapshot: input.restoreLiveSnapshot,
            });
        }
        return result;
    } catch (error) {
        const disposition = handleCinematicContinuationFailure(error, input.failProvider);
        input.onFailureDisposition?.(disposition, error);
        throw error;
    }
}

export const canvasCinematicContinuationEntryAdapters = {
    "online-tool": runCanvasCinematicContinuationBoundary,
    "submit-cinematic": runCanvasCinematicContinuationBoundary,
    "resume-cinematic": runCanvasCinematicContinuationBoundary,
} as const;
