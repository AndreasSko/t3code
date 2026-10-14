import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import type { ImageSource } from "expo-image";

/** Cache immutable attachments by id because freshly signed URLs change on every mint or reconnect. */
export function assetImageSource(
  environmentId: EnvironmentId,
  resource: AssetResource,
  uri: string,
): ImageSource {
  return resource._tag === "attachment"
    ? {
        uri,
        cacheKey: `t3-attachment:${JSON.stringify([environmentId, resource.attachmentId])}`,
      }
    : { uri };
}
