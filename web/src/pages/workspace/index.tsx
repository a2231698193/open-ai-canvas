import { useQuery } from "@tanstack/react-query";
import { App, Button, Skeleton } from "antd";
import { ArrowRight, ArrowUpRight, BookOpen, Clapperboard, HardDrive, Image as ImageIcon, PanelsTopLeft, PlayCircle, Sparkles, Video, WandSparkles } from "lucide-react";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { RelativeTime } from "@/components/ui/product/relative-time";
import { formatCredits } from "@/constant/credits";
import { useAccountFileStorageUsage } from "@/hooks/use-account-file-storage-usage";
import { accountStorageMeter } from "@/lib/account-storage-usage";
import { formatTaskKind, generationTaskShowsProgress, generationTaskStageLabel, generationTaskStatusLabel } from "@/lib/generation-task-display";
import { curatedInspirations, type CreationInspiration } from "@/lib/inspirations/catalog";
import { fillablePrompt } from "@/lib/inspirations/resolve";
import { progressFillStyle } from "@/lib/progress-fill";
import { cn } from "@/lib/utils";
import { CreationRecentCanvases } from "@/pages/create/creation-recent-canvases";
import { formatModelName, isTaskFailed, taskAttentionReason } from "@/pages/tasks/task-shared";
import { listGenerationTasks, type GenerationTask } from "@/services/api/task-center";
import { listRemoteCanvasProjectsPage } from "@/services/api/user-data";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import "./workspace.css";

const HISTORY_LIMIT = 5;
const LESSONS = [
    { id: "first-image", title: "用一句话生成第一张图", description: "从提示词结构到画面风格，完成第一次图像生成。", kind: "图像", minutes: "8 分钟" },
    { id: "motion", title: "让镜头动起来", description: "学习运镜、时长与首尾帧，做出有节奏的短视频。", kind: "视频", minutes: "12 分钟" },
    { id: "short-film", title: "把灵感串成一支短片", description: "从分镜到成片，把几张画面组织成完整叙事。", kind: "进阶", minutes: "15 分钟" },
];

