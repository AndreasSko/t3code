/**
 * Safari cookie extraction.
 *
 * Safari does not encrypt its cookies; it stores them in a proprietary
 * `Cookies.binarycookies` file inside its app container. The protection is
 * TCC, not cryptography — the file lives under a path only apps with Full Disk
 * Access may read, so the gate is a permission the user grants in System
 * Settings rather than a key to obtain.
 *
 * The format, big-endian throughout except the page bodies:
 *
 *   magic "cook", u32 pageCount, u32 pageSize[pageCount], then each page:
 *     u32 0x00000100, u32le cookieCount, u32le cookieOffset[cookieCount],
 *     then each cookie:
 *       u32le size, u32le unknown, u32le flags, u32le unknown,
 *       u32le urlOffset, nameOffset, pathOffset, valueOffset,
 *       u64 end-of-header, f64 expiry, f64 creation, then NUL-terminated
 *       strings at the offsets above (relative to the cookie start).
 *
 * @module SafariCookies
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import { cookieScope, type ImportedCookie } from "./CookieDatabase.ts";

/** Safari's timestamps count seconds from 2001-01-01, not the UNIX epoch. */
const APPLE_EPOCH_OFFSET_SECONDS = 978_307_200;

/** `u32 0x00000100`, `u32le cookieCount`, then one `u32le` offset per cookie. */
const COOKIE_PAGE_HEADER_SIZE = 12;
/** Through the `f64 creation` field; string bytes follow. */
const COOKIE_RECORD_HEADER_SIZE = 56;

const FLAG_SECURE = 0x1;
const FLAG_HTTP_ONLY = 0x4;

export const SafariCookieReadFailure = Schema.Literals(["needsFullDiskAccess", "readFailed"]);
export type SafariCookieReadFailure = typeof SafariCookieReadFailure.Type;

export class SafariCookieReadError extends Schema.TaggedError<SafariCookieReadError>()(
  "SafariCookieReadError",
  {
    reason: SafariCookieReadFailure,
    /** Optional because the parser can fail before a database path is known. */
    cookieDatabasePath: Schema.optional(Schema.String),
    /** Kept for the log; never surfaced to the user. */
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.cookieDatabasePath === undefined
      ? `Could not read Safari cookies: ${this.reason}.`
      : `Could not read Safari cookies at ${this.cookieDatabasePath}: ${this.reason}.`;
  }
}

const isSafariCookieReadError = Schema.is(SafariCookieReadError);

function readCString(buffer: Buffer, start: number): string {
  const end = buffer.indexOf(0, start);
  return buffer.toString("utf8", start, end === -1 ? buffer.length : end);
}

