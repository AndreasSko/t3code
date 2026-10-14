import { useAtomValue } from "@effect/atom-react";
import { useChildThreadInputs, useThreadReportedModelSelection } from "../../state/entities";
import { UsageLimitRecoveryCard } from "./UsageLimitRecoveryCard";
import { useNavigation } from "@react-navigation/native";
import type { WorktreeSetupCardProps } from "./worktree-setup-card";
import type { ComposerTextPaste } from "../../native/T3ComposerEditor.types";
import { type EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { HandoffEndpoints } from "@t3tools/client-runtime/handoff";
import type {
  CodexFeedbackSubmission,
  EnvironmentThreadStatus,
} from "@t3tools/client-runtime/state/threads";
import { useKeyboardChatComposerInset, useKeyboardScrollToEnd } from "@legendapp/list/keyboard";
import { resolveProviderSkillsForCwd } from "@t3tools/client-runtime/providerSkills";
import type { LegendListRef } from "@legendapp/list/react-native";
import { HeaderHeightContext } from "@react-navigation/elements";
import { NativeLayoutObserver } from "../../native/NativeLayoutObserver";
import { deriveBottomControlInsets, type NativeLayoutMetrics } from "../../lib/reserved-regions";
import type {
  EnvironmentId,
  MessageId,
  ModelSelection,
  ProviderApprovalDecision,
  ProviderInteractionMode,
  RuntimeMode,
  RuntimeRequestId,
  ServerConfig as T3ServerConfig,
  ThreadId,
  UsageLimitsReport,
} from "@t3tools/contracts";
import {
  appendCodexArtifactTemplateUsePrompt,
  type CodexArtifactTemplate,
} from "@t3tools/shared/codexArtifactTemplates";
import type { ThreadUserInputQuestion } from "@t3tools/client-runtime/state/thread-requests";
import {
  presentPendingBackgroundWork,
  presentProviderGoal,
} from "@t3tools/client-runtime/state/thread-execution";
import { resolveSubagentPillSegment } from "@t3tools/client-runtime/state/thread-subagents";
import {
  formatModelSelectionEffort,
  type ProviderSubagentStatus,
} from "@t3tools/client-runtime/state/thread-execution";
import { formatModelSlugName, resolveSelectableModel } from "@t3tools/shared/model";
import { isProviderNativeSubagentThread } from "@t3tools/contracts";
import type { QueuedRunEdit } from "../../state/queued-run-edit";
import type { FollowUpBehavior } from "../../lib/followUpBehavior";
import type { ActiveTurnComposerAction } from "@t3tools/client-runtime/state/composer-dispatch";
import * as Haptics from "expo-haptics";
import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  AppState,
  Keyboard,
  Platform,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type ViewInstance,
} from "react-native";
import {
  KeyboardController,
  KeyboardStickyView,
  useKeyboardState,
} from "react-native-keyboard-controller";
import Animated, {
  Easing,
  FadeInDown,
  FadeOut,
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWorkspaceContentWidth } from "../layout/workspace-content-width";
import { useNativeWorkspaceColumnsSupported } from "../../native/NativeWorkspaceColumns";
import { useNativeColumnLayoutMetrics } from "../../native/native-layout-metrics";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { collectProviderUsageLimits } from "@t3tools/shared/usageLimits";
import type { ComposerEditorHandle } from "../../components/ComposerEditor";
import type { StatusTone } from "../../components/StatusPill";
import type { DraftComposerAttachment } from "../../lib/composerImages";
import { RenderErrorBoundary, RenderFailureView } from "../../components/RenderErrorBoundary";
import { CHAT_CONTENT_MAX_WIDTH, type LayoutVariant } from "../../lib/layout";
import { editPendingThreadMessage } from "../../state/edit-pending-thread-message";
import { deviceEnvironment } from "../../state/device";
import { useEnvironmentQuery } from "../../state/query";
import { threadDevicePreviews } from "../devices/threadDevicePreviews";
import { ThreadBrowserFloat } from "../browser/ThreadBrowserFloat";
import { useThreadServerBrowserTabs } from "../../state/preview";
import type { QueuedThreadMessage } from "../../state/thread-outbox-model";
import { scopedThreadKey } from "../../lib/scopedEntities";
import {
  clearThreadComposerError,
  threadComposerErrorsAtom,
} from "../../state/thread-composer-error";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useDelayedStatus } from "../../lib/useDelayedStatus";
import type {
  PendingApproval,
  PendingUserInput,
  PendingUserInputDraftAnswer,
  ThreadFeedEntry,
  ThreadFeedLatestRun,
} from "../../lib/threadActivity";
import { PendingApprovalCard } from "./PendingApprovalCard";
import { ComposerErrorNotice } from "./ComposerErrorNotice";
import { ComposerFeedback } from "./ComposerFeedback";
import { ComposerUsageLimits } from "./ComposerUsageLimits";
import { PendingUserInputCard } from "./PendingUserInputCard";
import { ProviderSubagentBar } from "./ProviderSubagentBar";
import { ThreadCreationFailedCard } from "./ThreadCreationFailedCard";
import {
  FLOATING_WORKING_CONTROL_COVERAGE,
  FloatingWorkingControl,
} from "./floating-working-control";
import { connectionFloatingStatus, type FloatingWorkingStatus } from "./floating-working-status";
import {
  derivePendingUserInputMaxHeight,
  ESTIMATED_KEYBOARD_HEIGHT,
  USER_INPUT_TOGGLE_DURATION_MS,
} from "./pendingUserInputLayout";
import {
  COMPOSER_COLLAPSED_CHROME,
  COMPOSER_EXPANDED_CHROME,
  COMPOSER_LAYOUT_TRANSITION,
  COMPOSER_TRANSITION_DURATION_MS,
  ThreadComposer,
} from "./ThreadComposer";
import { ComposerPopoverHost } from "./ComposerPopoverHost";
import { ThreadFeed, type ThreadFeedHistoryControls } from "./ThreadFeed";
import { useThreadTurnSubagents } from "./ThreadAgentsSheet";
import { ComposerQueuedEditBanner } from "./ComposerQueuedEdit";
import { useThreadQueuedCount } from "./ThreadQueueControl";
import type { ThreadContentPresentation } from "./threadContentPresentation";
import { resolveThreadFeedSubmissionAnchor } from "./thread-feed-live-follow";
import { useGlobalVoiceInput } from "../voice-input/VoiceInputProvider";

