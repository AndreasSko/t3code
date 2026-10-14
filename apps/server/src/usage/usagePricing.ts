/** Rates use LiteLLM's `model_prices_and_context_window.json`; UsageService owns fetching and caching. */
import type {
  UsageCategoryCost,
  UsageCostSource,
  UsageModelPriceOverride,
  UsageTokenTotals,
} from "@t3tools/contracts";

import type { UsageRecord, UsageSpeed } from "@t3tools/provider-core/server/usage";

/** Token rates for one billing speed. All values are USD per token. */
export interface TokenRates {
  readonly inputCostPerToken: number;
  readonly outputCostPerToken: number;
  readonly cacheReadCostPerToken: number;
  readonly cacheCreationCostPerToken: number;
}

/** Unpublished speed rates fall back to standard; transcripts omit LiteLLM's context, flex, and batch tiers. */
export interface ModelRate extends TokenRates {
  /** LiteLLM's `provider_specific_entry.fast` multiplier, or `*_priority` rates. */
  readonly fast: TokenRates | null;
  /** From LiteLLM's `*_ultrafast` rates (Codex `ultrafast`). */
  readonly ultrafast: TokenRates | null;
}

export type RateTable = ReadonlyMap<string, ModelRate>;

/** Custom IDs keep their case, prefix, and suffix; entered rates apply at every speed. */
export function createOverrideRateTable(
  overrides: Readonly<Record<string, UsageModelPriceOverride>>,
): RateTable {
  return new Map(
    Object.entries(overrides).map(([model, prices]) => [
      model.trim(),
      {
        inputCostPerToken: prices.inputCostPerMillionTokens / 1_000_000,
        outputCostPerToken: prices.outputCostPerMillionTokens / 1_000_000,
        cacheReadCostPerToken:
          (prices.cacheReadCostPerMillionTokens ?? prices.inputCostPerMillionTokens) / 1_000_000,
        cacheCreationCostPerToken:
          (prices.cacheWriteCostPerMillionTokens ?? prices.inputCostPerMillionTokens) / 1_000_000,
        fast: null,
        ultrafast: null,
      },
    ]),
  );
}

type LiteLlmEntry = Readonly<Record<string, unknown>>;

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Missing cache rates use plain input pricing, or preserve the standard tier's cache-to-input ratio. */
function readTokenRates(
  entry: LiteLlmEntry,
  suffix: string,
  standard?: TokenRates,
): TokenRates | null {
  const input = finiteNumber(entry[`input_cost_per_token${suffix}`]);
  const output = finiteNumber(entry[`output_cost_per_token${suffix}`]);
  if (input === null || output === null) return null;
  const cacheRate = (name: string, field: "cacheReadCostPerToken" | "cacheCreationCostPerToken") =>
    finiteNumber(entry[`${name}${suffix}`]) ??
    (standard !== undefined && standard.inputCostPerToken > 0
      ? (standard[field] / standard.inputCostPerToken) * input
      : input);
  return {
    inputCostPerToken: input,
    outputCostPerToken: output,
    cacheReadCostPerToken: cacheRate("cache_read_input_token_cost", "cacheReadCostPerToken"),
    cacheCreationCostPerToken: cacheRate(
      "cache_creation_input_token_cost",
      "cacheCreationCostPerToken",
    ),
  };
}

function scaleTokenRates(rates: TokenRates, multiple: number): TokenRates {
  return {
    inputCostPerToken: rates.inputCostPerToken * multiple,
    outputCostPerToken: rates.outputCostPerToken * multiple,
    cacheReadCostPerToken: rates.cacheReadCostPerToken * multiple,
    cacheCreationCostPerToken: rates.cacheCreationCostPerToken * multiple,
  };
}

function fastMultiplier(entry: LiteLlmEntry): number | null {
  const specific = entry["provider_specific_entry"];
  if (typeof specific !== "object" || specific === null) return null;
  const fast = finiteNumber((specific as Record<string, unknown>)["fast"]);
  return fast !== null && fast > 0 ? fast : null;
}

/**
 * Reject half-priced entries to avoid silently understating cost.
 * Bare aliases require identical rates across qualified entries and no canonical name collision.
 */
export function parseRateTable(document: unknown): RateTable {
  const table = new Map<string, ModelRate>();
  if (typeof document !== "object" || document === null) return table;

  for (const [name, raw] of Object.entries(document as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as LiteLlmEntry;
    const standard = readTokenRates(entry, "");
    if (standard === null) continue;

    const key = normalizeRateKey(name);
    if (key.length === 0) continue;
    const multiple = fastMultiplier(entry);
    table.set(key, {
      ...standard,
      fast:
        multiple === null
          ? readTokenRates(entry, "_priority", standard)
          : scaleTokenRates(standard, multiple),
      ultrafast: readTokenRates(entry, "_ultrafast", standard),
    });
  }

  // `null` marks a bare name claimed at conflicting rates: no alias for it.
  const aliasCandidates = new Map<string, ModelRate | null>();
  for (const [key, rate] of table) {
    const alias = bareModelName(key);
    if (alias.length === 0 || alias === key || table.has(alias)) continue;
    const held = aliasCandidates.get(alias);
    if (held === undefined) {
      aliasCandidates.set(alias, rate);
    } else if (held !== null && !sameRate(held, rate)) {
      aliasCandidates.set(alias, null);
    }
  }
  for (const [alias, rate] of aliasCandidates) {
    if (rate !== null) table.set(alias, rate);
  }

  return table;
}

function sameTokenRates(a: TokenRates | null, b: TokenRates | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.inputCostPerToken === b.inputCostPerToken &&
    a.outputCostPerToken === b.outputCostPerToken &&
    a.cacheReadCostPerToken === b.cacheReadCostPerToken &&
    a.cacheCreationCostPerToken === b.cacheCreationCostPerToken
  );
}

