import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import { runLocalRuntimeBootstrap } from "@/services/local-runtime-bootstrap";
import { bootstrapAppearance } from "@/services/appearance-bootstrap";

runLocalRuntimeBootstrap(
    {
        get href() {
            return window.location.href;
        },
        replaceUrl(url) {
            window.history.replaceState(window.history.state, "", url);
        },
        removeStorageItem(key) {
            window.localStorage.removeItem(key);
        },
    },
    () => {
        // Keep the public film page independent of workspace and appearance requests.
        if (/^\/welcome\/?$/.test(window.location.pathname)) void import("./welcome-application");
        else void bootstrapAppearance().finally(() => import("./application"));
    },
);
