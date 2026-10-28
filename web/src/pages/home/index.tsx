import { useEffect } from "react";
import { ArrowRight, Moon, Sun } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { BrandLogo } from "@/components/brand/brand-logo";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

import "./home.css";

function BrandMark({ className }: { className: string }) {
    return (
        <svg className={className} viewBox="0 0 100 100" aria-hidden="true">
            <g className="ih-mark-frame">
                <path d="M42.5 13 H29 A16 16 0 0 0 13 29 V42.5" />
                <path d="M13 57.5 V71 A16 16 0 0 0 29 87 H42.5" />
                <path d="M57.5 87 H71 A16 16 0 0 0 87 71 V57.5" />
                <path d="M87 42.5 V29 A16 16 0 0 0 71 13 H57.5" />
            </g>
            <path fill="#FFB43A" d="M50 31 Q52.42 47.58 69 50 Q52.42 52.42 50 69 Q47.58 52.42 31 50 Q47.58 47.58 50 31 Z" />
        </svg>
    );
}

export default function HomePage() {
    const appearance = useAppearanceStore((state) => state.appearance);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const user = useUserStore((state) => state.user);
    const navigate = useNavigate();
    const brandName = appearance.brandName;

    useEffect(() => {
        const previous = document.title;
        document.title = appearance.seoTitle || brandName;
        return () => {
            document.title = previous;
        };
    }, [appearance.seoTitle, brandName]);

    const startCreating = () => {
        navigate(user ? "/workspace" : "/register?from=home");
    };

    return (
        <div className="inspiration-home" data-theme={theme}>
            <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
                <defs>
                    <linearGradient id="ih-gL" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="#6A4CFF" />
                        <stop offset="1" stopColor="#482CDC" />
                    </linearGradient>
                    <linearGradient id="ih-gD" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="#B7A6FF" />
                        <stop offset="1" stopColor="#6A4CFF" />
                    </linearGradient>
                </defs>
            </svg>

            <nav className="ih-nav" aria-label="主导航">
                <div className="ih-wrap">
                    <Link className="ih-brand" to="/" aria-label={brandName}>
                        <BrandLogo className="ih-brand-mark" fallback={<BrandMark className="ih-brand-mark" />} alt="" theme={theme} />
                        <b>{brandName}</b>
                    </Link>
                    <div className="ih-nav-right">
                        {!user ? (
                            <Link className="ih-link-quiet" to="/login?from=home">
                                登录
                            </Link>
                        ) : null}
                        <button type="button" className="ih-theme-toggle" aria-label={theme === "dark" ? "切换到亮色主题" : "切换到暗色主题"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
                            {theme === "dark" ? <Sun /> : <Moon />}
                        </button>
                        <button type="button" className="ih-btn ih-btn-primary ih-btn-sm" onClick={startCreating}>
                            开始创作
                        </button>
                    </div>
                </div>
            </nav>

            <header className="ih-hero">
                <div className="ih-grid-bg" />
                <div className="ih-glow" />
                <div className="ih-glow-gold" />
                <div className="ih-wrap ih-hero-inner">
                    <div className="ih-eyebrow">AI 影视与短剧创作工作台</div>

                    <div style={{ marginTop: 34 }}>
                        <div className="ih-logo-stage">
                            <BrandLogo className="ih-mark-lg" fallback={<BrandMark className="ih-mark-lg" />} alt="" theme={theme} />
                            <div className="ih-wordmark">
                                <span className="ih-cn">{brandName}</span>
                                <span className="ih-en">INSPIRATION CANVAS</span>
                            </div>
                        </div>
                    </div>

                    <h1 className="ih-title">
                        让灵感，<span className="ih-accent">落到画布上</span>。
                    </h1>
                    <p className="ih-lead">
                        一句话写成剧本，一个节点长出镜头。剧本、角色、场景、分镜、成片，
                        <br />
                        全部留在同一块画布上——随时可改，随时回看。
                    </p>

                    <div className="ih-cta-row">
                        <button type="button" className="ih-btn ih-btn-primary" onClick={startCreating}>
                            开始创作
                            <ArrowRight className="ih-arrow" size={17} />
                        </button>
                    </div>

                    <div className="ih-meta-line">
                        <span>无需安装</span>
                        <i />
                        <span>打开浏览器即可创作</span>
                        <i />
                        <span>新用户赠 30 点体验额度</span>
                    </div>
                </div>
            </header>
        </div>
    );
}
