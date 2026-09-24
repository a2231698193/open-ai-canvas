import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import { installChunkRecovery } from "@/lib/chunk-recovery";
import { bootstrapAppearance } from "@/services/appearance-bootstrap";
import { isIsolatedDirectorRepro } from "@/lib/dev-repro";

installChunkRecovery();

// The public film entry checks its availability independently of workspace bootstrap.
if (/^\/welcome\/?$/.test(window.location.pathname)) void import("./welcome-application");
else {
    // The backend-free DEV lab must not make requests before AppProviders isolates it.
    const appearanceReady = isIsolatedDirectorRepro(import.meta.env.DEV, window.location.pathname) ? Promise.resolve() : bootstrapAppearance();
    // 本仓库刻意先等外观：首屏 HTML 是品牌中性的，等它回来再挂应用，避免先闪一下默认品牌再切到自定义外观。
    // bootstrapAppearance 自带 4 秒超时并回退默认外观，所以外观接口异常时最多晚 4 秒，不会白屏。
    void appearanceReady.finally(() => import("./application"));
}
