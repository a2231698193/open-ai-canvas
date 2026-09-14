import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import { bootstrapAppearance } from "@/services/appearance-bootstrap";

// Keep the public film page independent of workspace and appearance requests.
if (/^\/welcome\/?$/.test(window.location.pathname)) void import("./welcome-application");
else void bootstrapAppearance().finally(() => import("./application"));
