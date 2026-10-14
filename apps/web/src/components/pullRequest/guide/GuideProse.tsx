import type { EnvironmentId } from "@t3tools/contracts";
import { createContext, useContext } from "react";

import { cn } from "~/lib/utils";

import { PullRequestMarkdown } from "../PullRequestMarkdown";

export const GuideProseContext = createContext<{
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
} | null>(null);

/** The plain form omits links for prose nested in controls, where links cannot nest in buttons. */
export function GuideProse({
  text,
  plain = false,
  className,
}: {
  text: string;
  plain?: boolean;
  className?: string;
}) {
  const context = useContext(GuideProseContext);
  if (plain || context === null) return text;
  return (
    <PullRequestMarkdown
      text={text}
      cwd={context.cwd}
      environmentId={context.environmentId}
      // The element around it sets size and colour; the description's spacing is for a page.
      className={cn("space-y-0 [&_.chat-markdown]:text-inherit", className)}
    />
  );
}
