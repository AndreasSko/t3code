// Avoid native imports here: their untranspiled Flow syntax cannot run in Node.

export type NativeTopScrollEdgeEffect = "automatic" | "soft";
export type NativeHeaderScrollEdgeEffects = {
  readonly top: NativeTopScrollEdgeEffect;
  readonly bottom: "hidden";
  readonly left: "hidden";
  readonly right: "hidden";
};

export function nativeTopScrollEdgeEffect(
  os: string,
  _version: number | string,
): NativeTopScrollEdgeEffect {
  if (os !== "ios") {
    return "automatic";
  }

  // Forcing soft edges on iOS 27 overlays the content instead of sampling it edge-to-edge.
  return "automatic";
}

export function nativeHeaderScrollEdgeEffects(
  os: string,
  version: number | string,
): NativeHeaderScrollEdgeEffects {
  return {
    top: nativeTopScrollEdgeEffect(os, version),
    bottom: "hidden",
    left: "hidden",
    right: "hidden",
  };
}
