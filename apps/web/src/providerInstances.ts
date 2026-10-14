import {
  DEFAULT_MODEL_BY_PROVIDER,
  defaultInstanceIdForDriver,
  resolveProjectProviderInstanceEnabled,
  type ModelSelection,
  type ProjectId,
  type ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
  type ServerSettings,
  type ServerProviderState,
} from "@t3tools/contracts";
import {
  normalizeProviderAccentColor,
  resolveProviderInstanceDisplayName,
  shouldShowInstanceBadge,
} from "@t3tools/client-runtime/state/provider-instance-display";

export { normalizeProviderAccentColor, shouldShowInstanceBadge };

/** Never persist or dispatch this placeholder; disable send until a live provider replaces it. */
export const NO_PROVIDER_MODEL_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("t3code_no_provider"),
  model: "",
};

export interface ProviderInstanceEntry {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly accentColor?: string | undefined;
  /** Registry identity used to resolve the official icon for generic ACP instances. */
  readonly acpRegistryAgentId?: string | undefined;
  /** Catalog-advertised icon URL. The renderer still applies the official-CDN allowlist. */
  readonly acpRegistryIconUrl?: string | undefined;
  readonly continuationGroupKey?: string | undefined;
  readonly enabled: boolean;
  readonly installed: boolean;
  readonly status: ServerProviderState;
  /** Default instance ids equal defaultInstanceIdForDriver; pickers sort them before custom accounts. */
  readonly isDefault: boolean;
  readonly isAvailable: boolean;
  readonly snapshot: ServerProvider;
  readonly models: ReadonlyArray<ServerProviderModel>;
}

export type ProviderCatalogAvailability = "loading" | "ready" | "unavailable" | "unconfigured";

/** Null means the catalog has not arrived, not that no provider exists; do not strand recoverable threads. */
export function resolveProviderCatalogAvailability(input: {
  readonly catalogLoaded: boolean;
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
  readonly selectedEntry: ProviderInstanceEntry | undefined;
}): ProviderCatalogAvailability {
  if (!input.catalogLoaded) return "loading";
  if (input.selectedEntry !== undefined) return "ready";
  return input.entries.length === 0 ? "unconfigured" : "unavailable";
}

/** Enabled updates independently of probe status, which can still report ready after disabling. */
export function isProviderInstancePickerReady(entry: ProviderInstanceEntry): boolean {
  return entry.enabled && entry.isAvailable && entry.status === "ready";
}

export function isProviderInstancePickerVisible(entry: ProviderInstanceEntry): boolean {
  return entry.enabled;
}

