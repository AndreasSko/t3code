/**
 * Providers read only their own manifest entry through this service,
 * without coupling to fetching or storage; reads never wait for the network.
 */
import type {
  ModelCapabilities,
  ProviderDriverKind,
  ServerProviderModel,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ServerProviderDraft } from "./snapshotProbe.ts";

export interface ProviderCatalogModel {
  readonly slug: string;
  readonly name: string;
  readonly shortName?: string;
  readonly subProvider?: string;
  readonly aliases?: ReadonlyArray<string>;
  readonly status: "current" | "legacy";
  readonly badge?: "new";
  readonly capabilities: ModelCapabilities | null;
  /** Provider-owned metadata for this model; the provider decodes it. */
  readonly adapter: unknown;
  /** Provider-owned metadata for the model's capability profile. */
  readonly profileAdapter: unknown;
}

export interface ProviderCatalog {
  readonly models: ReadonlyArray<ProviderCatalogModel>;
  readonly defaultChatModel: string | undefined;
}

export class ModelCatalog extends Context.Service<
  ModelCatalog,
  {
    /** Reads memory only; undefined means the driver has no manifest entry. */
    readonly current: (
      driverKind: ProviderDriverKind,
    ) => Effect.Effect<ProviderCatalog | undefined>;
    /** The same catalog from the bundled manifest; for fallbacks when remote data is invalid. */
    readonly bundled: (driverKind: ProviderDriverKind) => ProviderCatalog | undefined;
    /** TTL-gated refresh must neither fail nor block provider checks. */
    readonly refreshInBackground: Effect.Effect<void>;
  }
>()("@t3tools/provider-core/server/ModelCatalog") {}

export const catalogServerModel = (
  catalog: ProviderCatalog,
  entry: ProviderCatalogModel,
): ServerProviderModel => ({
  slug: entry.slug,
  name: entry.name,
  ...(entry.shortName ? { shortName: entry.shortName } : {}),
  ...(entry.subProvider ? { subProvider: entry.subProvider } : {}),
  ...(entry.aliases ? { aliases: entry.aliases } : {}),
  ...(entry.badge ? { badge: entry.badge } : {}),
  isCustom: false,
  ...(catalog.defaultChatModel === entry.slug ? { isDefault: true } : {}),
  ...(entry.status === "legacy" ? { isLegacy: true } : {}),
  capabilities: entry.capabilities,
});

export interface CatalogMatching {
  /**
   * Maps a slug to the family the catalog names it by, such as a dated Codex
   * build to its base model. Defaults to the slug itself.
   */
  readonly family?: (slug: string) => string;
}

const familyOf = (matching: CatalogMatching | undefined, slug: string) =>
  matching?.family?.(slug) ?? slug;

/** Classify built-ins only; user-defined custom models keep their classification. */
export function classifyCatalogModels(
  models: ReadonlyArray<ServerProviderModel>,
  catalog: ProviderCatalog | undefined,
  matching?: CatalogMatching,
): ReadonlyArray<ServerProviderModel> {
  return models.map((model) => {
    if (model.isCustom) return model;
    const entry =
      catalog?.models.find((candidate) => candidate.slug === model.slug) ??
      catalog?.models.find((candidate) => candidate.slug === familyOf(matching, model.slug));
    if (entry?.status === "legacy") return model.isLegacy ? model : { ...model, isLegacy: true };
    if (!model.isLegacy) return model;
    const { isLegacy: _isLegacy, ...rest } = model;
    return rest;
  });
}

/**
 * Move isDefault to the catalog choice and retarget aliases that followed
 * the prior default so provider-default resolution stays consistent.
 */
export function applyCatalogDefault(
  models: ReadonlyArray<ServerProviderModel>,
  catalog: ProviderCatalog | undefined,
  matching?: CatalogMatching,
): ReadonlyArray<ServerProviderModel> {
  const requestedSlug = catalog?.defaultChatModel;
  if (requestedSlug === undefined) return models;
  const slug =
    models.find((model) => model.slug === requestedSlug)?.slug ??
    (matching?.family === undefined
      ? undefined
      : models.find(
          (model) =>
            !model.isCustom && familyOf(matching, model.slug) === familyOf(matching, requestedSlug),
        )?.slug);
  if (slug === undefined) return models;
  const previous = models.find((model) => model.isDefault && model.slug !== slug);
  if (!previous) return models;
  const movedAliases = previous.aliases ?? [];
  return models.map((model) => {
    if (model.slug === previous.slug) {
      const { isDefault: _isDefault, aliases: _aliases, ...rest } = model;
      return rest;
    }
    if (model.slug === slug) {
      const aliases = [...new Set([...(model.aliases ?? []), ...movedAliases])];
      return { ...model, isDefault: true, ...(aliases.length > 0 ? { aliases } : {}) };
    }
    return model;
  });
}

/**
 * Apply classification/defaults and clear stale updateRequiredModels;
 * drivers add currently unavailable models themselves.
 */
export function applyModelCatalog(
  draft: ServerProviderDraft,
  catalog: ProviderCatalog | undefined,
  matching?: CatalogMatching,
): ServerProviderDraft {
  const { updateRequiredModels: _previous, ...rest } = draft;
  return {
    ...rest,
    models: applyCatalogDefault(
      classifyCatalogModels(draft.models, catalog, matching),
      catalog,
      matching,
    ),
  };
}
