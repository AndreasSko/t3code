/** Add hosts through source-control packages exporting ./client/definition, then register them here. */
import * as AzureDevOps from "@t3tools/source-control-azure-devops/client/definition";
import * as Bitbucket from "@t3tools/source-control-bitbucket/client/definition";
import {
  makeSourceControlClientRegistry,
  readSourceControlHostSettings,
} from "@t3tools/source-control-core/client/definition";
import type { ServerSettings } from "@t3tools/contracts";

export {
  UNKNOWN_SOURCE_CONTROL_CLIENT,
  type ChangeRequestTerminology,
  type SourceControlClientDefinition,
} from "@t3tools/source-control-core/client/definition";
import * as Forgejo from "@t3tools/source-control-forgejo/client/definition";
import * as GitCafe from "@t3tools/source-control-gitcafe/client/definition";
import * as GitHub from "@t3tools/source-control-github/client/definition";
import * as GitLab from "@t3tools/source-control-gitlab/client/definition";

// GitHub is the fallback for unreported hosts; GitCafe precedes Forgejo because
// its /pulls/ URL matching is hostname-specific while Forgejo accepts any host.
const BUILT_IN_SOURCE_CONTROL_CLIENTS = [
  GitHub.definition,
  GitLab.definition,
  GitCafe.definition,
  Forgejo.definition,
  Bitbucket.definition,
  AzureDevOps.definition,
];

export const sourceControlClients = makeSourceControlClientRegistry(
  BUILT_IN_SOURCE_CONTROL_CLIENTS,
);

export type { GitHubSettings } from "@t3tools/source-control-github/client/definition";

/** Decode saved host choices and tokens; GitHub panels also list gh logins discovered at runtime. */
export function readGitHubSettings(settings: Pick<ServerSettings, "sourceControlHosts">) {
  return readSourceControlHostSettings(GitHub.settings, settings.sourceControlHosts.github);
}
