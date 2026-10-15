import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  ForwardCompatibleOptional,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

/** Wire version for orchestration snapshots, streams, commands, and RPC payloads. */
export const ORCHESTRATION_PROTOCOL_VERSION = 2;
export const ORCHESTRATION_PROTOCOL_VERSION_TEXT = "2";
export const ORCHESTRATION_PROTOCOL_QUERY_PARAM = "orchestrationProtocol";
export const ORCHESTRATION_PROTOCOL_HEADER = "x-t3-orchestration-protocol";

export const ExecutionEnvironmentPlatformOs = Schema.Literals([
  "darwin",
  "linux",
  "windows",
  "unknown",
]);
export type ExecutionEnvironmentPlatformOs = typeof ExecutionEnvironmentPlatformOs.Type;

export const ExecutionEnvironmentPlatformArch = Schema.Literals(["arm64", "x64", "other"]);
export type ExecutionEnvironmentPlatformArch = typeof ExecutionEnvironmentPlatformArch.Type;

/** Detected hardware icons may be overridden by the environmentIcon setting. */
export const ENVIRONMENT_MACHINE_KINDS = [
  "server",
  "cloud",
  "linux",
  "desktop",
  "laptop",
  "mac-mini",
  "mac-studio",
] as const;
export const EnvironmentMachineKind = Schema.Literals(ENVIRONMENT_MACHINE_KINDS);
export type EnvironmentMachineKind = typeof EnvironmentMachineKind.Type;
export const isEnvironmentMachineKind = Schema.is(EnvironmentMachineKind);

export const ExecutionEnvironmentPlatform = Schema.Struct({
  os: ExecutionEnvironmentPlatformOs,
  arch: ExecutionEnvironmentPlatformArch,
  /** Absent on Windows or without usable container/DMI signals; older servers and unknown kinds also omit it. */
  machine: ForwardCompatibleOptional(EnvironmentMachineKind),
});

// Lives outside settings so orchestration can reference workspace mode without an import cycle.
export const ThreadEnvMode = Schema.Literals(["local", "worktree"]);
export type ThreadEnvMode = typeof ThreadEnvMode.Type;

/** Recursive submodules include nested levels; top-level includes only this repository's declarations. */
export const WorktreeSubmodules = Schema.Literals(["recursive", "top-level", "none"]);
export type WorktreeSubmodules = typeof WorktreeSubmodules.Type;
export type ExecutionEnvironmentPlatform = typeof ExecutionEnvironmentPlatform.Type;

/** boot-service uses the launcher; respawn remains readable for legacy hosts; desktop-app updates its supervisor. */
export const ServerSelfUpdateMethod = Schema.Literals(["boot-service", "respawn", "desktop-app"]);
export type ServerSelfUpdateMethod = typeof ServerSelfUpdateMethod.Type;

/** Proven ownership for a manual update; unknown installs omit this descriptor. */
export const ServerInstallation = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["npx", "pnpm-dlx", "bunx"]) }),
  Schema.Struct({ kind: Schema.Literal("npm-global"), prefix: TrimmedNonEmptyString }),
]);
export type ServerInstallation = typeof ServerInstallation.Type;

/** desktop-managed requires updating the supervising app; other paths trigger server RPC updates. */
export const ServerSelfUpdateCapability = Schema.Literals([
  "boot-service",
  "respawn",
  "desktop-managed",
]);
export type ServerSelfUpdateCapability = typeof ServerSelfUpdateCapability.Type;

