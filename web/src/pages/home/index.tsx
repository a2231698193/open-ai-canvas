import { lazy, Suspense } from "react";

import { FullScreenLoader, WorkspaceRouteLoader } from "@/components/ui/aceternity/full-screen-loader";
import { loadCreatePage } from "@/lib/workspace-route-modules";
import { useUserStore } from "@/stores/use-user-store";

import { PublicLanding } from "./public-landing";

const UserLayout = lazy(() => import("@/layouts/user-layout"));
const CreatePage = lazy(loadCreatePage);

export default function RootHome() {
    const hydrated = useUserStore((state) => state.hydrated);
    const user = useUserStore((state) => state.user);

    if (!hydrated) return <FullScreenLoader />;
    if (!user) return <PublicLanding />;

    return (
        <Suspense fallback={<WorkspaceRouteLoader label="正在打开创作空间" />}>
            <UserLayout>
                <CreatePage />
            </UserLayout>
        </Suspense>
    );
}
