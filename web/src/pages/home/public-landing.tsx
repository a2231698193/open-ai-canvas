import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useReducedMotion } from "motion/react";

import { BrandLogo } from "@/components/brand/brand-logo";
import { SiteComplianceFooter } from "@/components/layout/site-compliance-footer";
import { getAuthSettings } from "@/services/api/auth";
import { useAppearanceStore } from "@/stores/use-appearance-store";

const STILLS = [
    { id: "canvas", label: "画布", cells: 3 },
    { id: "assets", label: "资产", cells: 2 },
    { id: "shots", label: "分镜", cells: 4 },
] as const;

export function PublicLanding() {
    const appearance = useAppearanceStore((state) => state.appearance);
    const reducedMotion = useReducedMotion();
    const videoRef = useRef<HTMLVideoElement>(null);
    const [manualVideoActive, setManualVideoActive] = useState(false);
    const [failedPosterURL, setFailedPosterURL] = useState("");
    const [registrationEnabled, setRegistrationEnabled] = useState(false);
    const automaticVideoActive = appearance.authVideoAutoplay && !reducedMotion;
    const videoActive = Boolean(appearance.authVideoUrl && (automaticVideoActive || manualVideoActive));
    const enterTo = "/login?next=%2F";

    useEffect(() => {
        setManualVideoActive(false);
    }, [appearance.authVideoUrl, appearance.authVideoAutoplay]);

    useEffect(() => {
        let cancelled = false;
        void getAuthSettings()
            .then((settings) => {
                if (!cancelled) setRegistrationEnabled(settings.registrationEnabled || settings.firstUser);
            })
            .catch(() => {
                if (!cancelled) setRegistrationEnabled(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const playVideo = () => {
        setManualVideoActive(true);
        requestAnimationFrame(() => {
            void videoRef.current?.play().catch(() => undefined);
        });
    };

    return (
        <main className="public-stage">
            {videoActive && appearance.authVideoUrl ? (
                <video ref={videoRef} className="public-stage-media" src={appearance.authVideoUrl} poster={appearance.authVideoPosterUrl || undefined} autoPlay muted loop playsInline preload="metadata" />
            ) : appearance.authVideoPosterUrl && failedPosterURL !== appearance.authVideoPosterUrl ? (
                <img className="public-stage-media" src={appearance.authVideoPosterUrl} alt="" decoding="async" onError={() => setFailedPosterURL(appearance.authVideoPosterUrl)} />
            ) : null}
            <div className="public-stage-veil" aria-hidden="true" />

            <header className="public-stage-bar">
                <span className="public-stage-brand">
                    <BrandLogo
                        theme="dark"
                        className="size-7"
                        alt=""
                        fallback={<span className="size-7 bg-current" style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} />}
                    />
                    {appearance.brandName}
                </span>
                <nav className="public-stage-nav" aria-label="账户">
                    {appearance.authVideoUrl && !videoActive ? (
                        <button type="button" className="public-stage-ghost" onClick={playVideo}>
                            播放品牌影片
                        </button>
                    ) : null}
                    <Link to={enterTo} className="public-stage-ghost">
                        登录
                    </Link>
                </nav>
            </header>

            <section className="public-stage-hero">
                <h1>{appearance.authHeroTitle}</h1>
                {appearance.authHeroDescription ? <p>{appearance.authHeroDescription}</p> : <p>剧本、分镜、资产与生成，同一条画布。</p>}
                <div className="public-stage-actions">
                    <Link to={enterTo} className="public-stage-enter">
                        进入工作台
                    </Link>
                    {registrationEnabled ? (
                        <Link to="/register?next=%2F" className="public-stage-ghost">
                            注册
                        </Link>
                    ) : null}
                </div>
            </section>

            <div className="public-stage-strip" aria-label="工作台现场">
                {STILLS.map((still) => (
                    <figure key={still.id} className={`public-stage-frame is-${still.id}`}>
                        <span className="public-stage-sprocket" aria-hidden="true" />
                        <span className="public-stage-cells" aria-hidden="true">
                            {Array.from({ length: still.cells }, (_, index) => (
                                <i key={index} />
                            ))}
                        </span>
                        <figcaption>{still.label}</figcaption>
                    </figure>
                ))}
            </div>

            <SiteComplianceFooter variant="auth" className="public-stage-foot" />
        </main>
    );
}
