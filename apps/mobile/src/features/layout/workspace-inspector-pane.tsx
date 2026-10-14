import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { constrainAuxiliaryPaneWidth, type WorkspacePaneLayout } from "../../lib/layout";
import { RenderErrorBoundary, RenderFailureView } from "../../components/RenderErrorBoundary";
import { WORKSPACE_PANE_TIMING } from "./workspace-pane-animation";
import { WorkspacePaneDivider } from "./workspace-pane-divider";

/**
 * Render beside the navigator so its native header spans only the content pane.
 * Pass layout through props to avoid an import cycle with AdaptiveWorkspaceLayout.
 */
export function WorkspaceInspectorPane(props: {
  readonly pathname: string;
  readonly renderedInspectorWidth: SharedValue<number>;
  /**
   * False keeps content mounted during the close animation; onClosed lets the
   * owner release it after the animation settles.
   */
  readonly active?: boolean;
  readonly onClosed?: () => void;
  readonly panes: WorkspacePaneLayout;
  readonly renderInspector?: () => ReactNode;
  readonly setAuxiliaryPaneWidth: (width: number) => void;
}) {
  const { panes, setAuxiliaryPaneWidth } = props;
  const inspectorWidth = panes.auxiliaryPaneWidth;
  const inspectorSupported = props.renderInspector !== undefined && inspectorWidth !== null;
  const inspectorVisible =
    inspectorSupported && panes.auxiliaryPaneVisible && (props.active ?? true);
  const resizeStartWidth = useRef(0);
  const [resizing, setResizing] = useState(false);

  // Start an already-visible inspector at its final position so file-to-file
  // route replacement does not replay its entering transition.
  const inspectorProgress = useSharedValue(inspectorVisible ? 1 : 0);
  const { renderedInspectorWidth } = props;
  // Keep content laid out while the outer width clips it, avoiding text reflow.
  // Animate visible content-width changes with the reveal to avoid snapping.
  const renderedContentWidth = useSharedValue(inspectorWidth ?? 0);

  const onClosed = props.onClosed;
  useEffect(() => {
    inspectorProgress.value = withTiming(
      inspectorVisible ? 1 : 0,
      WORKSPACE_PANE_TIMING,
      (finished) => {
        if (finished === true && !inspectorVisible && onClosed !== undefined) {
          runOnJS(onClosed)();
        }
      },
    );
    const targetWidth = inspectorVisible ? (inspectorWidth ?? 0) : 0;
    renderedInspectorWidth.value = resizing
      ? targetWidth
      : withTiming(targetWidth, WORKSPACE_PANE_TIMING);
  }, [
    inspectorProgress,
    inspectorVisible,
    inspectorWidth,
    onClosed,
    renderedInspectorWidth,
    resizing,
  ]);

  useEffect(() => {
    const targetWidth = inspectorWidth ?? 0;
    if (!inspectorVisible || resizing) {
      renderedContentWidth.value = targetWidth;
      return;
    }
    renderedContentWidth.value = withTiming(targetWidth, WORKSPACE_PANE_TIMING);
  }, [inspectorVisible, inspectorWidth, renderedContentWidth, resizing]);

  const inspectorStyle = useAnimatedStyle(
    () => ({
      opacity: inspectorProgress.value,
      transform: [{ translateX: (1 - inspectorProgress.value) * 24 }],
      width: renderedInspectorWidth.value,
    }),
    [],
  );
  const inspectorContentStyle = useAnimatedStyle(() => ({ width: renderedContentWidth.value }), []);
  const beginResize = useCallback(() => {
    resizeStartWidth.current = inspectorWidth ?? 0;
    setResizing(true);
  }, [inspectorWidth]);
  const resizeBy = useCallback(
    (delta: number) => {
      setAuxiliaryPaneWidth(
        constrainAuxiliaryPaneWidth({
          preferredWidth: resizeStartWidth.current + delta,
          availableWidth: panes.contentPaneWidth,
        }),
      );
    },
    [panes.contentPaneWidth, setAuxiliaryPaneWidth],
  );
  const endResize = useCallback(() => {
    setResizing(false);
  }, []);

  return (
    <>
      {inspectorVisible ? (
        <WorkspacePaneDivider
          accessibilityLabel="Resize detail pane"
          currentWidth={inspectorWidth ?? 0}
          resizeDirection={-1}
          onResizeStart={beginResize}
          onResizeBy={resizeBy}
          onResizeEnd={endResize}
        />
      ) : null}
      {inspectorSupported ? (
        <Animated.View
          className="shrink-0 overflow-hidden"
          accessibilityElementsHidden={!inspectorVisible}
          collapsable={false}
          importantForAccessibility={inspectorVisible ? "auto" : "no-hide-descendants"}
          pointerEvents={inspectorVisible ? "auto" : "none"}
          style={inspectorStyle}
        >
          <Animated.View className="flex-1" style={inspectorContentStyle}>
            <RenderErrorBoundary
              resetKeys={[props.pathname]}
              renderFallback={(fallback) => (
                <RenderFailureView {...fallback} title="The inspector couldn't be displayed" />
              )}
            >
              <InspectorRenderer render={props.renderInspector} />
            </RenderErrorBoundary>
          </Animated.View>
        </Animated.View>
      ) : null}
    </>
  );
}

// The render callback must run inside the boundary's child, not while its
// parent constructs the boundary element.
function InspectorRenderer(props: { readonly render?: () => ReactNode }) {
  return <>{props.render?.()}</>;
}
