import {
  isLocalLoopbackHost,
  isPrivateNetworkHost,
  isSharedAddressSpaceHost,
  isTailnetHost,
} from "@t3tools/shared/hostClassification";
import type { DesktopSshEnvironmentTarget } from "@t3tools/contracts";
import * as Option from "effect/Option";

import {
  BearerConnectionProfile,
  type ConnectionCatalogEntry,
  type ConnectionRoute,
} from "./catalog.ts";
import { BearerConnectionTarget, type ConnectionTarget } from "./model.ts";

export type ConnectionRouteKind =
  | "relay"
  | "loopback"
  | "lan"
  | "tailnet"
  | "vpn"
  | "public"
  | "ssh";

/** An environment has at most one T3 Connect route, so it needs no per-route id. */
export const RELAY_ROUTE_ID = "relay";

export function connectionRouteId(target: ConnectionTarget): string {
  switch (target._tag) {
    case "PrimaryConnectionTarget":
      return "primary";
    case "RelayConnectionTarget":
      return RELAY_ROUTE_ID;
    case "BearerConnectionTarget":
    case "SshConnectionTarget":
      return target.connectionId;
  }
}

/** Every route of an entry, preferred first. */
export function connectionRoutes(entry: ConnectionCatalogEntry): ReadonlyArray<ConnectionRoute> {
  return [{ target: entry.target, profile: entry.profile }, ...(entry.alternateRoutes ?? [])];
}

/** Builds an entry whose preferred route is the first of `routes`, which must not be empty. */
export function entryWithRoutes(
  entry: ConnectionCatalogEntry,
  routes: ReadonlyArray<ConnectionRoute>,
): ConnectionCatalogEntry {
  const [first, ...rest] = routes;
  if (first === undefined) {
    throw new Error("A saved environment needs at least one route.");
  }
  const { alternateRoutes: _previous, ...base } = entry;
  return {
    ...base,
    target: first.target,
    profile: first.profile,
    ...(rest.length === 0 ? {} : { alternateRoutes: rest }),
  };
}

export function routeEntry(
  entry: ConnectionCatalogEntry,
  route: ConnectionRoute,
): ConnectionCatalogEntry {
  return entryWithRoutes(entry, [route]);
}

/** The base URL of a direct route, or null for T3 Connect and SSH. */
export function routeHttpBaseUrl(route: ConnectionRoute): string | null {
  if (route.target._tag === "PrimaryConnectionTarget") return route.target.httpBaseUrl;
  const profile = Option.getOrNull(route.profile);
  return profile?._tag === "BearerConnectionProfile" ? profile.httpBaseUrl : null;
}

function routeHostname(route: ConnectionRoute): string | null {
  const httpBaseUrl = routeHttpBaseUrl(route);
  if (httpBaseUrl === null) return null;
  try {
    return new URL(httpBaseUrl).hostname;
  } catch {
    return null;
  }
}

export function connectionRouteKind(route: ConnectionRoute): ConnectionRouteKind {
  switch (route.target._tag) {
    case "RelayConnectionTarget":
      return "relay";
    case "SshConnectionTarget":
      return "ssh";
    case "PrimaryConnectionTarget":
    case "BearerConnectionTarget": {
      const hostname = routeHostname(route);
      if (hostname === null) return "public";
      if (isLocalLoopbackHost(hostname)) return "loopback";
      const profile = Option.getOrNull(route.profile);
      const tailscale =
        profile?._tag === "BearerConnectionProfile" && profile.network === "tailscale";
      if (tailscale || isTailnetHost(hostname)) return "tailnet";
      if (isSharedAddressSpaceHost(hostname)) return "vpn";
      return isPrivateNetworkHost(hostname) ? "lan" : "public";
    }
  }
}

const ROUTE_KIND_RANK: Record<ConnectionRouteKind, number> = {
  loopback: 0,
  lan: 1,
  tailnet: 2,
  vpn: 2,
  public: 3,
  ssh: 4,
  relay: 5,
};

/** Inserts after saved routes of the same or faster kind; user ordering remains authoritative. */
export function insertRoute(
  routes: ReadonlyArray<ConnectionRoute>,
  route: ConnectionRoute,
): ReadonlyArray<ConnectionRoute> {
  const rank = ROUTE_KIND_RANK[connectionRouteKind(route)];
  const index = routes.findIndex(
    (existing) => ROUTE_KIND_RANK[connectionRouteKind(existing)] > rank,
  );
  return index === -1
    ? [...routes, route]
    : [...routes.slice(0, index), route, ...routes.slice(index)];
}

/** Replaces the route with the same id in place, or inserts it by kind. */
export function upsertRoute(
  routes: ReadonlyArray<ConnectionRoute>,
  route: ConnectionRoute,
): ReadonlyArray<ConnectionRoute> {
  const id = connectionRouteId(route.target);
  return routes.some((existing) => connectionRouteId(existing.target) === id)
    ? routes.map((existing) => (connectionRouteId(existing.target) === id ? route : existing))
    : insertRoute(routes, route);
}

