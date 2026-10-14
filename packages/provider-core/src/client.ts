/**
 * Provider client definitions must stay browser- and React Native-safe:
 * plain data and schemas, without platform UI imports.
 */
import type { ProviderDriverKind } from "@t3tools/contracts";
import type * as Schema from "effect/Schema";

/** Fields carry providerSettingsForm annotations for generic settings forms. */
export type ProviderSettingsSchema = {
  readonly fields: Readonly<Record<string, Schema.Top>>;
} & Schema.Top;

/** An environment variable the settings UI offers for every instance of a driver. */
export interface ProviderEnvironmentField {
  readonly name: string;
  readonly label: string;
  readonly description?: string;
  readonly placeholder?: string;
  readonly sensitive?: boolean;
}

/**
 * Plain SVG data lets web and mobile use their own renderers; a path without
 * a fill or gradient uses icon.fill.
 */
export interface ProviderIcon {
  readonly viewBox: string;
  readonly fill: { readonly light: string; readonly dark: string };
  readonly paths: ReadonlyArray<{
    readonly d: string;
    readonly fillRule?: "evenodd" | "nonzero";
    readonly fill?: { readonly light: string; readonly dark: string };
    /** A brand gradient, the same in both themes. Coordinates are in viewBox units. */
    readonly gradient?: ProviderIconGradient;
  }>;
}

export interface ProviderIconGradient {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly stops: ReadonlyArray<{ readonly offset: number; readonly color: string }>;
}

export interface ProviderClientDefinition {
  readonly driverKind: ProviderDriverKind;
  readonly label: string;
  readonly icon?: ProviderIcon;
  readonly settingsSchema: ProviderSettingsSchema;
  readonly environmentFields?: ReadonlyArray<ProviderEnvironmentField>;
  /** Defaults from legacy providers.<kind> settings when the driver supports a default instance. */
  readonly hasDefaultInstance?: boolean;
  /** Applies to built-in and custom instances of the driver alike. */
  readonly badgeLabel?: string;
}

export function defineProviderClient<const Definition extends ProviderClientDefinition>(
  definition: Definition,
): Definition {
  return definition;
}

export interface ProviderClientRegistry {
  readonly definitions: ReadonlyArray<ProviderClientDefinition>;
  /** `undefined` for drivers this client does not ship, such as a fork's driver. */
  readonly get: (
    driverKind: ProviderDriverKind | undefined,
  ) => ProviderClientDefinition | undefined;
}

export function makeProviderClientRegistry(
  definitions: ReadonlyArray<ProviderClientDefinition>,
): ProviderClientRegistry {
  const byDriverKind = new Map<ProviderDriverKind, ProviderClientDefinition>();
  for (const definition of definitions) {
    if (byDriverKind.has(definition.driverKind)) {
      throw new Error(`Provider driver '${definition.driverKind}' is defined more than once.`);
    }
    byDriverKind.set(definition.driverKind, definition);
  }
  return {
    definitions,
    get: (driverKind) => (driverKind === undefined ? undefined : byDriverKind.get(driverKind)),
  };
}
