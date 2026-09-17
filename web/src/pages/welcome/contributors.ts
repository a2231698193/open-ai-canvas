import contributorsMarkdown from "../../../../CONTRIBUTORS.md?raw";

import { parseContributors } from "./contributors-parse";

const contributorAvatarModules = import.meta.glob("../../../../assets/user-*", {
    eager: true,
    import: "default",
    query: "?url",
}) as Record<string, string>;

export type { WelcomeContributor } from "./contributors-parse";

export const welcomeContributors = parseContributors(contributorsMarkdown, (avatarPath) => contributorAvatarModules[`../../../../${avatarPath}`]);