/** Matches bearer URL or SSH alias/host/user/port so re-registering replaces even a different id. */
export function findRouteToSameAddress(
  routes: ReadonlyArray<ConnectionRoute>,
  route: ConnectionRoute,
): ConnectionRoute | undefined {
  const key = routeAddressKey(route);
  return key === null ? undefined : routes.find((existing) => routeAddressKey(existing) === key);
}

function routeAddressKey(route: ConnectionRoute): string | null {
  const profile = Option.getOrNull(route.profile);
  switch (profile?._tag) {
    case "BearerConnectionProfile":
      return `bearer:${profile.httpBaseUrl.replace(/\/+$/, "")}`;
    case "SshConnectionProfile":
      return `ssh:${sshTargetKey(profile.target)}`;
    default:
      return null;
  }
}

/** Short user-facing route description: "LAN", "Tailscale", "VPN", "T3 Connect", a URL, or an SSH host. */
export function connectionRouteLabel(route: ConnectionRoute): string {
  switch (connectionRouteKind(route)) {
    case "relay":
      return "T3 Connect";
    case "loopback":
      return "This device";
    case "lan":
      return "LAN";
    case "tailnet":
      return "Tailscale";
    case "vpn":
      return "VPN";
    case "ssh": {
      const profile = Option.getOrNull(route.profile);
      return profile?._tag === "SshConnectionProfile"
        ? `SSH ${profile.target.username ? `${profile.target.username}@` : ""}${profile.target.hostname}`
        : "SSH";
    }
    case "public":
      return routeHostname(route) ?? "Remote link";
  }
}

/** The address shown under a route, or null for T3 Connect. */
export function connectionRouteAddress(route: ConnectionRoute): string | null {
  if (route.target._tag === "SshConnectionTarget") {
    const profile = Option.getOrNull(route.profile);
    return profile?._tag === "SshConnectionProfile" ? profile.target.alias : null;
  }
  return routeHttpBaseUrl(route);
}

export function hasRelayRoute(
  entry: Pick<ConnectionCatalogEntry, "target" | "alternateRoutes">,
): boolean {
  return [entry.target, ...(entry.alternateRoutes ?? []).map((route) => route.target)].some(
    (target) => target._tag === "RelayConnectionTarget",
  );
}

/** Reconciles learned addresses with the active credential, preserving saved routes and user order.
 * Tailscale marks follow the server's interface report. */
