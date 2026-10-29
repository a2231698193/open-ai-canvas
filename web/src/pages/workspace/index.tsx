import { useQuery } from "@tanstack/react-query";
import { App, Button, Skeleton } from "antd";
import { ArrowUpRight } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

import { AppChangelogButton } from "@/components/layout/app-changelog-modal";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { RelativeTime } from "@/components/ui/product/relative-time";
import { formatCredits } from "@/constant/credits";
import { createBlankCanvasProject } from "@/lib/canvas/create-canvas-project";
import { formatTaskKind, generationTaskShowsProgress, generationTaskStatusLabel, generationTaskTitle } from "@/lib/generation-task-display";
import { curatedInspirations, type CreationInspiration } from "@/lib/inspirations/catalog";
import { fillablePrompt } from "@/lib/inspirations/resolve";
import { cn } from "@/lib/utils";
import { getActiveUserScope } from "@/lib/user-scope";
import { CreationRecentCanvases } from "@/pages/create/creation-recent-canvases";
import { isTaskFailed, taskAttentionReason } from "@/pages/tasks/task-shared";
import { listGenerationTasks, type GenerationTask } from "@/services/api/task-center";
import { listRemoteCanvasProjectsPage } from "@/services/api/user-data";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";
import "@/pages/create/creation-product.css";
import "./workspace.css";

const HISTORY_LIMIT = 5;
const LESSONS = [
    { id: "first-image", title: "用一句话生成第一张图" },
    { id: "motion", title: "让镜头动起来" },
    { id: "short-film", title: "把灵感串成一支短片" },
];

