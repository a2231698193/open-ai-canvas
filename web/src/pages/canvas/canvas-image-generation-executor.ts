import { nanoid } from "nanoid";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { canGenerateImageInPlace, findAvailableGenerationGroupPosition, imageGenerationChildPosition, imageGenerationGroupSize } from "@/lib/canvas/canvas-generation-layout";
import { cancelIncompleteImageBatch, hasImageBatchResult, reconcileImageBatchRoot, retireImageBatchChildren } from "@/lib/canvas/canvas-image-batch-retry";
import { buildImageGenerationNodeTitle } from "@/lib/canvas/canvas-generation-title";
import { nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";
import { canvasImageReferenceLimitError, buildImageGenerationMetadata, getGenerationCount, isGenerationCanceled, resetGenerationTaskMetadata, runCanvasGenerationTaskToConsumer } from "@/lib/canvas/canvas-project-generation";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { resolveImageBatchPlan } from "@/lib/canvas/canvas-image-batch-plan";
import { imageGenerationReferenceConnections } from "@/lib/canvas/canvas-resource-references";
import { canvasGenerationPromptMetadata } from "@/lib/canvas/canvas-generation-submission";
import { commitProducedModel } from "@/lib/canvas/produced-model";
import { CONTENT_MODERATION_ERROR_CODE, generationFailureMetadata, type GenerationFailureMetadata } from "@/lib/generation-error";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

import type { CanvasGenerationExecution } from "./canvas-generation-executor-types";

const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;
const NODE_STATUS_IDLE = "idle" as const;

export async function executeImageGeneration({
    nodeId,
    sourceNode,
    canvasNodes,
    canvasConnections,
    prompt,
    effectivePrompt,
    generationConfig,
    generationContext,
    controller,
    projectId,
    setNodes,
    setConnections,
    setSelectedNodeIds,
    setSelectedConnectionId,
    setDialogNodeId,
    startGenerationRequest,
    finishGenerationRequest,
    bindGenerationTask,
    applyGenerationTaskResult,
    styleMetadata,
    skillMetadata,
    taskContext,
    retryContext,
    showError,
    registerPendingNodeIds,
}: CanvasGenerationExecution) {
    const referenceLimitError = canvasImageReferenceLimitError(generationConfig, generationContext.referenceImages);
    if (referenceLimitError) {
        showError(referenceLimitError);
        return;
    }
    const requestedCount = getGenerationCount(generationConfig.count);
    // 固定批量协议（例如 Midjourney 一次 imagine 固定回四张）：节点数量取上游固定批量，并且只提交
    // 一次上游请求，返回的 N 张按输出序号分给 N 个子节点。若按用户张数发 N 次请求，会变成 N 组
    // 生成并按 N 次计费，同时丢掉每次返回的其余图片。
    const batchPlan = resolveImageBatchPlan(requestedCount, modelCapabilityConfigFor(generationConfig, generationConfig.model).image?.batchOutputs);
    const batchOutputs = batchPlan.batchOutputs;
    const count = batchPlan.nodeCount;
    const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
    const isImageNode = sourceNode?.type === CanvasNodeType.Image;
    const isExistingImageNode = isImageNode && hasImageBatchResult(sourceNode);
    const reuseSourceNode = canGenerateImageInPlace(sourceNode);
    const retired = reuseSourceNode && sourceNode ? retireImageBatchChildren(sourceNode, canvasNodes, canvasConnections) : { nodes: canvasNodes, connections: canvasConnections, removedIds: [] as string[] };
    const workingNodes = retired.nodes;
    const workingConnections = retired.connections;
    // 已有图片生成新结果并保留旧版本；参考图只来自入边，避免把旧结果误当成自身输入。
    const referenceImages = generationContext.referenceImages;
    const generationType = referenceImages.length ? ("edit" as const) : ("generation" as const);
    const generationMetadata = buildImageGenerationMetadata(generationType, generationConfig, count, referenceImages);
    const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : isImageNode ? CanvasNodeType.Image : CanvasNodeType.Text];
    const imageDefaults = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
    // 生成中占位框按设置比例显示，避免 16:9 任务显示成默认 340x240。
    const requestedImageSize = nodeSizeFromRatio(generationConfig.size || "auto", imageDefaults.width, imageDefaults.height);
    const imageConfig = requestedImageSize || imageDefaults;
    // auto 图生图沿用来源节点尺寸；用户明确选择比例时必须以目标比例创建节点。
    const referenceNode = referenceImages.length === 1 ? canvasNodes.find((node) => node.id === referenceImages[0].id && node.type === CanvasNodeType.Image) : undefined;
    const imageSizeSource = requestedImageSize ? undefined : isExistingImageNode ? sourceNode : referenceNode;
    const outputNodeSize = imageSizeSource ? { width: imageSizeSource.width, height: imageSizeSource.height } : imageConfig;
    const parentPosition = sourceNode?.position || { x: 0, y: 0 };
    const parentWidth = sourceNode?.width || parentConfig.width;
    const parentHeight = sourceNode?.height || parentConfig.height;
    const rootId = reuseSourceNode ? nodeId : nanoid();
    const childIds = count > 1 ? Array.from({ length: count }, () => nanoid()) : [];
    const targetIds = count > 1 ? childIds : [rootId];
    registerPendingNodeIds(reuseSourceNode ? childIds : [rootId, ...childIds]);
    const rootWidth = outputNodeSize.width;
    const rootHeight = outputNodeSize.height;
    const preferredPosition = {
        x: parentPosition.x + parentWidth + 96,
        y: parentPosition.y + parentHeight / 2 - rootHeight / 2,
    };
    const rootPosition = reuseSourceNode ? parentPosition : findAvailableGenerationGroupPosition(workingNodes, preferredPosition, imageGenerationGroupSize({ width: rootWidth, height: rootHeight }, outputNodeSize, childIds.length));

    const rootNode: CanvasNodeData = {
        id: rootId,
        type: CanvasNodeType.Image,
        title: buildImageGenerationNodeTitle(effectivePrompt, sourceNode, undefined, 1, { preserveCustomTitle: reuseSourceNode }),
        position: rootPosition,
        width: rootWidth,
        height: rootHeight,
        metadata: {
            ...resetGenerationTaskMetadata(reuseSourceNode ? sourceNode?.metadata : undefined, NODE_STATUS_LOADING),
            ...canvasGenerationPromptMetadata(prompt, effectivePrompt),
            status: NODE_STATUS_LOADING,
            size: generationConfig.size,
            isBatchRoot: count > 1,
            batchChildIds: count > 1 ? childIds : undefined,
            batchFailedCount: count > 1 ? 0 : undefined,
            batchUsesReferenceImages: referenceImages.length > 0,
            primaryImageId: undefined,
            content: reuseSourceNode ? "" : undefined,
            storageKey: undefined,
            assetId: undefined,
            ...generationMetadata,
            ...styleMetadata,
            ...skillMetadata,
            imageBatchExpanded: count > 1 ? true : undefined,
            generationErrorCode: undefined,
            resourceReloadAvailable: undefined,
            failedPromptFingerprint: undefined,
        },
    };
    const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
        id,
        type: CanvasNodeType.Image,
        title: buildImageGenerationNodeTitle(effectivePrompt, sourceNode, index, count, { preserveCustomTitle: reuseSourceNode }),
        position: imageGenerationChildPosition(rootNode.position, rootNode.width, outputNodeSize, index),
        width: outputNodeSize.width,
        height: outputNodeSize.height,
        metadata: {
            ...canvasGenerationPromptMetadata(prompt, effectivePrompt),
            status: NODE_STATUS_LOADING,
            size: generationConfig.size,
            batchRootId: rootId,
            // 只有固定批量协议才让子节点记住输出序号：普通批量里每个子节点跑自己的任务，
            // 记了序号反而会去取自己不存在的第 N 张。
            ...(batchOutputs ? { batchOutputIndex: index } : {}),
            ...generationMetadata,
            ...styleMetadata,
            ...skillMetadata,
            generationErrorCode: undefined,
            resourceReloadAvailable: undefined,
            failedPromptFingerprint: undefined,
        },
    }));
    const connectsSelf = !isExistingImageNode || referenceImages.some((img) => img.id === nodeId);
    const batchConnections = [
        ...(reuseSourceNode ? [] : imageGenerationReferenceConnections(nodeId, rootId, workingNodes, workingConnections, nanoid)),
        ...(reuseSourceNode || !connectsSelf ? [] : [{ id: nanoid(), fromNodeId: nodeId, toNodeId: rootId }]),
        ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: rootId, toNodeId: childId })),
    ];

    const nextNodes: CanvasNodeData[] = [
        ...workingNodes.map((node) => {
            if (node.id !== nodeId) return node;
            if (isConfigNode) return { ...node, metadata: { ...node.metadata, ...canvasGenerationPromptMetadata(prompt, effectivePrompt), status: NODE_STATUS_LOADING, errorDetails: undefined } };
            if (reuseSourceNode) return { ...node, position: rootNode.position, width: rootNode.width, height: rootNode.height, title: rootNode.title, metadata: rootNode.metadata };
            if (isImageNode) return node;
            return {
                ...node,
                type: CanvasNodeType.Text,
                title: prompt.slice(0, 32) || "Prompt",
                width: parentConfig.width,
                height: parentConfig.height,
                metadata: { ...node.metadata, content: prompt, richText: undefined, prompt, composerContent: prompt, status: NODE_STATUS_SUCCESS, fontSize: 14, errorDetails: undefined },
            };
        }),
        ...(reuseSourceNode ? [] : [rootNode]),
        ...childNodes,
    ];

    setNodes(nextNodes);
    setConnections((current) => {
        const removed = new Set(retired.removedIds);
        const nextConnections = [...current.filter((connection) => !removed.has(connection.fromNodeId) && !removed.has(connection.toNodeId)), ...batchConnections];
        if (projectId) {
            useCanvasStore.getState().updateProject(projectId, { nodes: nextNodes, connections: nextConnections });
        }
        return nextConnections;
    });
    setSelectedNodeIds(new Set([nodeId]));
    setSelectedConnectionId(null);
    setDialogNodeId(nodeId);

    targetIds.forEach((targetId) => startGenerationRequest(targetId, nodeId, nodeId, controller));
    if (count > 1) startGenerationRequest(rootId, nodeId, nodeId, controller);
    let hasSuccess = false;
    let hasFailure = false;
    let failureCount = 0;
    let representativeFailure: GenerationFailureMetadata | undefined;
    // 固定批量协议只跑一次上游请求（任务挂在第一个子节点上），其余情况每个子节点各跑一次。
    const runTargetIds = batchOutputs ? [childIds[0]] : targetIds;
    await Promise.all(
        runTargetIds.map(async (targetId) => {
            try {
                await runCanvasGenerationTaskToConsumer(
                    {
                        projectId,
                        nodeId: targetId,
                        ...retryContext,
                        mode: "image",
                        prompt: effectivePrompt,
                        config: { ...generationConfig, count: "1" },
                        referenceImages,
                        signal: controller.signal,
                        metadata: {
                            sourceNodeId: nodeId,
                            ...taskContext,
                            resolvedCharacterVersions: generationContext.resolvedCharacterVersions,
                            promptTemplateOperation: sourceNode?.metadata?.promptTemplateOperation,
                            promptTemplateVariables: sourceNode?.metadata?.promptTemplateVariables,
                            ...styleMetadata,
                            ...skillMetadata,
                        },
                    },
                    {
                        bindTask: (task) => (batchOutputs ? childIds.forEach((childId) => bindGenerationTask(childId, task)) : bindGenerationTask(targetId, task)),
                        consumeTask: batchOutputs
                            ? async (task) => {
                                  // 同一次任务的第 i 张图落到第 i 个子节点；缺图时该节点报错，不影响其他张。
                                  await Promise.all(childIds.map((childId, index) => applyGenerationTaskResult(childId, task, index)));
                              }
                            : (task) => applyGenerationTaskResult(targetId, task),
                    },
                );
                if (targetId !== rootId) {
                    setNodes((current) => {
                        const child = current.find((node) => node.id === targetId);
                        const root = current.find((node) => node.id === rootId);
                        if (!child || !hasImageBatchResult(child) || !root || root.metadata?.primaryImageId) return current;
                        const center = { x: root.position.x + root.width / 2, y: root.position.y + root.height / 2 };
                        const geometry = root.metadata?.locked
                            ? {}
                            : {
                                  width: child.width,
                                  height: child.height,
                                  position: { x: center.x - child.width / 2, y: center.y - child.height / 2 },
                              };
                        const updated = current.map((node) =>
                            node.id === rootId
                                ? {
                                      ...node,
                                      ...geometry,
                                      metadata: commitProducedModel(
                                          {
                                              ...node.metadata,
                                              content: child.metadata?.content,
                                              storageKey: child.metadata?.storageKey,
                                              mimeType: child.metadata?.mimeType,
                                              bytes: child.metadata?.bytes,
                                              naturalWidth: child.metadata?.naturalWidth,
                                              naturalHeight: child.metadata?.naturalHeight,
                                              assetId: child.metadata?.assetId,
                                              primaryImageId: targetId,
                                              status: NODE_STATUS_SUCCESS,
                                          },
                                          child.metadata?.producedModel,
                                      ),
                                  }
                                : node,
                        );
                        if (projectId) useCanvasStore.getState().updateProject(projectId, { nodes: updated });
                        return updated;
                    });
                }
                hasSuccess = true;
                if (isConfigNode) setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined } } : node)));
                return true;
            } catch (error) {
                if (isGenerationCanceled(error)) return false;
                const failure = generationFailureMetadata(error, prompt);
                if (!representativeFailure || failure.generationErrorCode === CONTENT_MODERATION_ERROR_CODE) representativeFailure = failure;
                hasFailure = true;
                // 固定批量是一次调用产出整批：失败要镜像到所有子节点，不能只标一个。
                const failedNodeIds = batchOutputs ? childIds : [targetId];
                failureCount += failedNodeIds.length;
                setNodes((current) => {
                    const next = current.map((node) => (failedNodeIds.includes(node.id) ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, ...failure } } : node));
                    if (projectId) useCanvasStore.getState().updateProject(projectId, { nodes: next });
                    return next;
                });
                return false;
            } finally {
                (batchOutputs ? childIds : [targetId]).forEach((pendingNodeId) => finishGenerationRequest(pendingNodeId, controller));
            }
        }),
    );
    if (count > 1) finishGenerationRequest(rootId, controller);
    if (controller.signal.aborted) {
        setNodes((current) => {
            const cancelled = cancelIncompleteImageBatch(rootId, childIds, current, []);
            if (cancelled.removedIds.length) {
                const removed = new Set(cancelled.removedIds);
                setConnections((connections) => connections.filter((connection) => !removed.has(connection.fromNodeId) && !removed.has(connection.toNodeId)));
            }
            return cancelled.nodes.map((node) => (node.id === nodeId && isConfigNode && node.metadata?.status === NODE_STATUS_LOADING ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_IDLE, errorDetails: undefined } } : node));
        });
        return;
    }
    if (hasFailure) showError(hasSuccess ? "部分图片生成失败" : "全部图片生成失败");
    setNodes((current) => {
        const next = current.map((node) => {
            if (node.id === nodeId && isConfigNode) {
                return {
                    ...node,
                    metadata: {
                        ...node.metadata,
                        status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR,
                        ...(hasSuccess ? { errorDetails: undefined, generationErrorCode: undefined, failedPromptFingerprint: undefined } : representativeFailure || { errorDetails: "全部图片生成失败" }),
                    },
                };
            }
            if (node.id === rootId) {
                if (count > 1) return reconcileImageBatchRoot(node, current);
                return {
                    ...node,
                    metadata: {
                        ...node.metadata,
                        status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR,
                        batchFailedCount: count > 1 ? failureCount : undefined,
                        ...(hasSuccess ? { errorDetails: undefined, generationErrorCode: undefined, failedPromptFingerprint: undefined } : representativeFailure || { errorDetails: "全部图片生成失败" }),
                    },
                };
            }
            return node;
        });
        if (projectId) useCanvasStore.getState().updateProject(projectId, { nodes: next });
        return next;
    });
}