export function mergeLearnedRoutes(input: {
  readonly entry: ConnectionCatalogEntry;
  readonly activeRoute: ConnectionRoute;
  readonly reported: ReadonlyArray<ReportedEndpoint>;
  /** Plain HTTP routes are unusable from an HTTPS page (mixed content). */
  readonly allowInsecure: boolean;
}): ReadonlyArray<ConnectionRoute> | null {
  const { entry } = input;
  const active = input.activeRoute.target;
  const saved = connectionRoutes(entry);
  // The primary and SSH routes have no credential a learned route could reuse.
  if (active._tag !== "RelayConnectionTarget" && active._tag !== "BearerConnectionTarget") {
    return null;
  }
  // A route learned over another learned route inherits what that one uses:
  // the T3 Connect credential, or the paired token it borrows.
  const activeProfile = Option.getOrNull(input.activeRoute.profile);
  const authorization =
    active._tag === "RelayConnectionTarget" ||
    (activeProfile?._tag === "BearerConnectionProfile" &&
      activeProfile.authorization === "t3-connect")
      ? ("t3-connect" as const)
      : undefined;
  const sharedCredential =
    authorization === undefined && active._tag === "BearerConnectionTarget"
      ? credentialConnectionId(active.connectionId)
      : undefined;

  const reported = new Map<string, URL>();
  const tailscaleOrigins = new Set<string>();
  for (const endpoint of input.reported) {
    let url: URL;
    try {
      url = new URL(endpoint.httpBaseUrl);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (url.protocol === "http:" && !input.allowInsecure) continue;
    // A loopback address names whichever device opens it, never the server.
    if (isLocalLoopbackHost(url.hostname)) continue;
    reported.set(url.origin, url);
    if (endpoint.kind === "tailnet") tailscaleOrigins.add(url.origin);
  }
  const normalized = (url: string) => url.replace(/\/+$/, "");
  const known = new Set(
    saved.flatMap((route) => {
      const url = routeHttpBaseUrl(route);
      return url === null || isLearned(route) ? [] : [normalized(url)];
    }),
  );
  const kept = saved.flatMap((route): ReadonlyArray<ConnectionRoute> => {
    const url = routeHttpBaseUrl(route);
    if (!isLearned(route)) {
      return [
        url === null || !reported.has(normalized(url))
          ? route
          : withNetwork(route, tailscaleOrigins.has(normalized(url))),
      ];
    }
    if (url === null || !reported.has(normalized(url)) || known.has(normalized(url))) return [];
    known.add(normalized(url));
    return [withNetwork(route, tailscaleOrigins.has(normalized(url)))];
  });
  let next: ReadonlyArray<ConnectionRoute> = kept;
  for (const url of reported.values()) {
    if (known.has(url.origin)) continue;
    const httpBaseUrl = `${url.origin}/`;
    const connectionId = learnedConnectionId(
      entry.target.environmentId,
      url.origin,
      sharedCredential,
    );
    next = insertRoute(next, {
      target: new BearerConnectionTarget({
        environmentId: entry.target.environmentId,
        label: entry.target.label,
        connectionId,
      }),
      profile: Option.some(
        new BearerConnectionProfile({
          connectionId,
          environmentId: entry.target.environmentId,
          label: entry.target.label,
          httpBaseUrl,
          wsBaseUrl: `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}/`,
          learned: true,
          ...(authorization === undefined ? {} : { authorization }),
          ...(tailscaleOrigins.has(url.origin) ? { network: "tailscale" as const } : {}),
        }),
      ),
    });
  }
  // Compare addresses too: a scheme or port change keeps no id stable.
  const signature = (routes: ReadonlyArray<ConnectionRoute>) =>
    routes
      .map(
        (route) =>
          `${connectionRouteId(route.target)} ${routeHttpBaseUrl(route) ?? ""} ${connectionRouteKind(route)}`,
      )
      .join("\n");
  return signature(saved) === signature(next) ? null : next;
}

export interface ReportedEndpoint {
  readonly httpBaseUrl: string;
  readonly kind?: string;
}

/** The direct route with its Tailscale mark set or cleared; the same route when unchanged. */
function withNetwork(route: ConnectionRoute, tailscale: boolean): ConnectionRoute {
  const profile = Option.getOrNull(route.profile);
  if (profile?._tag !== "BearerConnectionProfile") return route;
  if ((profile.network === "tailscale") === tailscale) return route;
  return {
    target: route.target,
    profile: Option.some(
      new BearerConnectionProfile({
        connectionId: profile.connectionId,
        environmentId: profile.environmentId,
        label: profile.label,
        httpBaseUrl: profile.httpBaseUrl,
        wsBaseUrl: profile.wsBaseUrl,
        ...(profile.learned === undefined ? {} : { learned: profile.learned }),
        ...(profile.authorization === undefined ? {} : { authorization: profile.authorization }),
        ...(tailscale ? { network: "tailscale" as const } : {}),
      }),
    ),
  };
}

// Learned ids identify the credential owner they borrow from.
function learnedConnectionId(
  environmentId: string,
  origin: string,
  sharedCredential: string | undefined,
): string {
  return sharedCredential === undefined
    ? `learned:${environmentId}:${origin}`
    : `learned:${environmentId}:${origin}@${sharedCredential}`;
}

/** The connection id whose stored credential a bearer route uses. */
export function credentialConnectionId(connectionId: string): string {
  // The borrowed id follows the first "@"; neither an environment id nor an
  // origin contains one.
  const at = connectionId.indexOf("@");
  return connectionId.startsWith("learned:") && at !== -1
    ? connectionId.slice(at + 1)
    : connectionId;
}

export function isLearned(route: ConnectionRoute): boolean {
  const profile = Option.getOrNull(route.profile);
  return profile?._tag === "BearerConnectionProfile" && profile.learned === true;
}

/** Removes dependent learned routes too, because they cannot outlive their credential owner. */
export function routesAfterRemoving(
  routes: ReadonlyArray<ConnectionRoute>,
  removedId: string,
): ReadonlyArray<ConnectionRoute> {
  const removed = routes.find((route) => connectionRouteId(route.target) === removedId);
  if (removed === undefined) return routes;
  return routes.filter((route) => {
    if (route === removed) return false;
    if (!isLearned(route)) return true;
    const profile = Option.getOrNull(route.profile);
    if (profile?._tag === "BearerConnectionProfile" && profile.authorization === "t3-connect") {
      return removed.target._tag !== "RelayConnectionTarget";
    }
    return credentialConnectionId(connectionRouteId(route.target)) !== removedId;
  });
}

/** Relay-dependent learned routes also disappear on sign-out. */
export function removedWithRelay(entry: ConnectionCatalogEntry): boolean {
  return routesAfterRemoving(connectionRoutes(entry), RELAY_ROUTE_ID).length === 0;
}

/** One SSH target, as desktop keys its tunnels: alias, host, user, and port. */
export function sshTargetKey(target: DesktopSshEnvironmentTarget): string {
  return JSON.stringify([target.alias, target.hostname, target.username, target.port]);
}
