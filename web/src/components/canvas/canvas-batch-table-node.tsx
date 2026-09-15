import { useCallback, useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Button, Switch, Tooltip } from "antd";
import { Image as ImageIcon, LoaderCircle, Play, Plus, RefreshCw, Rows3, Trash2 } from "lucide-react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import {
    BATCH_REFERENCE_HANDLE_GAP,
    BATCH_REFERENCE_HANDLE_TOP,
    MAX_BATCH_REFERENCE_COLUMNS,
    batchReferenceColumns,
    batchReferenceHandleId,
    batchReferenceMentionToken,
} from "@/lib/canvas/canvas-batch-table";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasBatchOperation, CanvasBatchRow, CanvasBatchTableData, CanvasConnection, CanvasGenerationBatch, CanvasGenerationBatchItem, CanvasNodeData } from "@/types/canvas";

type Props = {
    node: CanvasNodeData;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    batch?: CanvasGenerationBatch;
    theme: CanvasTheme;
    onPatchTable: (patch: Partial<CanvasBatchTableData>) => void;
    onAddRow: () => void;
    onRemoveRow: (rowId: string) => void;
    onUpdateRow: (rowId: string, patch: Partial<CanvasBatchRow>) => void;
    onFillRows: () => void;
    onGenerate: (rowIds?: string[]) => void;
    onRetryItem: (batchId: string, itemId: string) => void;
    onAddReferenceColumn: () => void;
    onConnectStart: (event: ReactPointerEvent, handleId: string) => void;
    onConnectDrop?: (event: ReactPointerEvent, handleId: string) => void;
    readOnly?: boolean;
};

const OPERATION_OPTIONS = [
    { value: "try_on", label: "批量换装" },
    { value: "creative", label: "创意生图" },
] satisfies Array<{ value: CanvasBatchOperation; label: string }>;

const CONCURRENCY_OPTIONS = [1, 5, 10] as const;

