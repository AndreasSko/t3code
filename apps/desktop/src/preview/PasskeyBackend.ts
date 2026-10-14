import type { PasskeyCeremonyResult } from "./PasskeyBridge.ts";

/** What the shared bridge has already checked before a backend runs a ceremony. */
export interface PasskeyCeremonyContext {
  /** The committed origin of the frame that asked; never the page's own claim. */
  readonly origin: string;
  /** The window the system sheet attaches to. */
  readonly nativeWindowHandle: Buffer;
}

/** The bridge owns origin, focus, concurrency, deadlines, and navigation checks; backends only invoke the platform. */
export interface PasskeyBackend {
  readonly create: (
    publicKey: PublicKeyCredentialCreationOptions,
    context: PasskeyCeremonyContext,
  ) => Promise<PasskeyCeremonyResult>;
  readonly get: (
    publicKey: PublicKeyCredentialRequestOptions,
    context: PasskeyCeremonyContext,
  ) => Promise<PasskeyCeremonyResult>;
}