export default function WorkspacePageIndex() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const user = useUserStore((state) => state.user);
    const hydrated = useUserStore((state) => state.hydrated);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const effectiveConfig = useEffectiveConfig();
    const storageQuery = useAccountFileStorageUsage(Boolean(user));
    const storageMeter = accountStorageMeter(storageQuery.data);

    const canvasCountQuery = useQuery({
        queryKey: ["workspace-canvas-count", user?.id],
        queryFn: ({ signal }) => listRemoteCanvasProjectsPage({ page: 1, pageSize: 1, sort: "updated", signal }),
        enabled: Boolean(user?.id) && hydrated,
        staleTime: 30_000,
    });
    const taskQuery = useQuery({
        queryKey: ["workspace-recent-tasks", user?.id],
        queryFn: ({ signal }) => listGenerationTasks(50, undefined, undefined, signal),
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
    const dateLabel = now.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
    const storageValue = !storageQuery.data ? "--" : storageMeter.state === "read_only" ? "只读" : storageMeter.full ? "已满" : storageMeter.remainingLabel;

    const startInspiration = (item: CreationInspiration) => {
        navigate("/create", { state: { inspiration: { mode: item.mode, prompt: fillablePrompt(item) } } });
    };

    return (
        <WorkspacePage className="workspace-home">
            <section className="workspace-hero" aria-labelledby="workspace-greeting">
                <div className="workspace-hero-copy">
                    <span className="workspace-hero-date">{dateLabel}</span>
                    <h1 id="workspace-greeting">
                        {greeting}，{displayName}
                    </h1>
                    <p>把脑海里的第一个画面交给画布，或者继续上一次没有讲完的故事。</p>
                    <div className="workspace-hero-actions">
                        <Button type="primary" size="large" icon={<WandSparkles />} onClick={() => navigate("/create")}>
                            开始创作
                        </Button>
                        <Button size="large" icon={<PanelsTopLeft />} onClick={() => navigate("/canvas")}>
                            打开画布
                        </Button>
                    </div>
                </div>
                <div className="workspace-hero-stats" aria-label="创作概览">
                    <div className="workspace-stat">
                        <span className="workspace-stat-icon">
                            <PanelsTopLeft />
                        </span>
                        <strong>{canvasCountQuery.data ? canvasCountQuery.data.total.toLocaleString("zh-CN") : "--"}</strong>
                        <span>画布</span>
                    </div>
                    <div className="workspace-stat is-warm">
                        <span className="workspace-stat-icon">
                            <Clapperboard />
                        </span>
                        <strong>{taskQuery.data ? activeTaskCount : "--"}</strong>
                        <span>进行中</span>
                    </div>
                    <div className="workspace-stat is-cool">
                        <span className="workspace-stat-icon">
                            <HardDrive />
                        </span>
                        <strong>{storageValue}</strong>
                        <span>云空间剩余</span>
                    </div>
                </div>
            </section>

            <section className="workspace-section" aria-label="我的画布">
                <CreationRecentCanvases title="我的画布" limit={7} variant="grid" onRequireLogin={() => navigate("/login")} />
            </section>

            <section className="workspace-section" aria-labelledby="workspace-featured-title">
                <header className="workspace-section-heading">
                    <div>
                        <h2 id="workspace-featured-title">
                            <Sparkles aria-hidden="true" />
                            创作精选
                        </h2>
                        <p>挑一个创意起点，点击即可带入创作页。</p>
                    </div>
                    <Link to="/inspirations" className="workspace-section-link">
                        去灵感大厅
                        <ArrowRight aria-hidden="true" />
                    </Link>
                </header>
                <div className="workspace-featured-grid">
                    {featured.map((item) => {
                        const Icon = item.mode === "video" ? Video : item.mode === "image" ? ImageIcon : BookOpen;
                        return (
                            <button key={item.title} type="button" className="workspace-featured-card" onClick={() => startInspiration(item)}>
                                <span className="workspace-featured-media">
                                    <img src={item.image} alt="" loading="lazy" />
                                    <span className="workspace-featured-mode">
                                        <Icon aria-hidden="true" />
                                        {item.mode === "video" ? "视频" : item.mode === "image" ? "图片" : "文本"}
                                    </span>
                                </span>
                                <span className="workspace-featured-copy">
                                    <strong>{item.title}</strong>
                                    <span>{item.description}</span>
                                </span>
                            </button>
                        );
                    })}
                </div>
            </section>

            <section className="workspace-section" aria-labelledby="workspace-history-title">
                <header className="workspace-section-heading">
                    <div>
                        <h2 id="workspace-history-title">
                            <Clapperboard aria-hidden="true" />
                            创作历史
                        </h2>
                        <p>最近 {HISTORY_LIMIT} 次生成记录，点击查看完整任务中心。</p>
                    </div>
                    <Link to="/tasks" className="workspace-section-link">
                        查看全部
                        <ArrowUpRight aria-hidden="true" />
                    </Link>
                </header>
                <div className="workspace-history">
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
                        recentTasks.map((task) => <WorkspaceHistoryRow key={task.id} task={task} config={effectiveConfig} creditsEnabled={creditsEnabled} />)
                    ) : (
                        <div className="workspace-inline-state">
                            <span>还没有创作记录，从第一个想法开始吧。</span>
                            <Button size="small" type="primary" onClick={() => navigate("/create")}>
                                去创作
                            </Button>
                        </div>
                    )}
                </div>
            </section>

            <section className="workspace-section" aria-labelledby="workspace-academy-title">
                <header className="workspace-section-heading">
                    <div>
                        <h2 id="workspace-academy-title">
                            <BookOpen aria-hidden="true" />
                            新手学园
                        </h2>
                        <p>三节入门课，带你从一句话走到一支短片。</p>
                    </div>
                </header>
                <div className="workspace-academy-grid">
                    {LESSONS.map((lesson, index) => (
                        <button key={lesson.id} type="button" className="workspace-lesson" onClick={() => message.info("课程内容待更新，敬请期待")}>
                            <span className="workspace-lesson-index">{String(index + 1).padStart(2, "0")}</span>
                            <span className="workspace-lesson-body">
                                <span className="workspace-lesson-meta">
                                    <em>{lesson.kind}</em>
                                    <span>{lesson.minutes}</span>
                                </span>
                                <strong>{lesson.title}</strong>
                                <span>{lesson.description}</span>
                            </span>
                            <span className="workspace-lesson-play" aria-hidden="true">
                                <PlayCircle />
                            </span>
                        </button>
                    ))}
                </div>
            </section>
        </WorkspacePage>
    );
}

function WorkspaceHistoryRow({ task, config, creditsEnabled }: { task: GenerationTask; config: ReturnType<typeof useEffectiveConfig>; creditsEnabled: boolean }) {
    const active = task.status === "queued" || task.status === "running";
    const failed = isTaskFailed(task);
    const stageLabel = generationTaskStageLabel(task);
    const showsProgress = generationTaskShowsProgress(task);
    const billing = task.billing;
    return (
        <Link to="/tasks" className={cn("workspace-history-row", failed && "is-failed")}>
            <span className={cn("workspace-history-status-dot", `is-${task.status}`)} aria-hidden="true" />
            <span className="workspace-history-main">
                <strong title={task.prompt}>{task.prompt || "未命名任务"}</strong>
                <span className="workspace-history-meta">
                    {formatTaskKind(task)} · {generationTaskStatusLabel(task)} · {formatModelName(config, task)}
                </span>
                {active ? (
                    <span className="workspace-history-progress">
                        <span>{stageLabel}</span>
                        {showsProgress ? (
                            <span className="workspace-history-track" role="progressbar" aria-label={stageLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress || 0}>
                                <i style={progressFillStyle(task.progress || 0)} />
                            </span>
                        ) : null}
                        {showsProgress ? <b>{task.progress || 0}%</b> : null}
                    </span>
                ) : failed ? (
                    <span className="workspace-history-error">{taskAttentionReason(task)}</span>
                ) : null}
            </span>
            <span className="workspace-history-time">
                <RelativeTime value={task.createdAt} />
            </span>
            <span className={cn("workspace-history-credits", billing?.status === "refunded" && "is-refunded")}>
                {creditsEnabled && billing ? (
                    <>
                        <strong>{formatCredits(billing.amountMicrocredits)}</strong>
                        <small>{billing.status === "settled" ? "已结算" : billing.status === "refunded" ? "已退回" : billing.status === "uncertain" ? "待核对" : "预计"}</small>
                    </>
                ) : (
                    <small>—</small>
                )}
            </span>
        </Link>
    );
}
