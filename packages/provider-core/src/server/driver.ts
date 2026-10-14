/**
 * Drivers and instances are plain records: singleton Context tags cannot
 * represent multiple independent instances of the same driver.
 */
import type {
  ProviderConsumeResetCreditOutcome,
  AcpRegistryListSessionsResult,
  AcpRegistryListProvidersResult,
  AcpRegistryOperationError,
  AcpRegistrySetProviderInput,
  ProviderDriverKind,
  ProviderInstanceEnvironment,
  ProviderInstanceId,
  ServerProvider,
  ServerProviderWorkspaceSnapshot,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

import type * as ProviderAdapter from "./ProviderAdapter.ts";
import type { ProviderAuthController } from "./auth.ts";
import type { ProviderDriverError } from "./errors.ts";
import type { ManagedServerProvider } from "./snapshot.ts";
import type { ProviderTextGeneration } from "./textGeneration.ts";
import type { ProviderUsageReader } from "./usage.ts";

/** Static presentation metadata is registered at startup. */
export interface ProviderDriverMetadata {
  readonly displayName: string;
  /** Defaults true; disable for global resources so the registry rejects multiple instances. */
  readonly supportsMultipleInstances?: boolean;
  /** Defaults true; opt out when running requires user-provided configuration. */
  readonly hasDefaultInstance?: boolean;
}

export type ProviderWorkspaceSnapshot = ServerProvider &
  Pick<ServerProviderWorkspaceSnapshot, "slashCommandsPending">;

/**
 * State belongs to the instance's captured closures and creation scope;
 * closing one instance must not affect another.
 */
export interface ProviderInstance {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly continuationIdentity: ProviderContinuationIdentity;
  readonly displayName: string | undefined;
  readonly accentColor?: string | undefined;
  readonly enabled: boolean;
  readonly snapshot: ManagedServerProvider;
  readonly snapshotForCwd?: (
    cwd: string,
  ) => Effect.Effect<ProviderWorkspaceSnapshot, ProviderDriverError>;
  readonly refreshModels?: () => Effect.Effect<void, ProviderDriverError>;
  /** Invalidate T3-owned discovery caches before an explicit provider refresh. */
  readonly invalidateCaches?: Effect.Effect<void>;
  /** Reset credits apply to the account, not a thread; re-probe after redemption. */
  readonly consumeResetCredit?: () => Effect.Effect<
    ProviderConsumeResetCreditOutcome,
    ProviderDriverError
  >;
  readonly orchestrationAdapter: ProviderAdapter.ProviderAdapterV2["Service"];
  readonly textGeneration: ProviderTextGeneration;
  readonly auth?: ProviderAuthController;
  readonly acpSessionManagement?: {
    readonly listSessions: (input: {
      readonly cwd: string;
      readonly cursor?: string;
    }) => Effect.Effect<AcpRegistryListSessionsResult, AcpRegistryOperationError>;
    readonly logout: (cwd: string) => Effect.Effect<void, AcpRegistryOperationError>;
    readonly deleteSession: (input: {
      readonly cwd: string;
      readonly sessionId: string;
    }) => Effect.Effect<void, AcpRegistryOperationError>;
    readonly listProviders: (
      cwd: string,
    ) => Effect.Effect<AcpRegistryListProvidersResult, AcpRegistryOperationError>;
    readonly setProvider: (
      input: Omit<AcpRegistrySetProviderInput, "instanceId" | "projectId"> & {
        readonly cwd: string;
      },
    ) => Effect.Effect<void, AcpRegistryOperationError>;
    readonly disableProvider: (input: {
      readonly cwd: string;
      readonly providerId: string;
    }) => Effect.Effect<void, AcpRegistryOperationError>;
  };
}

export interface ProviderContinuationIdentity {
  readonly driverKind: ProviderDriverKind;
  readonly continuationKey: string;
}

export function defaultProviderContinuationIdentity(input: {
  readonly driverKind: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
}): ProviderContinuationIdentity {
  return {
    driverKind: input.driverKind,
    continuationKey: `${input.driverKind}:instance:${input.instanceId}`,
  };
}

/** The registry decodes config once through configSchema before calling create. */
export interface ProviderDriverCreateInput<Config> {
  readonly instanceId: ProviderInstanceId;
  readonly displayName: string | undefined;
  readonly accentColor?: string | undefined;
  readonly environment: ProviderInstanceEnvironment;
  readonly enabled: boolean;
  readonly config: Config;
}

/**
 * create owns and releases all instance resources when its scope closes.
 * Different instances must never share mutable state.
 */
export interface ProviderDriver<Config, R = never, UsageR = never> {
  readonly driverKind: ProviderDriverKind;
  readonly metadata: ProviderDriverMetadata;
  /**
   * Unknown encoded shape admits defaults/transforms; Codec pins DecodingServices=never
   * so erased Config cannot widen decoder services and poison the R channel.
   */
  readonly configSchema: Schema.Codec<Config, unknown>;
  /** Used when there is no config blob, including unconfigured default instances. */
  readonly defaultConfig: () => Config;
  /**
   * Registry scope closure releases all resources. Return typed failures for
   * unavailable snapshots; create must not throw defects.
   */
  readonly create: (
    input: ProviderDriverCreateInput<Config>,
  ) => Effect.Effect<ProviderInstance, ProviderDriverError, R | Scope.Scope>;
  /** UsageR describes reader dependencies separately from full driver R. */
  readonly usage?: ProviderUsageReader<Config, UsageR>;
}

// Erase Config after registry decoding; unknown would require casts
// when invoking a driver's create with concrete config.
export type AnyProviderDriver<R = never, UsageR = unknown> = ProviderDriver<any, R, UsageR>;

export type ProviderUsageReaderEnv<Driver> =
  Driver extends ProviderDriver<any, any, infer UsageR> ? UsageR : never;