export interface ThreadDetailScreenProps {
  readonly worktreeSetup?: WorktreeSetupCardProps | null;
  readonly setupWorkingStartedAt?: string | null;
  readonly canOperateThread: boolean;
  readonly selectedThread: EnvironmentThreadShell;
  readonly contentPresentation: ThreadContentPresentation;
  readonly screenTone: StatusTone;
  readonly connectionError: string | null;
  readonly environmentLabel: string | null;
  readonly feedbackSubmissions: ReadonlyArray<CodexFeedbackSubmission>;
  readonly onDismissFeedback: (id: MessageId) => void;
  readonly selectedThreadFeed: ReadonlyArray<ThreadFeedEntry>;
  readonly pendingHandoff?: HandoffEndpoints | null;
  readonly activityRun: ThreadFeedLatestRun | null;
  readonly activeWorkStartedAt: string | null;
  /** The live work is a provider-native subagent's runless root turn. */
  readonly runlessWorkActive?: boolean;
  /** Set on a provider-native subagent thread, which shows status instead of a composer. */
  readonly providerSubagentStatus?: ProviderSubagentStatus | null;
  readonly isCompacting: boolean;
  /** Preparing covers queued creation or server-owned setup; follow-ups queue behind that setup. Failures restore the draft. */
  readonly creationState:
    | {
        readonly kind: "preparing";
        readonly preparingWorktree: boolean;
        readonly serverOwned: boolean;
      }
    | { readonly kind: "failed"; readonly reason: string; readonly onEditTask: () => void }
    | null;
  readonly activePendingApproval: PendingApproval | null;
  readonly respondingApprovalId: RuntimeRequestId | null;
  readonly activePendingUserInput: PendingUserInput | null;
  readonly activePendingUserInputDrafts: Record<string, PendingUserInputDraftAnswer>;
  readonly activePendingUserInputAnswers: Record<string, string | ReadonlyArray<string>> | null;
  readonly respondingUserInputId: RuntimeRequestId | null;
  readonly draftMessage: string;
  readonly draftAttachments: ReadonlyArray<DraftComposerAttachment>;
  readonly connectionStateLabel: EnvironmentConnectionPhase;
  readonly threadSyncStatus?: EnvironmentThreadStatus;
  readonly historyControls?: ThreadFeedHistoryControls;
  readonly activeThreadBusy: boolean;
  readonly canStopThread: boolean;
  readonly queuedRunEdit: QueuedRunEdit | null;
  readonly composerDraftKey: string | null;
  readonly followUpBehavior: FollowUpBehavior;
  readonly canSteerActiveTurn: boolean;
  readonly isSavingQueuedEdit: boolean;
  readonly onCancelQueuedRunEdit: () => void;
  readonly onRemoveQueuedEditAttachment: (attachmentId: string) => void;
  readonly environmentId: EnvironmentId;
  readonly projectWorkspaceRoot: string | null;
  readonly threadCwd: string | null;
  readonly selectedThreadQueueCount: number;
  readonly queuedMessages: ReadonlyArray<QueuedThreadMessage>;
  readonly dispatchingMessageId: MessageId | null;
  readonly serverConfig: T3ServerConfig | null;
  readonly layoutVariant?: LayoutVariant;
  readonly usesAutomaticContentInsets?: boolean;
  readonly onHeaderMaterialVisibilityChange?: (visible: boolean) => void;
  readonly onOpenConnectionEditor: () => void;
  readonly onChangeDraftMessage: (value: string) => void;
  readonly onPickDraftMedia: () => Promise<void>;
  readonly onPickDraftFiles: () => Promise<void>;
  readonly onNativePasteImages: (uris: ReadonlyArray<string>) => Promise<void>;
  readonly onNativePasteText: (paste: ComposerTextPaste) => Promise<void>;
  readonly onRemoveDraftImage: (imageId: string) => void;
  readonly onStopThread: () => void;
  readonly onSendMessage: (followUp?: ActiveTurnComposerAction) => Promise<MessageId | null>;
  readonly onReconnectEnvironment: () => void;
  readonly canSwitchThreadProvider: boolean;
  readonly onUpdateThreadModelSelection: (modelSelection: ModelSelection) => void;
  readonly onUpdateThreadRuntimeMode: (runtimeMode: RuntimeMode) => void;
  readonly onUpdateThreadInteractionMode: (interactionMode: ProviderInteractionMode) => void;
  readonly onRespondToApproval: (
    requestId: RuntimeRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
  readonly onSelectUserInputOption: (
    requestId: RuntimeRequestId,
    question: ThreadUserInputQuestion,
    value: string,
  ) => void;
  readonly onChangeUserInputCustomAnswer: (
    requestId: RuntimeRequestId,
    questionId: string,
    customAnswer: string,
  ) => void;
  readonly onSubmitUserInput: () => Promise<unknown>;
  readonly onDismissUserInput: () => Promise<unknown>;
  readonly showContent?: boolean;
}

function latestStreamingAssistantMessage(
  feed: ReadonlyArray<ThreadFeedEntry>,
): { readonly id: string; readonly textLength: number } | null {
  for (let index = feed.length - 1; index >= 0; index -= 1) {
    const entry = feed[index];
    if (entry?.type !== "message") {
      continue;
    }
    if (entry.message.role !== "assistant" || !entry.message.streaming) {
      continue;
    }
    return {
      id: entry.message.id,
      textLength: entry.message.text.length,
    };
  }

  return null;
}

function useStreamingHaptics(threadId: ThreadId, feed: ReadonlyArray<ThreadFeedEntry>) {
  const lastStreamingAssistantRef = useRef<{
    readonly id: string;
    readonly textLength: number;
  } | null>(null);
  const lastStreamHapticAtRef = useRef(0);
  const hydratedRef = useRef(false);
  const previousThreadIdRef = useRef(threadId);

  useEffect(() => {
    if (previousThreadIdRef.current !== threadId) {
      previousThreadIdRef.current = threadId;
      hydratedRef.current = false;
    }

    const latestStreamingMessage = latestStreamingAssistantMessage(feed);

    if (!hydratedRef.current) {
      hydratedRef.current = true;
      lastStreamingAssistantRef.current = latestStreamingMessage;
      return;
    }

    if (!latestStreamingMessage) {
      lastStreamingAssistantRef.current = null;
      return;
    }

    const previousStreamingMessage = lastStreamingAssistantRef.current;
    lastStreamingAssistantRef.current = latestStreamingMessage;

    const isNewStream = previousStreamingMessage?.id !== latestStreamingMessage.id;
    const textGrew =
      previousStreamingMessage?.id === latestStreamingMessage.id &&
      latestStreamingMessage.textLength > previousStreamingMessage.textLength;

    if (!isNewStream && !textGrew) {
      return;
    }

    const now = Date.now();
    if (!isNewStream && now - lastStreamHapticAtRef.current < 320) {
      return;
    }

    lastStreamHapticAtRef.current = now;
    void Haptics.selectionAsync();
  }, [threadId, feed]);
}

const USER_INPUT_TOGGLE_TIMING = {
  duration: USER_INPUT_TOGGLE_DURATION_MS,
  easing: Easing.out(Easing.cubic),
};

export const ThreadDetailScreen = memo(function ThreadDetailScreen(props: ThreadDetailScreenProps) {
  const usesNativeWorkspaceColumns = useNativeWorkspaceColumnsSupported();
  const navigation = useNavigation();
  const { session: voiceInputSession } = useGlobalVoiceInput();
  const reportedModelSelection = useThreadReportedModelSelection({
    environmentId: props.environmentId,
    threadId: props.selectedThread.id,
  });
  const deviceState = useEnvironmentQuery(
    deviceEnvironment.state({ environmentId: props.environmentId, input: {} }),
  );
  const devicePreviews = useMemo(
    () => threadDevicePreviews(deviceState.data, props.selectedThread.id),
    [deviceState.data, props.selectedThread.id],
  );
  const openDevicePreview = useCallback(() => {
    Keyboard.dismiss();
    navigation.navigate("ThreadDevicePreview", {
      environmentId: props.environmentId,
      threadId: props.selectedThread.id,
    });
  }, [navigation, props.environmentId, props.selectedThread.id]);
  const browserTabs = useThreadServerBrowserTabs({
    environmentId: props.environmentId,
    threadId: props.selectedThread.id,
    enabled: props.serverConfig?.environment.capabilities.serverBrowser === true,
  });
  const openBrowserPreview = useCallback(
    (tabId?: string) => {
      Keyboard.dismiss();
      navigation.navigate("ThreadBrowserPreview", {
        environmentId: props.environmentId,
        threadId: props.selectedThread.id,
        ...(tabId === undefined ? {} : { tabId }),
      });
    },
    [navigation, props.environmentId, props.selectedThread.id],
  );
  const insets = useSafeAreaInsets();
  const isKeyboardVisible = useKeyboardState((state) => state.isVisible);
  const liveKeyboardHeight = useKeyboardState((state) => state.height);
  // Android can swallow IME-hide callbacks when backgrounded mid-hide, leaving height/visibility stale.
  // Quarantine sticky translation on resume until focus or keyboard-stream movement confirms live state.
  const [keyboardStateSuspect, setKeyboardStateSuspect] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        setKeyboardStateSuspect(true);
      }
    });
    return () => {
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    setKeyboardStateSuspect(false);
  }, [isKeyboardVisible, liveKeyboardHeight]);
  const handleOwnedInputFocusChange = useCallback((focused: boolean) => {
    if (focused) {
      setKeyboardStateSuspect(false);
    }
  }, []);
  const windowHeight = useWindowDimensions().height;
  const navigationHeaderHeight = useContext(HeaderHeightContext) ?? insets.top + 44;
  const [screenMetrics, setScreenMetrics] = useState<NativeLayoutMetrics | null>(null);
  const columnMetrics = useNativeColumnLayoutMetrics();
  const nativeMetrics = usesNativeWorkspaceColumns ? columnMetrics : screenMetrics;
  const controlInsets = deriveBottomControlInsets(nativeMetrics);
  const agentLabel = `${props.selectedThread.modelSelection.instanceId} agent`;
  const selectedThreadKey = scopedThreadKey(props.environmentId, props.selectedThread.id);
  const childThreadInputs = useChildThreadInputs({
    environmentId: props.environmentId,
    threadId: props.selectedThread.id,
  });
  const composerError = useAtomValue(threadComposerErrorsAtom)[selectedThreadKey]?.message ?? null;
  const queuedCount = useThreadQueuedCount({
    environmentId: props.environmentId,
    threadId: props.selectedThread.id,
  });
  const turnSubagents = useThreadTurnSubagents({
    environmentId: props.environmentId,
    threadId: props.selectedThread.id,
  });
  const agentsSegment = resolveSubagentPillSegment(turnSubagents);
  const composerEditorRef = useRef<ComposerEditorHandle>(null);
  const isProviderSubagent = isProviderNativeSubagentThread(props.selectedThread.source);
  // Enter queued-edit mode with the composer focused so it does not need a second tap.
  const editingRunId = props.queuedRunEdit?.runId ?? null;
  useEffect(() => {
    if (editingRunId === null) return;
    const frame = requestAnimationFrame(() => composerEditorRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [editingRunId]);
  const draftMessageRef = useRef(props.draftMessage);
  draftMessageRef.current = props.draftMessage;
  const composerOverlayRef = useRef<ViewInstance>(null);
  const listRef = useRef<LegendListRef>(null);
  const feedTouchStartRef = useRef<{ pageX: number; pageY: number } | null>(null);
  const selectedThreadKeyRef = useRef(selectedThreadKey);
  const lastScrolledSubmittedMessageIdRef = useRef<MessageId | null>(null);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const handleComposerFocusChange = useCallback(
    (focused: boolean) => {
      setComposerFocused(focused);
      handleOwnedInputFocusChange(focused);
    },
    [handleOwnedInputFocusChange],
  );
  const [anchorMessageId, setAnchorMessageId] = useState<MessageId | null>(null);
  const [submittedMessageId, setSubmittedMessageId] = useState<MessageId | null>(null);
  const [endFollowEnabled, setEndFollowEnabled] = useState(true);
  // Android back can hide the keyboard without blur (#5988); inset from visibility there.
  // iOS visibility changes after hide animation, so use focus to avoid a late safe-area snap.
  const composerBottomInset = (
    Platform.OS === "android" ? isKeyboardVisible : composerExpanded || composerFocused
  )
    ? 0
    : Math.max(insets.bottom, 12);
  const contentPresentationKind = props.contentPresentation.kind;
  // Full fetches all report synchronizing; distinguish first load from reconciliation of visible messages.
  const realThreadSyncLabel = (() => {
    switch (props.threadSyncStatus) {
      case "empty":
      case "cached":
      case "synchronizing":
        if (contentPresentationKind === "ready") {
          return "Syncing messages...";
        }
        return contentPresentationKind === "loading" ? "Loading messages..." : null;
      default:
        return null;
    }
  })();
  // Delay the sync label so brief running-thread resyncs do not flash before the timer.
  const threadSyncLabel = useDelayedStatus(selectedThreadKey, realThreadSyncLabel);
  // The shell's roster is the server's post-settlement view of what still runs.
  const pendingBackgroundWork = presentPendingBackgroundWork(
    props.selectedThread.pendingBackgroundTasks,
  );
  const floatingStatus = ((): FloatingWorkingStatus | null => {
    const connectionStatus = connectionFloatingStatus({
      connectionError: props.connectionError,
      connectionState: props.connectionStateLabel,
      environmentLabel: props.environmentLabel,
      onReconnect: props.onReconnectEnvironment,
    });
    if (connectionStatus !== null) {
      return connectionStatus;
    }
    if (props.activePendingApproval !== null || props.activePendingUserInput !== null) {
      return null;
    }
    if (props.creationState?.kind === "preparing") {
      if (props.worktreeSetup) return null;
      return {
        kind: "preparing",
        label: props.creationState.preparingWorktree ? "Setting up worktree…" : "Starting…",
      };
    }
    if (props.creationState?.kind === "failed") {
      return null;
    }
    if (threadSyncLabel !== null) {
      return { kind: "syncing", label: threadSyncLabel };
    }
    const childInput = childThreadInputs[0];
    if (childInput && contentPresentationKind === "ready") {
      return {
        kind: "child-input",
        label:
          childThreadInputs.length === 1
            ? "Subagent needs input"
            : `${childThreadInputs.length} subagents need input`,
        accessibilityLabel: `Open question from ${childInput.title}`,
        onPress: () => {
          Keyboard.dismiss();
          navigation.navigate("Thread", {
            environmentId: props.environmentId,
            threadId: childInput.id,
          });
        },
      };
    }
    if (props.isCompacting && contentPresentationKind === "ready") {
      return { kind: "compacting" };
    }
    if (props.activeWorkStartedAt !== null && contentPresentationKind === "ready") {
      return { kind: "working", startedAt: props.activeWorkStartedAt };
    }
    if (pendingBackgroundWork !== null && contentPresentationKind === "ready") {
      return {
        kind: "background",
        label: pendingBackgroundWork.title,
        accessibilityLabel: `${pendingBackgroundWork.title}: ${pendingBackgroundWork.items
          .map((item) => item.label)
          .join(", ")}`,
        waiting: pendingBackgroundWork.waiting,
      };
    }
    if (props.selectedThread.goal !== null && contentPresentationKind === "ready") {
      const goal = presentProviderGoal(props.selectedThread.goal, false);
      return {
        kind: "goal",
        label: goal.title,
        accessibilityLabel: `${goal.title}: ${goal.objective}`,
      };
    }
    return null;
  })();
  const showWorkingControl = floatingStatus !== null;
  // Keep the feed inset stable through reconnect, sync, and working-label handoffs.
  const showFloatingStatus =
    showWorkingControl ||
    queuedCount > 0 ||
    agentsSegment !== null ||
    devicePreviews.length > 0 ||
    browserTabs.tabs.length > 0 ||
    props.connectionStateLabel !== "connected" ||
    props.queuedMessages.length > 0 ||
    props.selectedThreadFeed.some(
      (entry) => "acknowledged" in entry && entry.acknowledged === true,
    );
  const selectedThreadFeed = props.selectedThreadFeed;
  const hasCompactableConversation =
    selectedThreadFeed.some(
      (entry) =>
        entry.type === "message" &&
        entry.message.role === "user" &&
        ((entry.message.attachments?.length ?? 0) > 0 ||
          entry.message.text.trim().toLowerCase() !== "/compact"),
    ) ||
    (props.historyControls?.hasMoreHistory === true &&
      props.selectedThread.latestUserMessageAt !== null);
  const composerChrome = composerExpanded ? COMPOSER_EXPANDED_CHROME : COMPOSER_COLLAPSED_CHROME;
  const composerOverlapHeight = composerChrome + composerBottomInset;
  // Requests own the composer slot; key collapse by request id so each new request expands.
  // Keep the composer outside the transition to preserve keyboard/collapse motion.
  const [collapsedUserInputRequestId, setCollapsedUserInputRequestId] =
    useState<RuntimeRequestId | null>(null);
  const activeUserInputRequestId = props.activePendingUserInput?.requestId ?? null;
  const composerSlotHidden =
    activeUserInputRequestId !== null || props.creationState?.kind === "failed";
  // Store only the panel-open key so usage data stays live; close when work can spend quota again.
  const [usageLimitsPanel, setUsageLimitsPanel] = useState<{
    readonly key: string;
    readonly threadKey: string;
    readonly now: number;
  } | null>(null);
  // A pending approval or question is part of the key: once it is answered,
  // from this client or any other, the agent resumes and spends quota.
  const usageLimitsKey = [
    selectedThreadKey,
    props.selectedThread.modelSelection.instanceId,
    props.selectedThread.latestRun?.runId ?? "",
    props.activePendingApproval?.requestId ?? props.activePendingUserInput?.requestId ?? "",
  ].join(":");
  if (usageLimitsPanel !== null && usageLimitsPanel.key !== usageLimitsKey) {
    setUsageLimitsPanel(null);
  }
  const usageLimitsReport = useMemo(
    () =>
      usageLimitsPanel !== null && usageLimitsPanel.key === usageLimitsKey
        ? collectProviderUsageLimits(
            props.selectedThread.modelSelection.instanceId,
            props.serverConfig?.providers ?? [],
            props.serverConfig?.usageLimitSources ?? [],
            usageLimitsPanel.now,
          )
        : null,
    [
      props.selectedThread.modelSelection.instanceId,
      props.serverConfig,
      usageLimitsKey,
      usageLimitsPanel,
    ],
  );
  const showUsageLimits = useCallback(
    (report: UsageLimitsReport | null) =>
      setUsageLimitsPanel(
        report === null
          ? null
          : {
              key: usageLimitsKey,
              threadKey: selectedThreadKey,
              now: Date.parse(report.createdAt),
            },
      ),
    [selectedThreadKey, usageLimitsKey],
  );
  const dismissUsageLimits = useCallback(() => setUsageLimitsPanel(null), []);
  // Async sends clear only the originating thread's panel, preserving any panel opened elsewhere.
  const clearUsageLimitsFor = useCallback(
    (threadKey: string) =>
      setUsageLimitsPanel((current) =>
        current !== null && current.threadKey === threadKey ? null : current,
      ),
    [],
  );
  const userInputCollapsed =
    activeUserInputRequestId !== null && collapsedUserInputRequestId === activeUserInputRequestId;
  // Reserve constant keyboard space: translation updates on the UI thread before Yoga height changes.
  // Tracking keyboard height would flash the card over the header; correct only discrete measurements.
  const [lastKnownKeyboardHeight, setLastKnownKeyboardHeight] = useState(0);
  useEffect(() => {
    if (liveKeyboardHeight > 0 && liveKeyboardHeight !== lastKnownKeyboardHeight) {
      setLastKnownKeyboardHeight(liveKeyboardHeight);
    }
  }, [lastKnownKeyboardHeight, liveKeyboardHeight]);
  const pendingUserInputMaxHeight = derivePendingUserInputMaxHeight({
    windowHeight,
    keyboardHeight:
      lastKnownKeyboardHeight > 0 ? lastKnownKeyboardHeight : ESTIMATED_KEYBOARD_HEIGHT,
    navigationHeaderHeight,
    // The questionnaire owns the composer slot, so only the composer's
    // bottom inset still overlaps.
    composerOverlapHeight: composerBottomInset,
  });
  const estimatedOverlayHeight = composerOverlapHeight;
  // UIKit adds safe-area bottom to automatic insets; subtract it from the measured composer overlap.
  // ThreadFeed restores it for LegendList end-scroll math.
  const nativeInsetOvercount =
    props.usesAutomaticContentInsets === true && Platform.OS === "ios" ? insets.bottom : 0;
  const { contentInsetEndAdjustment, onComposerLayout } = useKeyboardChatComposerInset(
    listRef,
    composerOverlayRef,
    Math.max(0, estimatedOverlayHeight - nativeInsetOvercount),
    -nativeInsetOvercount,
    Platform.OS === "ios" ? COMPOSER_TRANSITION_DURATION_MS : 0,
  );
  // Keep iOS overlay height constant to avoid feed snaps. Start card and feed motion from shared values
  // in the tap handler, avoiding React mount/layout round trips; measure coverage without rerendering.
  const userInputCardProgress = useSharedValue(1);
  const userInputInsetProgress = useSharedValue(1);
  const userInputCardCoverage = useSharedValue(0);
  const floatingControlCoverage = useSharedValue(
    showFloatingStatus ? FLOATING_WORKING_CONTROL_COVERAGE : 0,
  );
  useEffect(() => {
    floatingControlCoverage.value = withTiming(
      showFloatingStatus ? FLOATING_WORKING_CONTROL_COVERAGE : 0,
      { duration: 180, reduceMotion: ReduceMotion.System },
    );
  }, [floatingControlCoverage, showFloatingStatus]);
  // Android renders the card in-flow for hit-testing, so measured overlap already includes coverage.
  const userInputCoverageApplies = Platform.OS === "ios" && activeUserInputRequestId !== null;
  const combinedContentInsetEndAdjustment = useSharedValue(
    Math.max(0, estimatedOverlayHeight - nativeInsetOvercount),
  );
  useAnimatedReaction(
    () =>
      contentInsetEndAdjustment.value +
      floatingControlCoverage.value +
      (userInputCoverageApplies ? userInputInsetProgress.value * userInputCardCoverage.value : 0),
    (value) => {
      combinedContentInsetEndAdjustment.value = value;
    },
    [userInputCoverageApplies],
  );
  // Lift the floating control with the card so it never covers questions.
  const floatingControlLift = useDerivedValue(
    () =>
      userInputCoverageApplies ? userInputCardProgress.value * userInputCardCoverage.value : 0,
    [userInputCoverageApplies],
  );
  const { freeze, scrollMessageToEnd } = useKeyboardScrollToEnd({ listRef });
  const endFollowEnabledRef = useRef(true);
  endFollowEnabledRef.current = endFollowEnabled;
  const overlayRepinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousWorkingControlStateRef = useRef({
    threadKey: selectedThreadKey,
    visible: false,
  });
  // Inset corrections drift on short content; re-pin after settling and recheck follow state.
  // A gesture begun during the settle window must win.
  const scheduleOverlayRepin = useCallback(
    (delayMs: number) => {
      if (overlayRepinTimerRef.current !== null) {
        clearTimeout(overlayRepinTimerRef.current);
      }
      overlayRepinTimerRef.current = setTimeout(() => {
        overlayRepinTimerRef.current = null;
        if (!endFollowEnabledRef.current) {
          return;
        }
        void scrollMessageToEnd({ animated: false, closeKeyboard: false }).catch(() => {
          freeze.set(false);
        });
      }, delayMs);
    },
    [freeze, scrollMessageToEnd],
  );
  useEffect(
    () => () => {
      if (overlayRepinTimerRef.current !== null) {
        clearTimeout(overlayRepinTimerRef.current);
      }
    },
    [],
  );
  useEffect(() => {
    const previous = previousWorkingControlStateRef.current;
    const threadChanged = previous.threadKey !== selectedThreadKey;
    const visibilityChanged = previous.visible !== showFloatingStatus;
    previousWorkingControlStateRef.current = {
      threadKey: selectedThreadKey,
      visible: showFloatingStatus,
    };
    if ((!threadChanged && !visibilityChanged) || (threadChanged && !showFloatingStatus)) {
      return;
    }
    // LegendList misses short-content reanchoring on coverage changes; re-pin after the inset transition.
    scheduleOverlayRepin(230);
  }, [scheduleOverlayRepin, selectedThreadKey, showFloatingStatus]);
  const handleToggleUserInputCollapsed = useCallback(() => {
    if (activeUserInputRequestId === null) {
      return;
    }
    if (userInputCollapsed) {
      userInputCardProgress.value = withTiming(1, USER_INPUT_TOGGLE_TIMING);
      userInputInsetProgress.value = withTiming(1, USER_INPUT_TOGGLE_TIMING);
      setCollapsedUserInputRequestId(null);
      scheduleOverlayRepin(USER_INPUT_TOGGLE_DURATION_MS + 50);
    } else {
      // Collapsing hides custom-answer inputs; dismiss their keyboard with them.
      Keyboard.dismiss();
      userInputCardProgress.value = withTiming(0, USER_INPUT_TOGGLE_TIMING);
      // Drop the inset immediately: animating it down drifts the short-content end anchor.
      userInputInsetProgress.value = 0;
      setCollapsedUserInputRequestId(activeUserInputRequestId);
      scheduleOverlayRepin(60);
    }
  }, [
    activeUserInputRequestId,
    scheduleOverlayRepin,
    userInputCardProgress,
    userInputCollapsed,
    userInputInsetProgress,
  ]);
  useEffect(() => {
    userInputCardProgress.value = 1;
    userInputInsetProgress.value = 1;
  }, [activeUserInputRequestId, userInputCardProgress, userInputInsetProgress]);
  const showContent = props.showContent ?? true;
  const layoutVariant = props.layoutVariant ?? "compact";
  const isSplitLayout = layoutVariant === "split";
  const contentMaxWidth = isSplitLayout ? CHAT_CONTENT_MAX_WIDTH : undefined;
  const providerSubagentProvider = props.serverConfig?.providers.find(
    (provider) => provider.instanceId === props.selectedThread.modelSelection.instanceId,
  );
  // Providers can report a dated id or alias (claude-haiku-4-5-20251001).
  const providerSubagentModelSlug = providerSubagentProvider
    ? resolveSelectableModel(
        providerSubagentProvider.driver,
        props.selectedThread.modelSelection.model,
        providerSubagentProvider.models,
      )
    : null;
  const providerSubagentCatalogModel = providerSubagentProvider?.models.find(
    (model) => model.slug === providerSubagentModelSlug,
  );
  const workspaceContentWidth = useWorkspaceContentWidth();
  // Clearing animated width can retain an unfolded Android width; assign both layouts explicitly.
  const composerWidthStyle = useAnimatedStyle(() =>
    isSplitLayout && workspaceContentWidth !== null
      ? {
          width: Math.max(
            0,
            workspaceContentWidth.value - controlInsets.left - controlInsets.right,
          ),
          right: undefined,
        }
      : { width: undefined, right: controlInsets.right },
  );
  const selectedInstanceId = props.selectedThread.modelSelection.instanceId;
  useStreamingHaptics(props.selectedThread.id, props.selectedThreadFeed);
  const selectedProviderSkills = useMemo(() => {
    const provider = props.serverConfig?.providers.find(
      (candidate) => candidate.instanceId === selectedInstanceId,
    );
    return provider
      ? resolveProviderSkillsForCwd(provider, props.threadCwd ?? props.projectWorkspaceRoot)
      : [];
  }, [props.projectWorkspaceRoot, props.serverConfig, props.threadCwd, selectedInstanceId]);

  useLayoutEffect(() => {
    selectedThreadKeyRef.current = selectedThreadKey;
    // A replaced or unmounted native editor may not emit a blur event.
    setComposerFocused(false);
  }, [selectedThreadKey, showContent]);

  const visitThread = useAtomCommand(threadEnvironment.visit, { reportFailure: false });
  const lastDispatchedVisitRef = useRef<string | null>(null);
  const lastVisitDispatchRef = useRef({ threadKey: selectedThreadKey, at: 0 });
  const selectedThreadId = props.selectedThread.id;
  const selectedThreadUpdatedAt = props.selectedThread.updatedAt;
  const selectedThreadLastVisitedAt = props.selectedThread.lastVisitedAt;
  const selectedThreadCompletedAt = props.selectedThread.latestRun?.completedAt;
  useEffect(() => {
    // Persist visited watermarks across devices; skip servers that omit the field.
    if (!showContent || selectedThreadLastVisitedAt === undefined) return;
    const threadUpdatedAtMs = Date.parse(selectedThreadUpdatedAt);
    if (Number.isNaN(threadUpdatedAtMs)) return;
    const lastVisitedAtMs = selectedThreadLastVisitedAt
      ? Date.parse(selectedThreadLastVisitedAt)
      : NaN;
    if (!Number.isNaN(lastVisitedAtMs) && lastVisitedAtMs >= threadUpdatedAtMs) return;
    // Dedupe per watermark — the effect re-runs before the command echo lands.
    const dispatchKey = `${selectedThreadKey}:${selectedThreadUpdatedAt}`;
    if (lastDispatchedVisitRef.current === dispatchKey) return;
    const dispatch = () => {
      lastDispatchedVisitRef.current = dispatchKey;
      lastVisitDispatchRef.current = { threadKey: selectedThreadKey, at: Date.now() };
      void visitThread({
        environmentId: props.environmentId,
        input: { threadId: selectedThreadId, visitedAt: selectedThreadUpdatedAt },
      });
    };
    // Clear unseen completion immediately; throttle streaming watermarks to ten seconds.
    const completedAtMs = selectedThreadCompletedAt ? Date.parse(selectedThreadCompletedAt) : NaN;
    const hasUnseenCompletion =
      !Number.isNaN(completedAtMs) &&
      (Number.isNaN(lastVisitedAtMs) || completedAtMs > lastVisitedAtMs);
    const previous = lastVisitDispatchRef.current;
    const elapsed = Date.now() - previous.at;
    if (previous.threadKey !== selectedThreadKey || hasUnseenCompletion || elapsed >= 10_000) {
      dispatch();
      return;
    }
    const timer = setTimeout(dispatch, 10_000 - elapsed);
    return () => clearTimeout(timer);
  }, [
    props.environmentId,
    selectedThreadId,
    selectedThreadKey,
    selectedThreadLastVisitedAt,
    selectedThreadCompletedAt,
    selectedThreadUpdatedAt,
    showContent,
    visitThread,
  ]);

  useEffect(() => {
    setAnchorMessageId(null);
    setSubmittedMessageId(null);
    lastScrolledSubmittedMessageIdRef.current = null;
    setEndFollowEnabled(true);
    freeze.set(false);
  }, [freeze, selectedThreadKey]);

  useEffect(() => {
    if (
      submittedMessageId === null ||
      anchorMessageId !== submittedMessageId ||
      lastScrolledSubmittedMessageIdRef.current === submittedMessageId ||
      contentPresentationKind !== "ready" ||
      (!selectedThreadFeed.some(
        (entry) => entry.type === "message" && entry.id === submittedMessageId,
      ) &&
        !props.queuedMessages.some((message) => message.messageId === submittedMessageId))
    ) {
      return;
    }

    const targetThreadKey = selectedThreadKey;
    const frame = requestAnimationFrame(() => {
      if (selectedThreadKeyRef.current !== targetThreadKey) {
        return;
      }
      lastScrolledSubmittedMessageIdRef.current = submittedMessageId;
      // scrollMessageToEnd freezes keyboard insets; wait for dismissal so its hide event is not swallowed.
      // A swallowed hide would leave permanent bottom padding and overshoot the anchor.
      void KeyboardController.dismiss()
        .then(() => {
          if (
            selectedThreadKeyRef.current !== targetThreadKey ||
            lastScrolledSubmittedMessageIdRef.current !== submittedMessageId
          ) {
            return;
          }
          return scrollMessageToEnd({ animated: true, closeKeyboard: false });
        })
        .catch(() => {
          if (
            selectedThreadKeyRef.current !== targetThreadKey ||
            lastScrolledSubmittedMessageIdRef.current !== submittedMessageId
          ) {
            return;
          }
          lastScrolledSubmittedMessageIdRef.current = null;
          freeze.set(false);
        });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    anchorMessageId,
    submittedMessageId,
    freeze,
    contentPresentationKind,
    props.queuedMessages,
    selectedThreadFeed,
    scrollMessageToEnd,
    selectedThreadKey,
  ]);

  const handleSendMessage = useCallback(
    async (followUp?: ActiveTurnComposerAction) => {
      const targetThreadKey = selectedThreadKey;
      const hasUserMessage = selectedThreadFeed.some(
        (entry) => entry.type === "message" && entry.message.role === "user",
      );
      const messageId = await props.onSendMessage(followUp);
      if (messageId === null || selectedThreadKeyRef.current !== targetThreadKey) {
        return messageId;
      }

      clearUsageLimitsFor(targetThreadKey);

      setSubmittedMessageId(messageId);
      setAnchorMessageId(
        resolveThreadFeedSubmissionAnchor({
          currentAnchorMessageId: anchorMessageId,
          submittedMessageId: messageId,
          hasStartedTurn: props.selectedThread.latestRun !== null,
          hasUserMessage,
          queuedMessageCount: props.selectedThreadQueueCount,
        }),
      );
      composerEditorRef.current?.blur();
      return messageId;
    },
    [
      anchorMessageId,
      clearUsageLimitsFor,
      props.onSendMessage,
      props.selectedThread.latestRun,
      props.selectedThreadQueueCount,
      selectedThreadFeed,
      selectedThreadKey,
    ],
  );

  const handleEditPendingMessage = useCallback(async (message: QueuedThreadMessage) => {
    try {
      if (
        (await editPendingThreadMessage(message)) &&
        selectedThreadKeyRef.current === scopedThreadKey(message.environmentId, message.threadId)
      ) {
        composerEditorRef.current?.focus();
      }
    } catch (error) {
      Alert.alert(
        "Could not edit message",
        error instanceof Error ? error.message : "Please try again.",
      );
    }
  }, []);

  const collapseComposer = useCallback(() => {
    composerEditorRef.current?.blur();
  }, []);

  const handleUseArtifactTemplate = useCallback(
    (template: CodexArtifactTemplate) => {
      const currentDraft = draftMessageRef.current;
      const nextDraft = appendCodexArtifactTemplateUsePrompt(currentDraft, template);
      if (nextDraft !== currentDraft) {
        draftMessageRef.current = nextDraft;
        props.onChangeDraftMessage(nextDraft);
      }
      requestAnimationFrame(() => {
        composerEditorRef.current?.focus();
        composerEditorRef.current?.setSelection({ start: nextDraft.length, end: nextDraft.length });
      });
    },
    [props.onChangeDraftMessage],
  );

  const handleScrollToEnd = useCallback(() => {
    void Haptics.selectionAsync();
    void scrollMessageToEnd({ animated: true, closeKeyboard: false }).catch(() => {
      freeze.set(false);
    });
  }, [freeze, scrollMessageToEnd]);

  const showScrollToEndButton = contentPresentationKind === "ready" && !endFollowEnabled;
  const { themeAppearance } = useAppearancePreferences();
  const isDarkMode = themeAppearance === "dark";

  const handleFeedTouchStart = useCallback((event: GestureResponderEvent) => {
    feedTouchStartRef.current = {
      pageX: event.nativeEvent.pageX,
      pageY: event.nativeEvent.pageY,
    };
  }, []);

  const handleFeedTouchMove = useCallback((event: GestureResponderEvent) => {
    const start = feedTouchStartRef.current;
    if (!start) {
      return;
    }
    const deltaX = event.nativeEvent.pageX - start.pageX;
    const deltaY = event.nativeEvent.pageY - start.pageY;
    if (Math.hypot(deltaX, deltaY) > 8) {
      feedTouchStartRef.current = null;
    }
  }, []);

  const handleFeedTouchEnd = useCallback(() => {
    if (feedTouchStartRef.current) {
      collapseComposer();
    }
    feedTouchStartRef.current = null;
  }, [collapseComposer]);

  const handleFeedTouchCancel = useCallback(() => {
    feedTouchStartRef.current = null;
  }, []);

  return (
    <View className="flex-1">
      {!usesNativeWorkspaceColumns ? <NativeLayoutObserver onChange={setScreenMetrics} /> : null}
      {showContent ? (
        <View
          style={{ flex: 1 }}
          onTouchStart={handleFeedTouchStart}
          onTouchMove={handleFeedTouchMove}
          onTouchEnd={handleFeedTouchEnd}
          onTouchCancel={handleFeedTouchCancel}
        >
          <View
            pointerEvents="none"
            className={
              Platform.OS === "android"
                ? "absolute inset-0 bg-thread-canvas"
                : "absolute inset-0 bg-screen"
            }
          />
          <RenderErrorBoundary
            key={selectedThreadKey}
            resetKeys={[props.threadCwd]}
            renderFallback={(fallback) => (
              <RenderFailureView
                {...fallback}
                title="The conversation couldn't be displayed"
                bottomInset={estimatedOverlayHeight}
              />
            )}
          >
            <ThreadFeed
              environmentId={props.environmentId}
              threadId={props.selectedThread.id}
              workspaceRoot={props.threadCwd}
              feed={props.selectedThreadFeed}
              pendingHandoff={props.pendingHandoff}
              worktreeSetup={props.worktreeSetup}
              setupWorkingStartedAt={props.setupWorkingStartedAt}
              queuedMessages={props.queuedMessages}
              dispatchingMessageId={props.dispatchingMessageId}
              // Native subagents have no editor; Cancel on an edit banner would discard the pending message.
              onEditPendingMessage={isProviderSubagent ? null : handleEditPendingMessage}
              contentPresentation={props.contentPresentation}
              agentLabel={agentLabel}
              threadTitle={props.selectedThread.title}
              latestRun={props.activityRun}
              activeWorkStartedAt={props.activeWorkStartedAt}
              runlessWorkActive={props.runlessWorkActive ?? false}
              listRef={listRef}
              freeze={freeze}
              anchorMessageId={anchorMessageId}
              submittedMessageId={submittedMessageId}
              contentInsetEndAdjustment={combinedContentInsetEndAdjustment}
              contentTopInset={0}
              contentBottomInset={
                estimatedOverlayHeight +
                (showFloatingStatus ? FLOATING_WORKING_CONTROL_COVERAGE : 0)
              }
              contentMaxWidth={contentMaxWidth}
              historyControls={props.historyControls}
              contentSideInsets={nativeMetrics?.safeArea}
              layoutVariant={layoutVariant}
              usesAutomaticContentInsets={props.usesAutomaticContentInsets}
              onHeaderMaterialVisibilityChange={props.onHeaderMaterialVisibilityChange}
              onEndFollowEnabledChange={setEndFollowEnabled}
              skills={selectedProviderSkills}
              onUseArtifactTemplate={handleUseArtifactTemplate}
            />
          </RenderErrorBoundary>
        </View>
      ) : (
        <View className="flex-1" />
      )}

      {showContent ? (
        <ThreadBrowserFloat
          key={selectedThreadKey}
          environmentId={props.environmentId}
          threadId={props.selectedThread.id}
          tabs={browserTabs.tabs}
          loaded={browserTabs.loaded}
          top={navigationHeaderHeight + 8}
          onOpen={openBrowserPreview}
        />
      ) : null}

      {/* Floating composer — sticks to keyboard via KeyboardStickyView */}
      {showContent ? (
        <KeyboardStickyView
          // Keep iOS subscribed through native will-show/will-hide animation; quarantine stale Android resumes.
          enabled={Platform.OS === "ios" || (isKeyboardVisible && !keyboardStateSuspect)}
          pointerEvents="box-none"
          style={{ position: "absolute", bottom: 0, left: 0, right: 0, top: 0 }}
          offset={{ closed: 0, opened: 0 }}
        >
          <ComposerPopoverHost hidden={composerSlotHidden}>
            {/* A fixed sticky host lets top and height animate together without Yoga jumping to the destination. */}
            <Animated.View
              layout={COMPOSER_LAYOUT_TRANSITION}
              pointerEvents="box-none"
              style={[
                {
                  position: "absolute",
                  bottom: controlInsets.bottom,
                  left: controlInsets.left,
                  right: controlInsets.right,
                },
                composerWidthStyle,
              ]}
            >
              {/* Top padding would become feed bottom inset and lift its resting content floor. */}
              <View ref={composerOverlayRef} onLayout={onComposerLayout} className="w-full">
                <FloatingWorkingControl
                  colorScheme={isDarkMode ? "dark" : "light"}
                  status={floatingStatus}
                  lift={floatingControlLift}
                  devicePreview={
                    devicePreviews.length > 0
                      ? { count: devicePreviews.length, onPress: openDevicePreview }
                      : null
                  }
                  browserPreview={
                    browserTabs.tabs.length > 0
                      ? { count: browserTabs.tabs.length, onPress: () => openBrowserPreview() }
                      : null
                  }
                  showScrollToEnd={showScrollToEndButton}
                  onScrollToEnd={handleScrollToEnd}
                  agents={agentsSegment}
                  onOpenAgents={() => {
                    Keyboard.dismiss();
                    navigation.navigate("ThreadAgents", {
                      environmentId: props.environmentId,
                      threadId: props.selectedThread.id,
                    });
                  }}
                  queuedCount={queuedCount}
                  onOpenQueue={() => {
                    Keyboard.dismiss();
                    navigation.navigate("ThreadQueue", {
                      environmentId: props.environmentId,
                      threadId: props.selectedThread.id,
                    });
                  }}
                />
                <View className="w-full self-center" style={{ maxWidth: contentMaxWidth }}>
                  {props.queuedRunEdit !== null ? (
                    <Animated.View
                      className="shrink-0"
                      entering={FadeInDown.duration(180)}
                      exiting={FadeOut.duration(120)}
                    >
                      <ComposerQueuedEditBanner
                        saving={props.isSavingQueuedEdit}
                        onCancel={() => {
                          voiceInputSession.cancel(props.composerDraftKey);
                          props.onCancelQueuedRunEdit();
                        }}
                      />
                    </Animated.View>
                  ) : null}
                  <UsageLimitRecoveryCard
                    key={props.selectedThread.latestRun?.runId}
                    thread={props.selectedThread}
                    environmentId={props.environmentId}
                  />
                  {props.feedbackSubmissions.map((submission) => (
                    <ComposerFeedback
                      key={submission.id}
                      submission={submission}
                      onDismiss={() => props.onDismissFeedback(submission.id)}
                    />
                  ))}
                  {composerError !== null ? (
                    <Animated.View
                      className="shrink-0"
                      entering={FadeInDown.duration(180)}
                      exiting={FadeOut.duration(120)}
                    >
                      <ComposerErrorNotice
                        message={composerError}
                        onDismiss={() => clearThreadComposerError(selectedThreadKey)}
                      />
                    </Animated.View>
                  ) : null}
                  {usageLimitsReport && activeUserInputRequestId === null ? (
                    <Animated.View
                      className="shrink-0 px-4 pb-3"
                      entering={FadeInDown.duration(220)}
                      exiting={FadeOut.duration(140)}
                    >
                      <ComposerUsageLimits
                        report={usageLimitsReport}
                        environmentId={props.environmentId}
                        onClose={dismissUsageLimits}
                      />
                    </Animated.View>
                  ) : null}
                  {props.creationState?.kind === "failed" ? (
                    <Animated.View
                      className="shrink-0 px-4"
                      style={{ paddingBottom: composerBottomInset }}
                      entering={FadeInDown.duration(220)}
                      exiting={FadeOut.duration(140)}
                    >
                      <ThreadCreationFailedCard
                        reason={props.creationState.reason}
                        onEditTask={props.creationState.onEditTask}
                      />
                    </Animated.View>
                  ) : null}
                  {props.activePendingApproval || props.activePendingUserInput ? (
                    <Animated.View
                      className="shrink-0 gap-3 px-4 pb-3"
                      // The questionnaire must cover the home indicator in place of the composer.
                      style={
                        activeUserInputRequestId !== null
                          ? { paddingBottom: composerBottomInset }
                          : undefined
                      }
                      entering={FadeInDown.duration(220)}
                      exiting={FadeOut.duration(140)}
                    >
                      {props.activePendingApproval ? (
                        <PendingApprovalCard
                          canOperateThread={props.canOperateThread}
                          approval={props.activePendingApproval}
                          respondingApprovalId={props.respondingApprovalId}
                          onRespond={props.onRespondToApproval}
                        />
                      ) : null}
                      {props.activePendingUserInput ? (
                        <PendingUserInputCard
                          canOperateThread={props.canOperateThread}
                          pendingUserInput={props.activePendingUserInput}
                          maxHeight={pendingUserInputMaxHeight}
                          collapsed={userInputCollapsed}
                          onToggleCollapsed={handleToggleUserInputCollapsed}
                          onStopThread={props.onStopThread}
                          cardProgress={userInputCardProgress}
                          cardCoverage={userInputCardCoverage}
                          onInputFocusChange={handleOwnedInputFocusChange}
                          drafts={props.activePendingUserInputDrafts}
                          answers={props.activePendingUserInputAnswers}
                          respondingUserInputId={props.respondingUserInputId}
                          onSelectOption={props.onSelectUserInputOption}
                          onChangeCustomAnswer={props.onChangeUserInputCustomAnswer}
                          onSubmit={props.onSubmitUserInput}
                          onDismiss={props.onDismissUserInput}
                        />
                      ) : null}
                    </Animated.View>
                  ) : null}
                </View>

                {/* Keep the hidden composer mounted so drafts and editor state survive requests and failed creation. */}
                <View style={composerSlotHidden ? { display: "none" } : undefined}>
                  {isProviderSubagent ? (
                    <View
                      className="self-center px-3 pt-1.5"
                      style={{
                        width: "100%",
                        maxWidth: contentMaxWidth,
                        paddingBottom: composerBottomInset + 6,
                      }}
                    >
                      <ProviderSubagentBar
                        provider={providerSubagentProvider ?? null}
                        modelLabel={
                          providerSubagentCatalogModel?.name ??
                          formatModelSlugName(props.selectedThread.modelSelection.model)
                        }
                        effortLabel={formatModelSelectionEffort(
                          props.selectedThread.modelSelection,
                          providerSubagentProvider?.models,
                          reportedModelSelection,
                        )}
                        status={props.providerSubagentStatus ?? null}
                        onOpenParent={
                          props.selectedThread.lineage.parentThreadId === null
                            ? null
                            : () =>
                                navigation.navigate("Thread", {
                                  environmentId: String(props.environmentId),
                                  threadId: String(props.selectedThread.lineage.parentThreadId),
                                })
                        }
                      />
                    </View>
                  ) : (
                    <>
                      <ThreadComposer
                        canOperateThread={props.canOperateThread}
                        reportedModelSelection={reportedModelSelection}
                        editorRef={composerEditorRef}
                        draftMessage={props.draftMessage}
                        draftAttachments={props.draftAttachments}
                        placeholder="Ask the repo agent, or run a command…"
                        contentMaxWidth={contentMaxWidth}
                        connectionState={props.connectionStateLabel}
                        environmentLabel={props.environmentLabel}
                        selectedThread={props.selectedThread}
                        hasCompactableConversation={
                          hasCompactableConversation && !props.isCompacting
                        }
                        serverConfig={props.serverConfig}
                        queueCount={props.selectedThreadQueueCount}
                        activeThreadBusy={props.activeThreadBusy}
                        canStopThread={props.canStopThread}
                        environmentId={props.environmentId}
                        projectCwd={props.threadCwd ?? props.projectWorkspaceRoot}
                        // Keep follow-ups in the draft until creation is accepted; a rejected id would strand queued messages.
                        sendBlockedReason={
                          props.creationState?.kind === "preparing" &&
                          !props.creationState.serverOwned
                            ? "Starting the task…"
                            : null
                        }
                        draftKey={props.composerDraftKey ?? undefined}
                        followUpBehavior={props.followUpBehavior}
                        canSteerActiveTurn={props.canSteerActiveTurn}
                        queuedEdit={
                          props.queuedRunEdit === null
                            ? null
                            : {
                                existingAttachments: props.queuedRunEdit.existingAttachments,
                                saving: props.isSavingQueuedEdit,
                                onRemoveExistingAttachment: props.onRemoveQueuedEditAttachment,
                              }
                        }
                        bottomInset={composerBottomInset}
                        onChangeDraftMessage={props.onChangeDraftMessage}
                        onPickDraftMedia={props.onPickDraftMedia}
                        onPickDraftFiles={props.onPickDraftFiles}
                        onNativePasteImages={props.onNativePasteImages}
                        onNativePasteText={props.onNativePasteText}
                        onRemoveDraftImage={props.onRemoveDraftImage}
                        onStopThread={props.onStopThread}
                        onSendMessage={handleSendMessage}
                        onShowUsageLimits={showUsageLimits}
                        canSwitchProvider={props.canSwitchThreadProvider}
                        onUpdateModelSelection={props.onUpdateThreadModelSelection}
                        onUpdateRuntimeMode={props.onUpdateThreadRuntimeMode}
                        onUpdateInteractionMode={props.onUpdateThreadInteractionMode}
                        onExpandedChange={setComposerExpanded}
                        onEditorFocusChange={handleComposerFocusChange}
                      />
                    </>
                  )}
                </View>
              </View>
            </Animated.View>
          </ComposerPopoverHost>
        </KeyboardStickyView>
      ) : null}
    </View>
  );
});