function sameRate(a: ModelRate, b: ModelRate): boolean {
  return (
    sameTokenRates(a, b) &&
    sameTokenRates(a.fast, b.fast) &&
    sameTokenRates(a.ultrafast, b.ultrafast)
  );
}

function ratesAt(rate: ModelRate, speed: UsageSpeed): TokenRates {
  return (speed === "standard" ? null : rate[speed]) ?? rate;
}

function normalizeRateKey(model: string): string {
  return model.trim().toLowerCase();
}

function bareModelName(key: string): string {
  const slash = key.lastIndexOf("/");
  return slash === -1 ? key : key.slice(slash + 1);
}

/** Claude's `[1m]` suffix uses the base rate because the rate table only knows the base name. */
function stripVariantSuffix(key: string): string {
  const bracket = key.indexOf("[");
  return bracket === -1 ? key : key.slice(0, bracket);
}

/** Synthetic messages were not billed; bare family names are too ambiguous to price. */
const UNPRICEABLE_MODELS = new Set([
  "<synthetic>",
  "synthetic",
  "opus",
  "sonnet",
  "haiku",
  "fable",
]);

/** Tables are immutable; memoize repeated lookups while pricing each record twice. */
const resolvedRates = new WeakMap<RateTable, Map<string, ModelRate | null>>();

export function lookupRate(table: RateTable, model: string): ModelRate | null {
  let resolved = resolvedRates.get(table);
  if (resolved === undefined) {
    resolved = new Map();
    resolvedRates.set(table, resolved);
  }
  let rate = resolved.get(model);
  if (rate === undefined) {
    rate = resolveRate(table, model);
    resolved.set(model, rate);
  }
  return rate;
}

function resolveRate(table: RateTable, model: string): ModelRate | null {
  const key = stripVariantSuffix(normalizeRateKey(model));
  const bareName = bareModelName(key);
  if (bareName.length === 0 || UNPRICEABLE_MODELS.has(bareName)) return null;
  return table.get(key) ?? null;
}

export type PricedRecord = Pick<
  UsageRecord,
  "model" | "rateModel" | "totals" | "speed" | "reportedCostUsd"
>;

export interface PricedUsage {
  readonly costUsd: number;
  readonly costSource: UsageCostSource;
  /** `costUsd` by token category, or `null` when no rates are known to split it. */
  readonly categoryCostUsd: UsageCategoryCost | null;
  /** What `costUsd` exceeds the same tokens at standard rates. `0` without rates. */
  readonly speedPremiumUsd: number;
}

function costByCategory(totals: UsageTokenTotals, rates: TokenRates): UsageCategoryCost {
  return {
    input: totals.uncachedInputTokens * rates.inputCostPerToken,
    cacheRead: totals.cachedInputTokens * rates.cacheReadCostPerToken,
    cacheWrite: totals.cacheCreationTokens * rates.cacheCreationCostPerToken,
    output: totals.outputTokens * rates.outputCostPerToken,
  };
}

function sumCategories(cost: UsageCategoryCost): number {
  return cost.input + cost.cacheRead + cost.cacheWrite + cost.output;
}

/**
 * Keep provider-reported costs, splitting them proportionally using known list rates.
 * Reasoning tokens already count toward output, so charging them separately would double-bill.
 */
export function priceUsage(
  table: RateTable,
  record: PricedRecord,
  overrides?: RateTable,
): PricedUsage {
  const { model, totals, reportedCostUsd } = record;
  const override = overrides?.get(model.trim());
  const reported =
    override === undefined && reportedCostUsd !== null && Number.isFinite(reportedCostUsd)
      ? reportedCostUsd
      : null;
  const unsplit = (costUsd: number, costSource: UsageCostSource): PricedUsage => ({
    costUsd,
    costSource,
    categoryCostUsd: null,
    speedPremiumUsd: 0,
  });
  const rate = override ?? lookupRate(table, record.rateModel ?? model);
  if (rate === null) {
    return reported === null ? unsplit(0, "unpriced") : unsplit(reported, "providerReported");
  }

  const listCost = costByCategory(totals, ratesAt(rate, record.speed));
  const listCostUsd = sumCategories(listCost);
  if (reported !== null && listCostUsd <= 0) return unsplit(reported, "providerReported");
  const premiumUsd =
    record.speed === "standard" ? 0 : listCostUsd - sumCategories(costByCategory(totals, rate));
  const scale = reported === null ? 1 : reported / listCostUsd;
  return {
    costUsd: reported ?? listCostUsd,
    costSource: reported === null ? "modelPriced" : "providerReported",
    categoryCostUsd: {
      input: listCost.input * scale,
      cacheRead: listCost.cacheRead * scale,
      cacheWrite: listCost.cacheWrite * scale,
      output: listCost.output * scale,
    },
    speedPremiumUsd: premiumUsd * scale,
  };
}

/** Cached input savings relative to full input rates. */
export function cacheSavingsUsd(
  table: RateTable,
  record: PricedRecord,
  overrides?: RateTable,
): number {
  const rate =
    overrides?.get(record.model.trim()) ?? lookupRate(table, record.rateModel ?? record.model);
  if (rate === null) return 0;
  const rates = ratesAt(rate, record.speed);
  return record.totals.cachedInputTokens * (rates.inputCostPerToken - rates.cacheReadCostPerToken);
}
