/** Imports cookies, never passwords: Electron has no password store.
 * Availability distinguishes recoverable permissions from unsupported platforms. */
import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { BrowserProfileId } from "./browserProfile.ts";

const BROWSER_IMPORT_SOURCE_IDS = [
  "chrome",
  "edge",
  "brave",
  "vivaldi",
  "opera",
  "arc",
  "helium",
  "firefox",
  "safari",
] as const;

export const BrowserImportSourceId = Schema.Literals(BROWSER_IMPORT_SOURCE_IDS);
export type BrowserImportSourceId = typeof BrowserImportSourceId.Type;

/** Keychain approval and running browsers are recoverable; Windows App-Bound Encryption is unsupported. */
export const BrowserImportUnavailableReason = Schema.Literals([
  "notInstalled",
  "needsKeychainApproval",
  "keychainItemMissing",
  "needsFullDiskAccess",
  "browserRunning",
  "unsupportedPlatform",
]);
export type BrowserImportUnavailableReason = typeof BrowserImportUnavailableReason.Type;

/** Preflight may pass before import fails, e.g. when the user declines a keychain prompt. */
export const BrowserImportFailureReason = Schema.Literals([
  ...BrowserImportUnavailableReason.literals,
  /** The operating system's keyring or its bundled reader is unavailable. */
  "keychainUnavailable",
  "unknownSource",
  /** The requested profile directory is not one the source reported. */
  "unknownSourceProfile",
  /** The target profile's Electron session could not be opened. */
  "sessionUnavailable",
  /** Failed settings persistence clears the written partition so no orphan profile remains. */
  "profileNotSaved",
  /** A concurrently reached profile cap clears the new partition instead of leaving an orphan. */
  "profileLimitReached",
  /** Anything else: a corrupt database, a failed decrypt, a vanished file. */
  "readFailed",
]);
export type BrowserImportFailureReason = typeof BrowserImportFailureReason.Type;

export const BrowserImportSourceProfile = Schema.Struct({
  /** Directory name under the source's user-data dir. */
  directory: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  /** Counted without decryption; absent when unreadable, e.g. Safari before Full Disk Access. */
  cookieCount: Schema.optional(Schema.Int),
});
export type BrowserImportSourceProfile = typeof BrowserImportSourceProfile.Type;

export const BrowserImportSource = Schema.Struct({
  id: BrowserImportSourceId,
  name: TrimmedNonEmptyString,
  profiles: Schema.Array(BrowserImportSourceProfile),
  /** Absent when the source is importable. */
  unavailable: Schema.optional(BrowserImportUnavailableReason),
});
export type BrowserImportSource = typeof BrowserImportSource.Type;

export const BrowserImportInput = Schema.Struct({
  sourceId: BrowserImportSourceId,
  sourceProfileDirectory: TrimmedNonEmptyString,
  targetProfileId: BrowserProfileId,
});
export type BrowserImportInput = typeof BrowserImportInput.Type;

/** IPC payload: the import input plus the environment the partition belongs to. */
export const DesktopPreviewImportCookiesInputSchema = Schema.Struct({
  environmentId: TrimmedNonEmptyString,
  sourceId: BrowserImportSourceId,
  sourceProfileDirectory: TrimmedNonEmptyString,
  targetProfileId: BrowserProfileId,
});

export const BrowserImportResult = Schema.Struct({
  imported: Schema.Int,
  /** Expired, malformed, or undecryptable cookies are reported so mostly-failed imports do not appear successful. */
  skipped: Schema.Int,
  /** Capped host list identifies skipped sessions without exposing thousands of entries. */
  skippedDomains: Schema.Array(Schema.String),
});
export type BrowserImportResult = typeof BrowserImportResult.Type;

const BROWSER_IMPORT_UNAVAILABLE_COPY: Readonly<Record<BrowserImportUnavailableReason, string>> = {
  notInstalled: "Not installed on this machine.",
  needsKeychainApproval: "Needs Keychain access to read its cookies.",
  keychainItemMissing:
    "No encryption key in your Keychain — sign in to that browser once, then retry.",
  needsFullDiskAccess:
    "Give T3 Code Full Disk Access in System Settings → Privacy & Security, then retry.",
  browserRunning: "Quit the browser first so its cookie database can be read.",
  unsupportedPlatform: "Importing from this browser isn't possible on this platform.",
};

export const BROWSER_IMPORT_FAILURE_COPY: Readonly<Record<BrowserImportFailureReason, string>> = {
  ...BROWSER_IMPORT_UNAVAILABLE_COPY,
  keychainUnavailable:
    "The system keyring could not be accessed. Make sure your desktop keyring is running and unlocked, then retry.",
  unknownSource: "That browser is no longer available to import from.",
  unknownSourceProfile: "That browser profile no longer exists.",
  sessionUnavailable: "The target profile could not be opened.",
  profileNotSaved: "The cookies were imported, but the new profile couldn't be saved. Try again.",
  profileLimitReached:
    "You've reached the profile limit. Delete a profile or import into an existing one.",
  readFailed: "The browser's cookie database could not be read.",
};