/** Preserve server order; call sortProviderInstanceEntries for default-first presentation. */
export function deriveProviderInstanceEntries(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ProviderInstanceEntry> {
  return providers.map((snapshot) => {
    const instanceId = snapshot.instanceId;
    const driverKind = snapshot.driver;
    const defaultId = defaultInstanceIdForDriver(driverKind);
    const isDefault = instanceId === defaultId;
    return {
      instanceId,
      driverKind,
      displayName: resolveProviderInstanceDisplayName(snapshot),
      accentColor: normalizeProviderAccentColor(snapshot.accentColor),
      ...(driverKind === "acpRegistry" && snapshot.iconUrl
        ? { acpRegistryIconUrl: snapshot.iconUrl }
        : {}),
      continuationGroupKey: snapshot.continuation?.groupKey,
      enabled: snapshot.enabled,
      installed: snapshot.installed,
      status: snapshot.status,
      isDefault,
      isAvailable: snapshot.availability !== "unavailable",
      snapshot,
      models: snapshot.models,
    } satisfies ProviderInstanceEntry;
  });
}

/**
 * Instance ids repeat across environments; keep nested lookups scoped to the thread's environment so
 * accounts and accent colors cannot clobber each other.
 */
export function deriveProviderEntriesByEnvironment(
  providersByEnvironment: Iterable<
    readonly [
      string,
      ReadonlyArray<ServerProvider>,
      Pick<ServerSettings, "providerInstances" | "projectSettingsOverrides">?,
    ]
  >,
): ReadonlyMap<string, ReadonlyMap<string, ProviderInstanceEntry>> {
  const byEnvironment = new Map<string, ReadonlyMap<string, ProviderInstanceEntry>>();
  for (const [environmentId, providers, settings] of providersByEnvironment) {
    const derived = deriveProviderInstanceEntries(providers);
    // One map per environment serves every project with a thread there, so
    // there is no single project to scope `enabled` to; it stays machine-wide.
    const entries = settings ? applyProviderInstanceSettings(derived, settings, null) : derived;
    byEnvironment.set(
      environmentId,
      new Map(entries.map((entry) => [entry.instanceId as string, entry] as const)),
    );
  }
  return byEnvironment;
}

/**
 * Settings override lagging probes; missing non-default entries are disabled. Pass projectId for project
 * overrides or explicit null for machine settings so omission cannot silently ignore enablement.
 */
export function applyProviderInstanceSettings(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  settings: Pick<ServerSettings, "providerInstances" | "projectSettingsOverrides">,
  projectId: ProjectId | null,
): ReadonlyArray<ProviderInstanceEntry> {
  return entries.map((entry) => {
    const explicitInstance = Object.hasOwn(settings.providerInstances, entry.instanceId)
      ? settings.providerInstances[entry.instanceId]
      : undefined;
    const enabled = resolveProjectProviderInstanceEnabled(settings, projectId, entry.instanceId);
    if (entry.driverKind !== "acpRegistry" || explicitInstance === undefined) {
      return enabled === entry.enabled ? entry : { ...entry, enabled };
    }
    const config =
      explicitInstance.config !== null && typeof explicitInstance.config === "object"
        ? (explicitInstance.config as Readonly<Record<string, unknown>>)
        : null;
    if (config?.source === "local") {
      return { ...entry, enabled, acpRegistryAgentId: undefined, acpRegistryIconUrl: undefined };
    }
    const agentId = config?.agentId;
    const iconUrl = config?.registryIconUrl;
    return {
      ...entry,
      enabled,
      ...(typeof agentId === "string" && agentId.trim()
        ? { acpRegistryAgentId: agentId.trim() }
        : {}),
      ...(typeof iconUrl === "string" && iconUrl.trim()
        ? { acpRegistryIconUrl: iconUrl.trim() }
        : {}),
    };
  });
}

/** Defaults first within each driver; preserve server ordering among custom accounts and across drivers. */
export function sortProviderInstanceEntries(
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ReadonlyArray<ProviderInstanceEntry> {
  const byKind = new Map<ProviderDriverKind, ProviderInstanceEntry[]>();
  for (const entry of entries) {
    const bucket = byKind.get(entry.driverKind);
    if (bucket) {
      bucket.push(entry);
    } else {
      byKind.set(entry.driverKind, [entry]);
    }
  }
  const sorted: ProviderInstanceEntry[] = [];
  for (const bucket of byKind.values()) {
    const defaults = bucket.filter((entry) => entry.isDefault);
    const customs = bucket.filter((entry) => !entry.isDefault);
    sorted.push(...defaults, ...customs);
  }
  return sorted;
}

/** Require exact instanceId; UI routing must not infer a missing instance from its driver kind. */
export function getProviderInstanceEntry(
  providers: ReadonlyArray<ServerProvider>,
  instanceId: ProviderInstanceId,
): ProviderInstanceEntry | undefined {
  return deriveProviderInstanceEntries(providers).find((entry) => entry.instanceId === instanceId);
}

/**
 * Use the instance's own default/catalog before driver fallback because accounts can serve different
 * models.
 */
export function getDefaultProviderInstanceModel(
  providers: ReadonlyArray<ServerProvider>,
  instanceId: ProviderInstanceId,
): string | undefined {
  const entry = getProviderInstanceEntry(providers, instanceId);
  if (!entry) return undefined;
  return (
    entry.models.find((model) => model.isDefault && !model.isCustom)?.slug ??
    entry.models.find((model) => !model.isCustom)?.slug ??
    entry.models[0]?.slug ??
    DEFAULT_MODEL_BY_PROVIDER[entry.driverKind]
  );
}

const isSelectableProviderInstanceEntry = (entry: ProviderInstanceEntry): boolean =>
  entry.enabled && entry.isAvailable;

/** Fallback prefers ready/non-error entries; retain an errored provider only when explicitly requested. */
export function resolveSelectableProviderInstanceEntry(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  instanceId: ProviderInstanceId | undefined,
): ProviderInstanceEntry | undefined {
  if (instanceId !== undefined) {
    const requested = entries.find((entry) => entry.instanceId === instanceId);
    if (requested && isSelectableProviderInstanceEntry(requested)) {
      return requested;
    }
  }
  return (
    entries.find(isProviderInstancePickerReady) ??
    entries.find((entry) => isSelectableProviderInstanceEntry(entry) && entry.status !== "error")
  );
}

/**
 * A deleted/unusable instance falls back to ready/non-error providers; undefined means no safe new
 * selection.
 */
export function resolveSelectableProviderInstance(
  providers: ReadonlyArray<ServerProvider>,
  instanceId: ProviderInstanceId | undefined,
): ProviderInstanceId | undefined {
  const entries = deriveProviderInstanceEntries(providers);
  return resolveSelectableProviderInstanceEntry(entries, instanceId)?.instanceId;
}

/** Keep valid selections byte-for-byte; instance fallback resets its model to avoid cross-provider pairs. */
export function resolveDefaultProviderModelSelection(
  providers: ReadonlyArray<ServerProvider>,
  selection: ModelSelection | null | undefined,
): ModelSelection | null {
  const instanceId = resolveSelectableProviderInstance(providers, selection?.instanceId);
  if (instanceId === undefined) return null;
  if (selection?.instanceId === instanceId) return selection;
  const model = getDefaultProviderInstanceModel(providers, instanceId);
  return model ? { instanceId, model } : null;
}