export function CanvasBatchTableNodeContent({ node, nodes, connections, batch, theme, onPatchTable, onAddRow, onRemoveRow, onUpdateRow, onFillRows, onGenerate, onRetryItem, onAddReferenceColumn, onConnectStart, onConnectDrop, readOnly = false }: Props) {
    const table = node.metadata?.batchTable || { operation: "try_on" as const, concurrency: 10, rows: [] };
    const referenceColumns = batchReferenceColumns(table);
    const nodeById = useMemo(() => new Map(nodes.map((item) => [item.id, item])), [nodes]);
    const batchItemByRowId = useMemo(() => new Map((batch?.items || []).map((item) => [item.rowId, item])), [batch?.items]);
    const connectedImageCount = useMemo(() => new Set(connections.filter((connection) => connection.toNodeId === node.id && connection.relation !== "batch-output").map((connection) => connection.fromNodeId)).size, [connections, node.id]);
    const completed = table.rows.filter((row) => hasNodeMedia(row.outputNodeId ? nodeById.get(row.outputNodeId) : undefined)).length;
    const unfinishedReadyCount = table.rows.filter((row) => rowReady(row, table.operation, nodeById) && !hasNodeMedia(row.outputNodeId ? nodeById.get(row.outputNodeId) : undefined)).length;
    const gridTemplateColumns = `54px repeat(${referenceColumns.length}, 84px) minmax(280px, 1fr) 146px 76px`;
    const subtleSurface = `color-mix(in srgb, ${theme.node.text} 4%, transparent)`;

    return (
        <div data-canvas-no-zoom data-canvas-wheel-scroll className="relative flex h-full w-full flex-col overflow-visible text-xs" style={{ color: theme.node.text }} onPointerDown={(event) => event.stopPropagation()}>
            {!readOnly ? <BatchReferenceHandles columns={referenceColumns} theme={theme} onConnectStart={onConnectStart} onConnectDrop={onConnectDrop} /> : null}

            <div className="flex min-h-14 flex-wrap items-center gap-2 border-b px-3 py-2" style={{ borderColor: theme.node.stroke, background: subtleSurface }}>
                <BatchChoiceGroup ariaLabel="批量任务类型" theme={theme} disabled={readOnly} options={OPERATION_OPTIONS} value={table.operation} onChange={(operation) => onPatchTable({ operation: operation as CanvasBatchOperation })} />
                <div className="flex items-center gap-1.5 rounded-lg px-2 py-1" style={{ background: theme.node.panel }}>
                    <span className="font-medium" style={{ color: theme.node.muted }}>并发</span>
                    <BatchChoiceGroup ariaLabel="并发数" theme={theme} disabled={readOnly} compact options={CONCURRENCY_OPTIONS.map((value) => ({ value, label: String(value) }))} value={table.concurrency} onChange={(concurrency) => onPatchTable({ concurrency: Number(concurrency) })} />
                </div>
                <div className="flex h-7 items-center gap-1 rounded-lg px-2" style={{ background: theme.node.panel, color: theme.node.muted }}>
                    <span>{referenceColumns.length}/{MAX_BATCH_REFERENCE_COLUMNS} 组参考</span>
                    {!readOnly ? (
                        <Tooltip title={referenceColumns.length >= MAX_BATCH_REFERENCE_COLUMNS ? "最多支持 6 组参考图" : `新增参考图 ${referenceColumns.length + 1}`}>
                            <button type="button" aria-label={`新增参考图 ${referenceColumns.length + 1}`} className="grid size-5 place-items-center rounded-md transition-colors hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-1 dark:hover:bg-white/10" style={{ color: theme.node.text }} disabled={referenceColumns.length >= MAX_BATCH_REFERENCE_COLUMNS} onClick={onAddReferenceColumn}>
                                <Plus className="size-3.5" />
                            </button>
                        </Tooltip>
                    ) : null}
                </div>
                <span className="tabular-nums" style={{ color: theme.node.muted }}>已连 {connectedImageCount} · 完成 {completed}/{table.rows.length}</span>

                {!readOnly ? (
                    <div className="ml-auto flex items-center gap-1.5">
                        <Tooltip title="增量同步画布连线，不会删除已有任务行">
                            <Button size="small" type="text" icon={<Rows3 className="size-3.5" />} onClick={onFillRows}>同步连线</Button>
                        </Tooltip>
                        <Button size="small" type="text" icon={<Plus className="size-3.5" />} onClick={onAddRow}>添加任务</Button>
                        <Button size="small" type="primary" icon={<Play className="size-3.5" />} disabled={!unfinishedReadyCount} onClick={() => onGenerate()}>
                            生成未完成项{unfinishedReadyCount ? ` · ${unfinishedReadyCount}` : ""}
                        </Button>
                    </div>
                ) : null}
            </div>

            <div className="thin-scrollbar min-h-0 flex-1 overflow-auto rounded-b-[inherit]">
                <div className="sticky top-0 z-10 grid min-w-[820px] items-center border-b px-2 py-2 text-[11px] font-medium" style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.muted, gridTemplateColumns }}>
                    <span className="pl-1">任务</span>
                    {referenceColumns.map((column, index) => (
                        <span key={column.id} className="flex min-w-0 flex-col leading-4">
                            <span className="truncate">{column.label}</span>
                            <span className="font-normal opacity-50">{batchReferenceMentionToken(index)}</span>
                        </span>
                    ))}
                    <span>任务提示词</span>
                    <span>生成结果</span>
                    <span className="text-center">操作</span>
                </div>

                {table.rows.length ? (
                    table.rows.map((row, index) => {
                        const output = row.outputNodeId ? nodeById.get(row.outputNodeId) : undefined;
                        const item = batchItemByRowId.get(row.id);
                        const status = row.enabled ? rowStatus(item, output) : { label: "已停用", loading: false, retryable: false };
                        const ready = rowReady(row, table.operation, nodeById);
                        const completedRow = hasNodeMedia(output);
                        const references = batchRowMentionReferences(row, referenceColumns, nodeById);
                        const disabledReason = status.loading ? "当前任务正在生成" : !row.enabled ? "请先启用这一行" : !row.prompt.trim() ? "请填写任务提示词" : table.operation === "try_on" && row.inputNodeIds.length < 2 ? "批量换装至少需要两张参考图" : !ready ? "请补齐有效参考图" : "";
                        return (
                            <div key={row.id} className="group grid min-w-[820px] items-center gap-2 border-b px-2 py-2.5 transition-colors hover:bg-black/[.025] dark:hover:bg-white/[.025]" style={{ borderColor: theme.node.stroke, gridTemplateColumns, opacity: row.enabled ? 1 : 0.58 }}>
                                <div className="flex items-center gap-2 pl-1">
                                    {!readOnly ? <Switch size="small" checked={row.enabled} aria-label={`启用任务 ${index + 1}`} onChange={(enabled) => onUpdateRow(row.id, { enabled })} /> : null}
                                    <span className="tabular-nums" style={{ color: theme.node.muted }}>{index + 1}</span>
                                </div>
                                {referenceColumns.map((column, columnIndex) => <ReferenceThumbnail key={column.id} node={nodeById.get(row.inputNodeIds[columnIndex])} label={batchReferenceMentionToken(columnIndex)} theme={theme} />)}
                                <div className="min-w-0">
                                    <CanvasResourceMentionTextarea
                                        value={row.prompt}
                                        references={references}
                                        readOnly={readOnly}
                                        sendOnEnter={false}
                                        mentionMenuWidth={300}
                                        aria-label={`任务 ${index + 1} 提示词`}
                                        placeholder="描述生成目标，输入 @ 引用本行参考图"
                                        containerClassName="h-[76px]"
                                        className="thin-scrollbar h-full w-full overflow-y-auto rounded-lg border px-3 py-2 text-xs leading-5 outline-none transition-shadow focus-visible:ring-2"
                                        style={{ background: subtleSurface, borderColor: theme.node.stroke, color: theme.node.text }}
                                        onChange={(prompt) => onUpdateRow(row.id, { prompt })}
                                        onSubmit={!readOnly && ready && !status.loading ? () => onGenerate([row.id]) : undefined}
                                        onPointerDown={(event) => event.stopPropagation()}
                                        onWheel={(event) => event.stopPropagation()}
                                    />
                                    <div className="mt-1 flex items-center justify-between px-1 text-[10px]" style={{ color: theme.node.faint }}>
                                        <span>输入 @ 插入参考图</span>
                                        {!readOnly ? <span>⌘/Ctrl + Enter 单行生成</span> : null}
                                    </div>
                                </div>
                                <div className="flex min-w-0 items-center gap-2">
                                    {completedRow ? <CachedResourceImage eager src={output?.metadata?.previewContent || output?.metadata?.content} storageKey={output?.metadata?.storageKey} alt="生成结果" className="size-12 rounded-lg object-cover" fallback={<EmptyThumbnail theme={theme} compact />} /> : <EmptyThumbnail theme={theme} compact />}
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate font-medium" title={status.label}>{status.label}</div>
                                        {!readOnly && status.retryable && batch && item ? <Button type="link" size="small" className="h-auto p-0 text-[11px]" icon={<RefreshCw className="size-3" />} onClick={() => onRetryItem(batch.id, item.id)}>重试</Button> : completedRow ? <span className="text-[10px]" style={{ color: theme.node.muted }}>已关联到画布</span> : null}
                                    </div>
                                    {status.loading ? <LoaderCircle className="size-4 shrink-0 animate-spin" style={{ color: theme.node.muted }} /> : null}
                                </div>
                                {!readOnly ? (
                                    <div className="flex items-center justify-center gap-1">
                                        <Tooltip title={disabledReason || (completedRow ? "重新生成这一行" : "只生成这一行")}>
                                            <Button type={completedRow ? "text" : "primary"} size="small" className="w-8 px-0" disabled={Boolean(disabledReason)} icon={status.loading ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} onClick={() => onGenerate([row.id])} />
                                        </Tooltip>
                                        <Tooltip title="删除这一行"><Button type="text" size="small" className="w-7 px-0 opacity-60 transition-opacity group-hover:opacity-100" danger icon={<Trash2 className="size-3.5" />} onClick={() => onRemoveRow(row.id)} /></Tooltip>
                                    </div>
                                ) : <span />}
                            </div>
                        );
                    })
                ) : (
                    <div className="grid min-h-44 place-items-center px-5 text-center">
                        <div className="flex max-w-sm flex-col items-center gap-2">
                            <div className="grid size-10 place-items-center rounded-xl" style={{ background: theme.accent.primarySoft, color: theme.node.text }}><Rows3 className="size-5" /></div>
                            <div className="font-medium">还没有批量任务</div>
                            <p className="m-0 leading-5" style={{ color: theme.node.muted }}>把图片连接到左侧参考图端口后同步连线，或先添加一行手工配置。</p>
                            {!readOnly ? <Button size="small" icon={<Plus className="size-3.5" />} onClick={onAddRow}>添加第一条任务</Button> : null}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function BatchChoiceGroup({ ariaLabel, options, value, onChange, theme, compact = false, disabled = false }: { ariaLabel: string; options: Array<{ value: string | number; label: string }>; value: string | number; onChange: (value: string | number) => void; theme: CanvasTheme; compact?: boolean; disabled?: boolean }) {
    return (
        <div role="group" aria-label={ariaLabel} className="flex items-center rounded-lg p-0.5" style={{ background: theme.node.panel }}>
            {options.map((option) => {
                const selected = option.value === value;
                return <button key={option.value} type="button" aria-pressed={selected} disabled={disabled} className={`rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${compact ? "min-w-7 px-1.5 py-1 text-[10px]" : "px-2.5 py-1.5 text-[11px]"}`} style={{ background: selected ? theme.accent.primary : "transparent", color: selected ? theme.accent.onPrimary : theme.node.muted }} onClick={() => onChange(option.value)}>{option.label}</button>;
            })}
        </div>
    );
}

function BatchReferenceHandles({ columns, theme, onConnectStart, onConnectDrop }: { columns: ReturnType<typeof batchReferenceColumns>; theme: CanvasTheme; onConnectStart: (event: ReactPointerEvent, handleId: string) => void; onConnectDrop?: (event: ReactPointerEvent, handleId: string) => void }) {
    const commonStyle = { left: 0, width: 36, height: 36, transform: "translate(-50%, -50%)", transformOrigin: "center" };
    return <>{columns.map((column, index) => <BatchReferenceHandle key={column.id} column={column} index={index} theme={theme} commonStyle={commonStyle} onConnectStart={onConnectStart} onConnectDrop={onConnectDrop} />)}</>;
}

function BatchReferenceHandle({ column, index, theme, commonStyle, onConnectStart, onConnectDrop }: { column: { id: string; label: string }; index: number; theme: CanvasTheme; commonStyle: { left: number; width: number; height: number; transform: string; transformOrigin: string }; onConnectStart: (event: ReactPointerEvent, handleId: string) => void; onConnectDrop?: (event: ReactPointerEvent, handleId: string) => void }) {
    const [hovered, setHovered] = useState(false);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const handleId = batchReferenceHandleId(column.id);
    const reset = useCallback(() => { setHovered(false); setOffset({ x: 0, y: 0 }); }, []);
    const update = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const dx = event.clientX - (bounds.left + bounds.width / 2);
        const dy = event.clientY - (bounds.top + bounds.height / 2);
        const limit = 10;
        setOffset({ x: Math.max(-limit, Math.min(limit, dx)), y: Math.max(-limit, Math.min(limit, dy)) });
    }, []);
    return (
        <Tooltip title={`连接到${column.label}`} placement="left">
            <button type="button" aria-label={`${column.label}连线点`} className="group absolute z-[var(--node-z-handle)] grid place-items-center rounded-full outline-none" style={{ ...commonStyle, top: BATCH_REFERENCE_HANDLE_TOP + index * BATCH_REFERENCE_HANDLE_GAP, cursor: "crosshair" }} onPointerEnter={(event) => { setHovered(true); update(event); }} onPointerMove={update} onPointerLeave={reset} onPointerDown={(event) => { event.stopPropagation(); onConnectStart(event, handleId); }} onPointerUp={(event) => { event.stopPropagation(); onConnectDrop?.(event, handleId); }}>
                <span className="grid size-[18px] place-items-center rounded-full border text-[8px] font-semibold shadow-sm transition-transform duration-100 group-hover:scale-125 group-focus-visible:scale-125" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${hovered ? 1.06 : 1})`, background: theme.node.panel, borderColor: theme.accent.primary, color: theme.accent.primary }}>{index + 1}</span>
            </button>
        </Tooltip>
    );
}

function batchRowMentionReferences(row: CanvasBatchRow, columns: ReturnType<typeof batchReferenceColumns>, nodeById: Map<string, CanvasNodeData>): CanvasResourceReference[] {
    return columns.flatMap((column, index) => {
        const source = nodeById.get(row.inputNodeIds[index]);
        if (!source) return [];
        return [{ id: `${row.id}:${column.id}:${source.id}`, nodeId: source.id, kind: "image" as const, label: `参考图${index + 1}`, title: `${column.label} · ${source.title || "图片"}`, previewUrl: source.metadata?.previewContent || source.metadata?.content, storageKey: source.metadata?.storageKey, active: true, sourceType: source.type, mentionToken: batchReferenceMentionToken(index) }];
    });
}

function ReferenceThumbnail({ node, label, theme }: { node?: CanvasNodeData; label: string; theme: CanvasTheme }) {
    if (!node || !hasNodeMedia(node)) return <EmptyThumbnail theme={theme} />;
    const fallback = <EmptyThumbnail theme={theme} />;
    return (
        <Tooltip title={`${label} · ${node.title || "图片"}`}>
            <div className="relative size-14 overflow-hidden rounded-lg border" style={{ borderColor: theme.node.stroke }}>
                <CachedResourceImage eager src={node.metadata?.previewContent || node.metadata?.content} storageKey={node.metadata?.storageKey} alt={node.title || "参考图"} className="size-14 object-cover" fallback={fallback} />
                <span className="absolute bottom-1 left-1 rounded px-1 py-0.5 text-[8px] font-medium text-white" style={{ background: "rgba(0,0,0,.58)" }}>{label}</span>
            </div>
        </Tooltip>
    );
}

function EmptyThumbnail({ theme, compact = false }: { theme: CanvasTheme; compact?: boolean }): ReactNode {
    return <div className={`grid shrink-0 place-items-center rounded-lg border ${compact ? "size-12" : "size-14"}`} style={{ borderColor: theme.node.stroke, color: theme.node.placeholder, background: `color-mix(in srgb, ${theme.node.text} 3%, transparent)` }}><ImageIcon className={compact ? "size-4" : "size-5"} /></div>;
}

function rowReady(row: CanvasBatchRow, operation: CanvasBatchOperation, nodeById: Map<string, CanvasNodeData>) {
    if (!row.enabled || !row.prompt.trim()) return false;
    if (operation === "try_on" && row.inputNodeIds.length < 2) return false;
    if (!row.inputNodeIds.length) return false;
    return row.inputNodeIds.every((id) => hasNodeMedia(nodeById.get(id)));
}

function hasNodeMedia(node?: CanvasNodeData) {
    return Boolean(node?.metadata?.content || node?.metadata?.storageKey);
}

function rowStatus(item: CanvasGenerationBatchItem | undefined, output: CanvasNodeData | undefined) {
    if (hasNodeMedia(output)) return { label: "生成完成", loading: false, retryable: false };
    if (item?.status === "failed") return { label: item.errorDetails || "生成失败", loading: false, retryable: true };
    if (item?.status === "cancelled") return { label: "已停止", loading: false, retryable: false };
    if (item && ["waiting", "submitting", "queued", "running"].includes(item.status)) return { label: item.status === "waiting" ? "等待中" : item.status === "submitting" ? "正在提交" : item.status === "queued" ? "已排队" : "生成中", loading: true, retryable: false };
    if (output?.metadata?.status === "error") return { label: output.metadata.errorDetails || "生成失败", loading: false, retryable: false };
    return { label: "待生成", loading: false, retryable: false };
}
