export * from "./_generated/schema.gen.ts";
export * from "./_generated/meta.gen.ts";

// Compatibility aliases for downstream adapters; runtime schemas remain ACP v2.
export {
  CancelSessionNotification as CancelNotification,
  LoginAuthRequest as AuthenticateRequest,
  LoginAuthResponse as AuthenticateResponse,
  LogoutAuthRequest as LogoutRequest,
  LogoutAuthResponse as LogoutResponse,
  ResumeSessionRequest as LoadSessionRequest,
  ResumeSessionResponse as LoadSessionResponse,
  UpdateSessionNotification as SessionNotification,
} from "./_generated/schema.gen.ts";
