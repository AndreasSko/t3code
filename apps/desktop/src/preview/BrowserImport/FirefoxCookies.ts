/** Firefox stores plaintext cookies and needs no platform keychain consent. */
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { cookieScope, snapshotCookieDatabase, type ImportedCookie } from "./CookieDatabase.ts";

/** BrowserImport maps every Firefox read failure to readFailed; no separate reason field is needed. */
export class FirefoxCookieReadError extends Schema.TaggedError<FirefoxCookieReadError>()(
  "FirefoxCookieReadError",
  {
    /** Identifies which Firefox profile failed in logs. */
    cookieDatabasePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Could not read Firefox cookies at ${this.cookieDatabasePath}.`;
  }
}

/**
 * Firefox SameSite: 0 None, 1 Lax, 2 Strict, 256 Unset.
 * Unset and unknown values remain unspecified; mapping them to None would widen cross-site access.
 */
const SAMESITE_NONE = 0;
const SAMESITE_LAX = 1;
const SAMESITE_STRICT = 2;

/**
 * Schemas 10-14: sameSite=Lax with rawSameSite=None identifies an undeclared value.
 * Apply Firefox's schema-15 rule so those cookies remain unspecified on import.
 */
const FIREFOX_RAW_SAMESITE_FIRST_SCHEMA = 10;
const FIREFOX_RAW_SAMESITE_LAST_SCHEMA = 14;

const sameSiteFromColumn = (
  value: number | null,
  rawValue: number | null,
): ImportedCookie["sameSite"] => {
  // Schema 9 added the column with no default, so older rows carry NULL.
  if (value === null) return "unspecified";
  if (value === SAMESITE_LAX && rawValue === SAMESITE_NONE) return "unspecified";
  if (value === SAMESITE_NONE) return "no_restriction";
  if (value === SAMESITE_LAX) return "lax";
  if (value === SAMESITE_STRICT) return "strict";
  return "unspecified";
};

const CookieRow = Schema.Struct({
  host: Schema.String,
  name: Schema.String,
  value: Schema.String,
  path: Schema.String,
  // UNIX epoch; schema version determines seconds or milliseconds (see expiryToSeconds).
  expiry: Schema.Number,
  isSecure: Schema.Number,
  isHttpOnly: Schema.Number,
  sameSite: Schema.NullOr(Schema.Number),
  // Present only for schemas 10–14; selected as NULL elsewhere.
  rawSameSite: Schema.NullOr(Schema.Number),
});
const decodeCookieRows = Schema.decodeUnknownEffect(Schema.Array(CookieRow));

/**
 * Firefox schema 16+ stores expiry in milliseconds; older schemas use seconds.
 * Use PRAGMA user_version so import preserves the actual expiration date.
 */
const FIREFOX_EXPIRY_MILLISECONDS_SCHEMA = 16;

const UserVersionRow = Schema.Struct({ user_version: Schema.Number });
const decodeUserVersion = Schema.decodeUnknownEffect(Schema.Array(UserVersionRow));

const expiryToSeconds = (expiry: number, schemaVersion: number): number | undefined => {
  if (expiry <= 0) return undefined;
  return schemaVersion >= FIREFOX_EXPIRY_MILLISECONDS_SCHEMA ? Math.floor(expiry / 1000) : expiry;
};

export const readFirefoxCookies = Effect.fn("FirefoxCookies.readFirefoxCookies")(
  function* (cookieDatabasePath: string) {
    const snapshotPath = yield* snapshotCookieDatabase(cookieDatabasePath);

    const { rows, schemaVersion } = yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [versionRow] = yield* decodeUserVersion(yield* sql`pragma user_version`);
      const schemaVersion = versionRow?.user_version ?? 0;
      const hasRawSameSite =
        schemaVersion >= FIREFOX_RAW_SAMESITE_FIRST_SCHEMA &&
        schemaVersion <= FIREFOX_RAW_SAMESITE_LAST_SCHEMA;
      // Electron cannot represent Firefox containers or private-window identities; import only empty originAttributes.
      const raw = hasRawSameSite
        ? yield* sql`
          select host, name, value, path, expiry, isSecure, isHttpOnly, sameSite, rawSameSite
            from moz_cookies
           where originAttributes = ''
        `
        : yield* sql`
          select host, name, value, path, expiry, isSecure, isHttpOnly, sameSite,
                 null as rawSameSite
            from moz_cookies
           where originAttributes = ''
        `;
      return { rows: yield* decodeCookieRows(raw), schemaVersion };
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: snapshotPath, readonly: true })));

    return rows.map((row) => {
      const secure = row.isSecure === 1;
      const scope = cookieScope(row.host, row.path, secure);
      return {
        url: scope.url,
        name: row.name,
        value: row.value,
        domain: scope.domain,
        path: row.path,
        secure,
        httpOnly: row.isHttpOnly === 1,
        expirationDate: expiryToSeconds(row.expiry, schemaVersion),
        sameSite: sameSiteFromColumn(row.sameSite, row.rawSameSite),
      } satisfies ImportedCookie;
    });
  },
  (effect, cookieDatabasePath) =>
    effect.pipe(
      Effect.mapError((cause) => new FirefoxCookieReadError({ cookieDatabasePath, cause })),
    ),
);
