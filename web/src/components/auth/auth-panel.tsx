import { useId } from "react";
import { useTranslation } from "react-i18next";

import { useAuthSettings } from "@/hooks/use-auth-entry";
import type { AuthNavigate, AuthView } from "@/lib/auth-entry";
import { cn } from "@/lib/utils";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useThemePack } from "@/themes/use-theme-pack";
import { AuthLoginForm } from "./auth-login-form";
import { AuthRecoveryForm } from "./auth-recovery-form";
import { WechatRegistrationForm } from "./wechat-registration-form";
import "./auth-panel.css";

export type AuthPanelProps = {
    view: AuthView;
    onViewChange: (view: AuthView) => void;
    next: string;
    onAuthenticated: () => void;
    /** page：独立登录页里的卡片；dialog：登录弹窗右侧，由弹窗提供外壳。 */
    variant: "page" | "dialog";
    /** 微信回跳注册视图由路由页从地址栏判定；弹窗永远为 false，不读取路由上下文。 */
    wechatRegistration: boolean;
    /** 微信注册完成/取消后的跳转；弹窗走入口注入的 router.navigate。 */
    navigate: AuthNavigate;
};

/** 登录注册一体表单与找回密码的共用面板。导航方式由外层决定：独立页面改路由，弹窗只切换视图。 */
export function AuthPanel({ view, onViewChange, next, onAuthenticated, variant, wechatRegistration, navigate }: AuthPanelProps) {
    const { t } = useTranslation();
    const titleId = useId();
    const brand = useAppearanceStore((state) => state.appearance.brandName) || t("auth.register.platform");
    const { settings, failed, reload } = useAuthSettings();
    // 登录与注册是同一个表单；/register 仍保留给推广链接，打开的也是一体表单。
    const themeLoginTitle = useThemePack()?.copy?.loginTitle;
    const title = wechatRegistration ? t("auth.wechat.completeTitle", { defaultValue: "完成微信注册" }) : view === "recovery" ? t("auth.panel.recoveryTitle") : themeLoginTitle || t("auth.panel.loginTitle", { brand });
    const formProps = { settings, next, onAuthenticated, onViewChange };

    return (
        <section className={cn("auth-panel", variant === "page" ? "is-page" : "is-dialog")} aria-labelledby={titleId}>
            <header className="auth-panel-header">
                <h2 id={titleId} className="auth-panel-title">
                    {title}
                </h2>
                {view === "recovery" ? <p className="auth-panel-description">{t("auth.panel.recoveryDescription")}</p> : null}
            </header>
            <div key={view} className="auth-panel-body">
                {wechatRegistration ? (
                    <WechatRegistrationForm settings={settings} settingsFailed={failed} onReloadSettings={() => void reload()} next={next} navigate={navigate} />
                ) : view !== "recovery" ? (
                    <AuthLoginForm {...formProps} settingsFailed={failed} onReloadSettings={() => void reload()} />
                ) : (
                    <AuthRecoveryForm settings={settings} onViewChange={onViewChange} />
                )}
            </div>
        </section>
    );
}