export function parseBinaryCookies(buffer: Buffer): ReadonlyArray<ImportedCookie> {
  if (buffer.length < 8 || buffer.toString("latin1", 0, 4) !== "cook") {
    throw new SafariCookieReadError({ reason: "readFailed" });
  }

  const pageCount = buffer.readUInt32BE(4);
  // Buffer.subarray silently clamps; reject truncated structures instead of importing missing or cross-record data.
  if (8 + pageCount * 4 > buffer.length) {
    throw new SafariCookieReadError({ reason: "readFailed" });
  }
  const pageSizes: number[] = [];
  for (let index = 0; index < pageCount; index += 1) {
    pageSizes.push(buffer.readUInt32BE(8 + index * 4));
  }

  const cookies: ImportedCookie[] = [];
  let pageStart = 8 + pageCount * 4;

  for (const pageSize of pageSizes) {
    if (pageSize < COOKIE_PAGE_HEADER_SIZE || pageStart + pageSize > buffer.length) {
      throw new SafariCookieReadError({ reason: "readFailed" });
    }
    const page = buffer.subarray(pageStart, pageStart + pageSize);
    pageStart += pageSize;

    // Page bodies switch to little-endian after the big-endian header.
    const cookieCount = page.readUInt32LE(4);
    const offsetTableEnd = COOKIE_PAGE_HEADER_SIZE + cookieCount * 4;
    if (offsetTableEnd > page.length) {
      throw new SafariCookieReadError({ reason: "readFailed" });
    }
    // Reject overlapping records so header, offset-table, or earlier-record bytes cannot become fabricated cookies.
    const accepted: Array<readonly [start: number, end: number]> = [];
    for (let index = 0; index < cookieCount; index += 1) {
      const cookieStart = page.readUInt32LE(8 + index * 4);
      if (cookieStart < offsetTableEnd || cookieStart + COOKIE_RECORD_HEADER_SIZE > page.length) {
        throw new SafariCookieReadError({ reason: "readFailed" });
      }
      // Bounded by the record's own length so a string offset cannot run past
      // it into the following record's bytes.
      const recordSize = page.readUInt32LE(cookieStart);
      const cookieEnd = cookieStart + recordSize;
      if (
        recordSize < COOKIE_RECORD_HEADER_SIZE ||
        cookieEnd > page.length ||
        accepted.some(([start, end]) => cookieStart < end && cookieEnd > start)
      ) {
        throw new SafariCookieReadError({ reason: "readFailed" });
      }
      accepted.push([cookieStart, cookieEnd]);
      const cookie = page.subarray(cookieStart, cookieEnd);

      const flags = cookie.readUInt32LE(8);
      const urlOffset = cookie.readUInt32LE(16);
      const nameOffset = cookie.readUInt32LE(20);
      const pathOffset = cookie.readUInt32LE(24);
      const valueOffset = cookie.readUInt32LE(28);
      const expiry = cookie.readDoubleLE(40);

      // Offsets are relative to the record; one pointing outside it would
      // otherwise read a neighbouring cookie's bytes as this one's value.
      if (
        [urlOffset, nameOffset, pathOffset, valueOffset].some(
          (offset) => offset < COOKIE_RECORD_HEADER_SIZE || offset >= cookie.length,
        )
      ) {
        throw new SafariCookieReadError({ reason: "readFailed" });
      }
      const domain = readCString(cookie, urlOffset);
      const name = readCString(cookie, nameOffset);
      const path = readCString(cookie, pathOffset);
      const value = readCString(cookie, valueOffset);
      if (domain === "" || name === "") continue;

      const secure = (flags & FLAG_SECURE) !== 0;
      const expirationDate =
        expiry > 0 ? Math.floor(expiry) + APPLE_EPOCH_OFFSET_SECONDS : undefined;

      cookies.push({
        // Safari marks domain cookies with a leading dot; preserve host-only scope when importing into Electron.
        ...cookieScope(domain, path || "/", secure),
        name,
        value,
        path: path || "/",
        secure,
        httpOnly: (flags & FLAG_HTTP_ONLY) !== 0,
        expirationDate,
        // Safari's SameSite flag bits are not reliably documented; use Lax rather than widening every cookie to None.
        sameSite: "lax",
      });
    }
  }

  // Reject bytes beyond the checksum/property-list trailer; undeclared pages would silently lose cookies.
  const trailer = buffer.length - pageStart;
  // Legal shapes: nothing, the 8-byte checksum alone, or checksum + u32
  // length + exactly that many property-list bytes.
  const validTrailer =
    trailer === 0 ||
    trailer === 8 ||
    (trailer >= 12 && trailer === 8 + 4 + buffer.readUInt32BE(pageStart + 8));
  if (!validTrailer) {
    throw new SafariCookieReadError({ reason: "readFailed" });
  }

  return cookies;
}

/** TCC denies with EPERM (tagged Unknown); EACCES is a POSIX/ACL failure Full Disk Access cannot fix. */
export const isPermissionDenied = (error: PlatformError.PlatformError): boolean => {
  const code = (error.reason as { cause?: { code?: unknown } }).cause?.code;
  return code === "EPERM";
};

/** TCC allows stat but gates read: only an EPERM opening the jar proves Full Disk Access is missing. */
export const safariAccessDenied = Effect.fnUntraced(function* (cookiePath: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.open(cookiePath, { flag: "r" }).pipe(
    Effect.as(false),
    Effect.catch((cause) => Effect.succeed(isPermissionDenied(cause))),
    Effect.scoped,
  );
});

/** A missing or unreadable jar is never evidence that access was granted. */
export const safariAccessGranted = Effect.fnUntraced(function* (cookiePath: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.open(cookiePath, { flag: "r" }).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
    Effect.scoped,
  );
});

export const readSafariCookies = Effect.fn("SafariCookies.readSafariCookies")(function* (
  cookiePath: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const contents = yield* fileSystem.readFile(cookiePath).pipe(
    Effect.mapError((cause) => {
      // macOS never prompts for Full Disk Access; map TCC refusal to the System Settings grant.
      return new SafariCookieReadError({
        reason: isPermissionDenied(cause) ? "needsFullDiskAccess" : "readFailed",
        cookieDatabasePath: cookiePath,
        cause,
      });
    }),
  );
  // The parser throws on a malformed jar; catch it here so callers see a typed
  // failure rather than a defect.
  return yield* Effect.try({
    try: () => parseBinaryCookies(Buffer.from(contents)),
    catch: (cause) =>
      isSafariCookieReadError(cause)
        ? new SafariCookieReadError({
            reason: cause.reason,
            cookieDatabasePath: cookiePath,
            cause,
          })
        : new SafariCookieReadError({
            reason: "readFailed",
            cookieDatabasePath: cookiePath,
            cause,
          }),
  });
});