export const ExecutionEnvironmentCapabilities = Schema.Struct({
  repositoryIdentity: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  connectionProbe: Schema.optionalKey(Schema.Boolean),
  /** Missing on older servers, which still accept inline image attachments. */
  attachmentUploads: Schema.optionalKey(Schema.Boolean),
  questionAttachments: Schema.optionalKey(Schema.Boolean),
  /** Missing on servers that only accept image attachments. */
  fileAttachments: Schema.optionalKey(
    Schema.Struct({
      maxUploadBytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    }),
  ),
  /** Missing means unsupported; clients must not probe pull request APIs. */
  pullRequests: Schema.optionalKey(Schema.Boolean),
  pullRequestChecks: Schema.optionalKey(Schema.Boolean),
  /** Missing requires legacy context serialization because older servers forward canonical links as literal text. */
  inlineMessageContext: Schema.optionalKey(Schema.Boolean),
  /** Reject required worktree failures instead of falling back to the project checkout. */
  requiredWorktreeBootstrap: Schema.optionalKey(Schema.Boolean),
  /** Missing means unsupported; do not send settle/unsettle under version skew. */
  threadSettlement: Schema.optionalKey(Schema.Boolean),
  threadAutoSettlement: Schema.optionalKey(Schema.Boolean),
  storageCleanup: Schema.optionalKey(Schema.Boolean),
  storageCleanupRun: Schema.optionalKey(Schema.Boolean),
  otlpEndpointCheck: Schema.optionalKey(Schema.Boolean),
  projectWorktreeCleanup: Schema.optionalKey(Schema.Boolean),
  settledWorktreeCleanup: Schema.optionalKey(Schema.Boolean),
  /** Server honors the `worktreesDirectory` setting. */
  worktreesDirectory: Schema.optionalKey(Schema.Boolean),
  /** Server can exclude PR-linked threads from inactivity settlement. */
  threadAutoSettlementScope: Schema.optionalKey(Schema.Boolean),
  /** Server persists the opt-in for continuing interrupted threads after restarts. */
  threadRestartContinuation: Schema.optionalKey(Schema.Boolean),
  /** Server resolves `projectSettingsOverrides`; older servers ignore the key. */
  projectSettingsOverrides: Schema.optionalKey(Schema.Boolean),
  /** Hide unsupported per-project provider switches because older servers silently discard their patches. */
  projectProviderInstanceOverrides: Schema.optionalKey(Schema.Boolean),
  /** Missing means unsupported, as with threadSettlement. */
  threadSnooze: Schema.optionalKey(Schema.Boolean),
  /** Clear published themes when missing; older servers cannot stream removals. */
  environmentThemes: Schema.optionalKey(Schema.Boolean),
  /** Server streams quota from configured usage-limit sources. Same
      version-skew contract as environmentThemes. */
  usageLimitSources: Schema.optionalKey(Schema.Boolean),
  usagePriceOverrides: Schema.optionalKey(Schema.Boolean),
  usageModelAliases: Schema.optionalKey(Schema.Boolean),
  /** Missing means unsupported, as with threadSettlement. */
  threadPinning: Schema.optionalKey(Schema.Boolean),
  /** Enables orderKey on pin and pin.reorder; missing means unsupported. */
  threadPinReorder: Schema.optionalKey(Schema.Boolean),
  threadActiveReorder: Schema.optionalKey(Schema.Boolean),
  /** Enables per-thread auto-settle opt-out; missing means unsupported. */
  threadAutoSettleOptOut: Schema.optionalKey(Schema.Boolean),
  /** Hide title regeneration when missing. */
  threadTitleRegeneration: Schema.optionalKey(Schema.Boolean),
  /** Missing visited tracking requires local state fallback. */
  threadVisitedTracking: Schema.optionalKey(Schema.Boolean),
  threadPullRequestLinking: Schema.optionalKey(Schema.Boolean),
  /** Without this, clients shape delivery/model context and validate rollback readiness from projections. */
  serverResolvedCommandContext: Schema.optionalKey(Schema.Boolean),
  threadPullRequests: Schema.optionalKey(Schema.Boolean),
  threadPullRequestWatch: Schema.optionalKey(Schema.Boolean),
  pullRequestStackActions: Schema.optionalKey(Schema.Boolean),
  /** Missing requires manual relaunch, e.g. dev checkouts and Windows foreground installs. */
  serverSelfUpdate: Schema.optionalKey(ServerSelfUpdateCapability),
  /** Manual commands must update this install, not the host's default global prefix. */
  serverInstallation: ForwardCompatibleOptional(ServerInstallation),
  /** Server can stream self-update progress before acknowledging the
      restart. Clients fall back to server.updateServer when absent. */
  serverSelfUpdateProgress: Schema.optionalKey(Schema.Boolean),
  /** Running provider turns can be durably continued after self-update. */
  serverUpdateThreadContinuation: Schema.optionalKey(Schema.Boolean),
  /** Only explicit false suppresses Live Activity seeding; older servers may publish without this field. */
  agentActivityPublishing: Schema.optionalKey(Schema.Boolean),
  /** Missing clone tracking requires the blocking sourceControl.cloneRepository fallback. */
  projectCloneTracking: Schema.optionalKey(Schema.Boolean),
  /** Missing leaves the icon picker inert because older servers discard its setting. */
  environmentIcon: Schema.optionalKey(Schema.Boolean),
  /** Missing remote desktop updates require updating the app on its own machine. */
  desktopAppUpdate: Schema.optionalKey(Schema.Boolean),
  /** Clients without local browsers use streamed server tabs at /api/preview-stream. */
  serverBrowser: Schema.optionalKey(Schema.Boolean),
});
export type ExecutionEnvironmentCapabilities = typeof ExecutionEnvironmentCapabilities.Type;