export default function WorkspacePageIndex() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const user = useUserStore((state) => state.user);
    const hydrated = useUserStore((state) => state.hydrated);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const canvasHydrated = useCanvasStore((state) => state.hydrated);
    const [creatingCanvas, setCreatingCanvas] = useState(false);
    const creatingCanvasRef = useRef(false);
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    const footerCopyright = useAppearanceStore((state) => state.appearance.footerCopyright);

    const canvasCountQuery = useQuery({
        queryKey: ["workspace-canvas-count", user?.id],
        queryFn: ({ signal }) => listRemoteCanvasProjectsPage({ page: 1, pageSize: 1, sort: "updated", signal }),
        enabled: Boolean(user?.id) && hydrated,
        staleTime: 30_000,
    });
    const taskQuery = useQuery({
        queryKey: ["workspace-recent-tasks", user?.id],
        queryFn: ({ signal }) => listGenerationTasks(100, undefined, undefined, signal),
        enabled: Boolean(user?.id) && hydrated,
        staleTime: 15_000,
    });

    const tasks = taskQuery.data || [];
    const recentTasks = tasks.slice(0, HISTORY_LIMIT);
    const activeTaskCount = tasks.filter((task) => task.status === "queued" || task.status === "running").length;
    const featured = useMemo(() => curatedInspirations.slice(0, 4), []);
    const now = new Date();
    const greeting = now.getHours() < 6 ? "夜深了" : now.getHours() < 12 ? "早上好" : now.getHours() < 18 ? "下午好" : "晚上好";
    const displayName = user?.displayName || user?.username || "创作者";
    const weekStart = now.getTime() - 7 * 24 * 60 * 60 * 1_000;
    const weeklyGenerations = tasks.filter((task) => Date.parse(task.createdAt) >= weekStart).length;
    const copyright = footerCopyright || `© ${now.getFullYear()} ${brandName} · Inspiration Canvas`;

    const startInspiration = (item: CreationInspiration) => {
        navigate("/create", { state: { inspiration: { mode: item.mode, prompt: fillablePrompt(item) } } });
    };

    const createCanvas = async () => {
        if (!user || !canvasHydrated || creatingCanvasRef.current) return;
        creatingCanvasRef.current = true;
        setCreatingCanvas(true);
        try {
            const { id, syncError, scope } = await createBlankCanvasProject();
            if (getActiveUserScope() !== scope || useUserStore.getState().user?.id !== user.id) return;
            if (syncError) message.warning("画布已保存在本机，云端同步尚未完成，将自动重试。");
            navigate(`/canvas/${id}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "创建画布失败，请重试");
        } finally {
            creatingCanvasRef.current = false;
            setCreatingCanvas(false);
        }
    };

    return (
        <WorkspacePage className="workspace-home">
            <section className="workspace-greeting" aria-labelledby="workspace-greeting">
                <div className="workspace-greeting-copy">
                    <span className="workspace-eyebrow">创作台</span>
                    <h1 id="workspace-greeting">
                        {greeting}，{displayName}
                    </h1>
                    <p>今天想从哪一块画布开始？</p>
                </div>
                <div className="workspace-greeting-side">
                    <div className="workspace-stats" aria-label="创作概览">
                        <div className="workspace-stat">
                            <b>{canvasCountQuery.data ? canvasCountQuery.data.total.toLocaleString("zh-CN") : "--"}</b>
                            <span>画布</span>
                        </div>
                        <div className="workspace-stat">
                            <b>{taskQuery.data ? activeTaskCount : "--"}</b>
                            <span>进行中</span>
                        </div>
                        <div className="workspace-stat">
                            <b>{taskQuery.data ? weeklyGenerations : "--"}</b>
                            <span>本周生成</span>
                        </div>
                    </div>
                    <div className="workspace-actions">
                        <Button type="primary" loading={creatingCanvas} disabled={!user || !canvasHydrated} onClick={() => void createCanvas()}>
                            新建画布
                        </Button>
                        <Button onClick={() => navigate("/canvas")}>打开画布</Button>
                    </div>
                </div>
            </section>

            <section className="workspace-section is-first" aria-label="我的画布">
                <CreationRecentCanvases title="我的画布" limit={3} variant="cards" onRequireLogin={() => navigate("/login")} />
            </section>

            <section className="workspace-section" aria-labelledby="workspace-featured-title">
                <header className="workspace-section-heading">
                    <h2 id="workspace-featured-title">创作精选</h2>
                    <Link to="/inspirations" className="workspace-section-link">
                        去灵感大厅
                        <ArrowUpRight aria-hidden="true" />
                    </Link>
                </header>
                <div className="workspace-featured-grid">
                    {featured.map((item) => (
                        <button key={item.title} type="button" className="workspace-featured-card" onClick={() => startInspiration(item)} title={item.description}>
                            <span className="workspace-featured-media">
                                <img src={item.image} alt="" loading="lazy" />
                                <em>{item.mode === "video" ? "视频" : item.mode === "image" ? "图片" : "文本"}</em>
                            </span>
                            <span className="workspace-featured-copy">
                                <strong>{item.title}</strong>
                                <small>{item.mode === "video" ? "视频提示词" : item.mode === "image" ? "图片提示词" : "文本模板"}</small>
                            </span>
                        </button>
                    ))}
                </div>
            </section>

            <section className="workspace-section" aria-labelledby="workspace-history-title">
                <header className="workspace-section-heading">
                    <h2 id="workspace-history-title">创作历史</h2>
                    <Link to="/tasks" className="workspace-section-link">
                        全部任务
                        <ArrowUpRight aria-hidden="true" />
                    </Link>
                </header>
                <div className="workspace-history">
                    <div className="workspace-history-head" aria-hidden="true">
                        <span />
                        <span>任务</span>
                        <span>类型</span>
                        <span>时间</span>
                        <span>积分 / 状态</span>
                    </div>
                    {taskQuery.isPending ? (
                        Array.from({ length: HISTORY_LIMIT }, (_, index) => <Skeleton key={index} active paragraph={{ rows: 1 }} className="workspace-history-skeleton" />)
                    ) : taskQuery.isError ? (
                        <div className="workspace-inline-state">
                            <span>创作历史暂时无法读取</span>
                            <Button size="small" onClick={() => void taskQuery.refetch()} loading={taskQuery.isFetching}>
                                重试
                            </Button>
                        </div>
                    ) : recentTasks.length ? (
                        recentTasks.map((task) => <WorkspaceHistoryRow key={task.id} task={task} creditsEnabled={creditsEnabled} />)
                    ) : (
                        <div className="workspace-inline-state">
                            <span>还没有创作记录，从第一个想法开始吧。</span>
                            <Button size="small" type="primary" loading={creatingCanvas} disabled={!user || !canvasHydrated} onClick={() => void createCanvas()}>
                                去创作
                            </Button>
                        </div>
                    )}
                </div>
            </section>

            <section className="workspace-section" aria-labelledby="workspace-academy-title">
                <header className="workspace-section-heading">
                    <h2 id="workspace-academy-title">新手学园</h2>
                </header>
                <div className="workspace-academy-grid">
                    {LESSONS.map((lesson, index) => (
                        <button key={lesson.id} type="button" className="workspace-lesson" onClick={() => message.info("课程内容待更新，敬请期待")}>
                            <span className="workspace-lesson-head">
                                <span>第 {index + 1} 课</span>
                                <em>待更新</em>
                            </span>
                            <b>{lesson.title}</b>
                            <span className="workspace-lesson-bar" aria-hidden="true">
                                <i style={{ width: "0%" }} />
                            </span>
                        </button>
                    ))}
                    <button type="button" className="workspace-lesson-cta" onClick={() => message.info("课程内容待更新，敬请期待")}>
                        <span>继续学习 · 待更新</span>
                        <em>课程内容准备中</em>
                    </button>
                </div>
            </section>

            <footer className="workspace-home-footer">
                <span>{copyright}</span>
                <div className="workspace-home-footer-links">
                    <AppChangelogButton audience="user" showLabel label="更新日志" className="workspace-home-footer-action" />
                    <Link to="/">关于我们</Link>
                </div>
            </footer>
        </WorkspacePage>
    );
}

function WorkspaceHistoryRow({ task, creditsEnabled }: { task: GenerationTask; creditsEnabled: boolean }) {
    const active = task.status === "queued" || task.status === "running";
    const failed = isTaskFailed(task);
    const billing = task.billing;
    const activeLabel = generationTaskShowsProgress(task) ? `进行中 ${task.progress || 0}%` : generationTaskStatusLabel(task);
    const cost = active ? activeLabel : failed ? (billing?.status === "refunded" ? "已退回" : "失败") : creditsEnabled && billing ? (billing.status === "refunded" ? "已退回" : billing.status === "uncertain" ? "待核对" : `−${formatCredits(billing.amountMicrocredits, 2)}`) : "—";
    const title = generationTaskTitle(task);
    return (
        <Link to="/tasks" className={cn("workspace-history-row", failed && "is-failed")}>
            <span className={cn("workspace-history-status-dot", `is-${task.status}`)} aria-hidden="true" />
            <span className="workspace-history-main">
                <b title={title}>{title}</b>
                {failed ? <small>{taskAttentionReason(task)}</small> : null}
            </span>
            <span className="workspace-history-kind">{formatTaskKind(task)}</span>
            <span className="workspace-history-time">
                <RelativeTime value={task.createdAt} />
            </span>
            <span className={cn("workspace-history-cost", active && "is-active", failed && "is-failed")} title={billing ? `${formatCredits(billing.amountMicrocredits, 6)} 积分` : undefined}>
                {cost}
            </span>
        </Link>
    );
}
