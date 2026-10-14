// Shared with client settings; keep this schema browser-safe.
import { CustomModelSetting, makeProviderSettingsSchema, TrimmedString } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const CursorSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    // CLI-based installs share this settings file, so preserve their unused configuration.
    binaryPath: Schema.optionalKey(TrimmedString).pipe(
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    apiEndpoint: Schema.optionalKey(TrimmedString).pipe(
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    customModels: Schema.Array(CustomModelSetting).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: [],
  },
);
export type CursorSettings = typeof CursorSettings.Type;