export const ExecutionEnvironmentDescriptor = Schema.Struct({
  environmentId: EnvironmentId,
  label: TrimmedNonEmptyString,
  platform: ExecutionEnvironmentPlatform,
  serverVersion: TrimmedNonEmptyString,
  /** Absent on hosts from before explicit orchestration protocol negotiation. */
  orchestrationProtocolVersion: Schema.optionalKey(Schema.Int),
  capabilities: ExecutionEnvironmentCapabilities,
});
export type ExecutionEnvironmentDescriptor = typeof ExecutionEnvironmentDescriptor.Type;

export const RepositoryIdentityLocator = Schema.Struct({
  source: Schema.Literal("git-remote"),
  remoteName: TrimmedNonEmptyString,
  remoteUrl: TrimmedNonEmptyString,
});
export type RepositoryIdentityLocator = typeof RepositoryIdentityLocator.Type;

/** Fork origin stays distinct for client grouping while pull request features use canonical identity. */
export const RepositoryOrigin = Schema.Struct({
  canonicalKey: TrimmedNonEmptyString,
  displayName: Schema.optionalKey(TrimmedNonEmptyString),
});
export type RepositoryOrigin = typeof RepositoryOrigin.Type;

export const RepositoryIdentity = Schema.Struct({
  canonicalKey: TrimmedNonEmptyString,
  locator: RepositoryIdentityLocator,
  /** Repository browser URL resolved from the server's configured hosting account. */
  webUrl: Schema.optionalKey(TrimmedNonEmptyString),
  rootPath: Schema.optionalKey(TrimmedNonEmptyString),
  displayName: Schema.optionalKey(TrimmedNonEmptyString),
  provider: Schema.optionalKey(TrimmedNonEmptyString),
  owner: Schema.optionalKey(TrimmedNonEmptyString),
  name: Schema.optionalKey(TrimmedNonEmptyString),
  origin: Schema.optionalKey(RepositoryOrigin),
});
export type RepositoryIdentity = typeof RepositoryIdentity.Type;

/** Key clients group checkouts by: a fork's own remote, otherwise the canonical repository. */
export function repositoryGroupingKeyOf(identity: RepositoryIdentity): string {
  return identity.origin?.canonicalKey ?? identity.canonicalKey;
}

export function repositoryGroupingDisplayNameOf(identity: RepositoryIdentity): string | undefined {
  return identity.origin
    ? (identity.origin.displayName ?? identity.origin.canonicalKey)
    : identity.displayName;
}

export const ScopedProjectRef = Schema.Struct({
  environmentId: EnvironmentId,
  projectId: ProjectId,
});
export type ScopedProjectRef = typeof ScopedProjectRef.Type;

export const ScopedThreadRef = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
});
export type ScopedThreadRef = typeof ScopedThreadRef.Type;
