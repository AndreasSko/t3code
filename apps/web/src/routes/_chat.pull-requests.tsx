import { RefreshIcon } from "~/components/ui/refresh-icon";
import { Spinner } from "~/components/ui/spinner";
import { useShortcutModifierState } from "~/shortcutModifierState";
import type { PullRequestSpeedActionResult } from "~/components/pullRequest/PullRequestSpeedActions";
import { usePullRequestCloseBatch } from "~/components/pullRequest/usePullRequestActions";
import { SidebarPointerSensor } from "~/components/Sidebar.pointer";
import { resolveSidebarSweepKeys } from "~/components/Sidebar.logic";
import { sortProjectsByGroupOrder } from "@t3tools/client-runtime/state/project-grouping";
import { pullRequestHostOf, resolveEnvironmentMachineKind } from "@t3tools/contracts";
import type {
  EnvironmentId,
  ProjectId,
  PullRequestAction,
  PullRequestInvolvement,
  PullRequestListCursors,
  PullRequestListFilters,
  PullRequestListInput,
  PullRequestListResult,
  PullRequestListState,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowDownUpIcon,
  CalendarArrowDownIcon,
  CalendarArrowUpIcon,
  ChevronDownIcon,
  ClockIcon,
  EyeIcon,
  LayersIcon,
  ListChecksIcon,
  PenLineIcon,
  UsersIcon,
  Plug2Icon,
  Maximize2Icon,
  Minimize2Icon,
  SearchIcon,
  UserLockIcon,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";

import {
  filterPullRequestsByInvolvement,
  findScopedProject,
  collectPullRequestListFacets,
  groupPullRequestsByInvolvement,
  matchesPullRequestFilters,
  matchesPullRequestQuery,
  parsePullRequestQuery,
  narrowPullRequestsToFilters,
  mergePullRequestDiffStats,
  partitionPullRequestsWithPriority,
  pullRequestDiffStatKey,
  pullRequestEntryKey,
  pullRequestEntryViewer,
  rankPullRequestMatches,
  sortPullRequestGroups,
  pullRequestEnvironmentSetKey,
  readPullRequestListSnapshot,
  resolveProjectScope,
  resolveQueryEnvironmentIds,
  resolveSelectedEnvironmentId,
  withDiffStat,
  writePullRequestListSnapshot,
  scorePullRequestMatch,
  pullRequestStatsRefreshBatches,
  pullRequestStatsRequestBatches,
  retainVisiblePullRequestStatsBatches,
  type EnvironmentPullRequestEntry,
  type MergedPullRequestList,
  type PullRequestDiffStats,
  type PullRequestStatsBatch,
  type PullRequestStatsPolicy,
  type PullRequestStatsScope,
  type PullRequestPartitionsSnapshot,
  applyPullRequestOverrides,
  type PullRequestListOverride,
  pullRequestOverrideAfterAction,
  reusePullRequestEntries,
  settlePullRequestOverrides,
  pullRequestHostActions,
} from "../components/pullRequest/pullRequestList.logic";
import {
  pullRequestListPreferences,
  type PullRequestListPreferencePatch,
  type PullRequestListPreferences,
  type PullRequestListSort,
  writePullRequestListPreferences,
} from "../components/pullRequest/pullRequestListPreferences";
import { assignProjectsToEnvironments } from "../components/pullRequest/pullRequestProjectAssignment.logic";
import { pullRequestFilterProjects } from "../components/pullRequest/pullRequestProjectFilter.logic";
import { environmentMachineIcon } from "../components/EnvironmentMachineIcon";
import { PullRequestDetailPanel } from "../components/pullRequest/PullRequestDetailPanel";
import {
  PullRequestFiltersMenu,
  PullRequestFilterOptionIcon,
  PullRequestSearchInput,
  pullRequestHostLabel,
  pullRequestProjectKey,
  type PullRequestExpectedHost,
  type PullRequestFilterOption,
} from "../components/pullRequest/PullRequestListFilters";
import { PullRequestListEmptyState } from "../components/pullRequest/PullRequestListEmptyState";
import { PullRequestListGhost } from "../components/pullRequest/PullRequestGhosts";
import {
  PullRequestRow,
  type PullRequestRowTarget,
} from "../components/pullRequest/PullRequestRow";
import { PullRequestsUnavailableState } from "../components/pullRequest/PullRequestsUnavailableState";
import { RightPanelTabs, type PullRequestTabStatusSeed } from "../components/RightPanelTabs";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../components/WorkspacePageContainer";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { isCommandPaletteOpen } from "../commandPaletteBus";
import { isElectron } from "../env";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../keybindings";
import { isTerminalFocused } from "../lib/terminalFocus";
import {
  PanelLayoutControls,
  RightPanelMaximizeControl,
} from "../components/chat/PanelLayoutControls";
import { Button } from "../components/ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../components/ui/menu";
import { SidebarInset } from "../components/ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useLiveRefresh } from "../hooks/useLiveRefresh";
import { useOpenPanelPullRequestUrl } from "../hooks/useOpenPanelPullRequestUrl";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { toastManager } from "../components/ui/toast";
import { useEscapeToGoBack } from "../hooks/useNavigateBack";
import { usePanelAnimationSettings, usePanelPresence } from "../panelAnimations";
import {
  PULL_REQUESTS_PANEL_REF,
  pullRequestSurfaceId,
  selectActiveRightPanelSurface,
  selectSelectedRightPanelSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
  type PullRequestSurface,
} from "../rightPanelStore";
import { useDebouncedValue } from "../state/queries";
import { useAllEnvironmentShellsBootstrapped, useProjects } from "../state/entities";
import { useSidebarProjectGroups } from "../hooks/useSidebarProjectGroups";
import { useEnvironments } from "../state/environments";
import {
  pullRequestEnvironment,
  usePullRequestList,
  usePullRequestListStats,
  usePullRequestTurnRefreshes,
  type EnvironmentQueryTarget,
} from "../state/pullRequests";
import { useAtomCommand } from "../state/use-atom-command";
import { cn } from "~/lib/utils";
import { Separator } from "~/components/ui/separator";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { getSourceControlPresentationForKind } from "~/sourceControlPresentation";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";

function getShortcutContext() {
  return {
    terminalFocus: isTerminalFocused(),
    terminalOpen: false,
    previewFocus: false,
    previewOpen: false,
    modelPickerOpen: false,
    isWeb: !isElectron,
    isDesktop: isElectron,
  };
}

export interface PullRequestsSearch extends PullRequestListPreferences {
  /** Absent environmentId means every connected server. */
  readonly environmentId?: EnvironmentId;
  /** Scopes the list. Separate from the selection so one cannot silently change the other. */
  readonly projectId?: ProjectId;
  /** Filter by host installation, not provider kind, to distinguish separate GitHub accounts. */
  readonly host?: string;
  readonly repository?: string;
  readonly number?: number;
  readonly selectedProjectId?: ProjectId;
  /** Host of the open review; changing tabs must not narrow the list host filter. */
  readonly selectedHost?: string;
  /**
   * Name the selection's environment because project ids are environment-local; omitted ids resolve only if
   * unambiguous.
   */
  readonly selectedEnvironmentId?: EnvironmentId;
}

const GROUP_ICONS: Record<string, LucideIcon> = {
  authored: PenLineIcon,
  reviewRequested: EyeIcon,
  others: UsersIcon,
};

function PullRequestGroupHeader({
  group,
}: {
  group: { key: string; label: string; entries: ReadonlyArray<unknown> };
}) {
  const Icon = GROUP_ICONS[group.key] ?? LayersIcon;
  return (
    <div className="flex items-center gap-2 px-3 pb-1 text-xs font-medium text-muted-foreground/70">
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <h2 className="shrink-0">{group.label}</h2>
      <span className="shrink-0 tabular-nums text-muted-foreground/50">{group.entries.length}</span>
      <Separator className="min-w-2 flex-1" />
    </div>
  );
}

const INVOLVEMENT_TABS = [
  { value: "all", label: "All", Icon: LayersIcon },
  { value: "reviewing", label: "Reviewing", Icon: EyeIcon },
  { value: "authored", label: "Authored", Icon: PenLineIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<PullRequestInvolvement>>;

const STATE_TABS = [
  { value: "all", label: "All", Icon: LayersIcon },
  { value: "open", label: "Open", Icon: PullRequestGlyph.pullRequest },
  { value: "closed", label: "Closed", Icon: PullRequestGlyph.closed },
  { value: "merged", label: "Merged", Icon: PullRequestGlyph.merged },
] as const satisfies ReadonlyArray<PullRequestFilterOption<PullRequestListState>>;

const SORT_OPTIONS = [
  { value: "ready", label: "Merge readiness", Icon: ListChecksIcon },
  { value: "blocked", label: "Blocked on me", Icon: UserLockIcon },
  { value: "updated", label: "Recently updated", Icon: ClockIcon },
  { value: "newest", label: "Newest shown", Icon: CalendarArrowDownIcon },
  { value: "oldest", label: "Oldest shown", Icon: CalendarArrowUpIcon },
  { value: "largest", label: "Largest shown", Icon: Maximize2Icon },
  { value: "smallest", label: "Smallest shown", Icon: Minimize2Icon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<PullRequestListSort>>;

/** Long enough that a keystroke does not become a request, short enough to feel answered. */
const SEARCH_DEBOUNCE_MS = 250;
/** What `scorePullRequestMatch` gives a row none of whose own fields carry the search text. */
const MATCHED_ELSEWHERE_SCORE = 10;
/** Request 99 rows plus the more-results probe to fit GitHub's 100-row page in one round trip. */
const PAGE_SIZE = 99;
const MAX_PAGE_SIZE = 500;
/** Stable empty map so the memos below do not see a new object on every render. */
const EMPTY_VIEWERS: PullRequestListResult["viewers"] = {};
/** Stable so a read that is not wanted right now does not re-key on every render. */
const NO_LIST_TARGETS: ReadonlyArray<EnvironmentQueryTarget<PullRequestListInput>> = [];
const EMPTY_PREVIEW_SESSIONS = {};
const EMPTY_PREVIEW_DESKTOP_STATE = {};
const EMPTY_TERMINAL_LABELS = new Map<string, string>();
const EMPTY_PENDING_SURFACES = new Set<string>();
const MAX_SEARCH_LABEL_CANDIDATES = 100;

const pullRequestListEntryId = (target: Parameters<typeof pullRequestSurfaceId>[0]) =>
  pullRequestSurfaceId({ ...target, repository: target.repository.toLowerCase() });

function pullRequestSearchLabels(raw: unknown): Partial<Pick<PullRequestsSearch, "labels">> {
  const values = (Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []).slice(
    0,
    MAX_SEARCH_LABEL_CANDIDATES,
  );
  const labels: Array<string> = [];
  const seen = new Set<string>();
  for (const rawValue of values) {
    if (typeof rawValue !== "string") continue;
    const value = rawValue.trim().slice(0, 200);
    const key = value.toLowerCase();
    if (value.length === 0 || seen.has(key)) continue;
    labels.push(value);
    seen.add(key);
    if (labels.length === 10) break;
  }
  return labels.length === 0 ? {} : { labels };
}

export const Route = createFileRoute("/_chat/pull-requests")({
  validateSearch: (raw: Record<string, unknown>): PullRequestsSearch => ({
    involvement:
      raw.involvement === "reviewing" || raw.involvement === "authored" ? raw.involvement : "all",
    state:
      raw.state === "closed" || raw.state === "merged" || raw.state === "all" ? raw.state : "open",
    ...(SORT_OPTIONS.some((option) => option.value === raw.sort)
      ? { sort: raw.sort as PullRequestListSort }
      : {}),
    ...(typeof raw.repository === "string" && raw.repository
      ? { repository: raw.repository.slice(0, 200) }
      : {}),
    ...(typeof raw.number === "number" && Number.isInteger(raw.number) && raw.number > 0
      ? { number: raw.number }
      : {}),
    ...(typeof raw.projectId === "string" && raw.projectId
      ? { projectId: raw.projectId as ProjectId }
      : {}),
    ...(typeof raw.environmentId === "string" && raw.environmentId
      ? { environmentId: raw.environmentId as EnvironmentId }
      : {}),
    ...(typeof raw.host === "string" && raw.host ? { host: raw.host.slice(0, 200) } : {}),
    ...(typeof raw.selectedProjectId === "string" && raw.selectedProjectId
      ? { selectedProjectId: raw.selectedProjectId as ProjectId }
      : {}),
    ...(typeof raw.selectedHost === "string" && raw.selectedHost
      ? { selectedHost: raw.selectedHost.slice(0, 200) }
      : {}),
    ...(typeof raw.selectedEnvironmentId === "string" && raw.selectedEnvironmentId
      ? { selectedEnvironmentId: raw.selectedEnvironmentId as EnvironmentId }
      : {}),
    // Always an own key: the router lays this result over the parent route's unvalidated
    // search, so leaving out a `q` the URL parser made a number would let the number through.
    q: typeof raw.q === "string" && raw.q ? raw.q.slice(0, 200) : undefined,
    ...(raw.draft === "only" || raw.draft === "hide" ? { draft: raw.draft } : {}),
    ...(raw.review === "approved" ||
    raw.review === "changes-requested" ||
    raw.review === "review-required" ||
    raw.review === "none"
      ? { review: raw.review }
      : {}),
    ...(raw.checks === "passing" || raw.checks === "failing" ? { checks: raw.checks } : {}),
    ...(typeof raw.author === "string" && raw.author.trim()
      ? { author: raw.author.trim().slice(0, 200) }
      : {}),
    ...pullRequestSearchLabels(raw.labels),
  }),
  component: PullRequestsRouteView,
});

function PullRequestsRouteView() {
  useEscapeToGoBack();
  const modifiers = useShortcutModifierState(true);
  const speedMode =
    modifiers.shiftKey && !modifiers.metaKey && !modifiers.ctrlKey && !modifiers.altKey;
  const search = Route.useSearch();
  const sort = search.sort ?? "ready";
  const statsPolicy: PullRequestStatsPolicy =
    sort === "ready" || sort === "largest" || sort === "smallest" ? "eager" : "visible";
  const navigate = useNavigate({ from: Route.fullPath });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { environments } = useEnvironments();
  // Sort environments so connection order cannot change query keys or stored scope identities.
  const capableEnvironments = useMemo(
    () =>
      environments
        .filter(
          (environment) => environment.serverConfig?.environment.capabilities.pullRequests === true,
        )
        .toSorted((left, right) => left.environmentId.localeCompare(right.environmentId)),
    [environments],
  );
  // A stale server scope falls back to all readable environments instead of an empty list.
  const scopedEnvironmentId =
    capableEnvironments.find((environment) => environment.environmentId === search.environmentId)
      ?.environmentId ?? null;
  const knownEnvironmentIds = useMemo(
    () => new Set(environments.map((environment) => environment.environmentId)),
    [environments],
  );
  const environmentIds = useMemo(
    () =>
      capableEnvironments
        .filter(
          (environment) =>
            scopedEnvironmentId === null || environment.environmentId === scopedEnvironmentId,
        )
        .map((environment) => environment.environmentId),
    [capableEnvironments, scopedEnvironmentId],
  );
  const environmentKey = useMemo(
    () => pullRequestEnvironmentSetKey(environmentIds),
    [environmentIds],
  );
  // No capability reports yet means unknown, not unsupported; wait before asking the user to upgrade.
  const capabilityKnown = environments.some((environment) => environment.serverConfig !== null);
  const pullRequestsSupported = environmentIds.length > 0;
  const allProjects = useProjects();
  // An unbootstrapped empty project list is unknown, not proof the reader must add a project.
  const projectsKnown = useAllEnvironmentShellsBootstrapped();
  // Only the projects the page can actually read: one on an environment that cannot list pull
  // requests could neither be listed nor acted on, and the Scratch folder is never a repository.
  const projects = useMemo(
    () =>
      allProjects.filter(
        (project) => !project.isScratch && environmentIds.includes(project.environmentId),
      ),
    [allProjects, environmentIds],
  );
  const environmentLabels = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
      ),
    [environments],
  );
  const scopedProjectId = useMemo(
    () => resolveProjectScope(search.projectId, projects, projectsKnown),
    [projects, projectsKnown, search.projectId],
  );
  const scopedProject = useMemo(
    () => findScopedProject(projects, scopedEnvironmentId, scopedProjectId),
    [projects, scopedEnvironmentId, scopedProjectId],
  );
  const scopedProjects = useMemo(
    () => pullRequestFilterProjects(projects, environmentLabels, scopedProject),
    [environmentLabels, projects, scopedProject],
  );

  // A link from a thread or the sidebar only knows the repository, so the owning project is
  // resolved here; an explicit `projectId` in the URL still wins.
  const selectedHost = search.selectedHost ?? search.host;
  const projectIdForRepository = useMemo(() => {
    const repository = search.repository?.toLowerCase();
    if (repository === undefined) return undefined;
    const identity = projects.find(
      (project) =>
        project.repositoryIdentity?.owner &&
        project.repositoryIdentity.name &&
        `${project.repositoryIdentity.owner}/${project.repositoryIdentity.name}`.toLowerCase() ===
          repository &&
        // The same `owner/name` can exist on two hosts. Without this the first match wins, and
        // a link that named its host opens the pull request from the other one.
        (selectedHost === undefined ||
          pullRequestHostOf(
            project.repositoryIdentity,
            project.repositoryIdentity.provider as SourceControlProviderKind,
          ) === selectedHost.toLowerCase()),
    );
    return identity?.id;
  }, [projects, selectedHost, search.repository]);

  // Do not reject a selection until project data arrives; absence from a connecting server is not final.
  const linkedProjectId = useMemo(
    () => resolveProjectScope(search.selectedProjectId, projects, projectsKnown),
    [projects, projectsKnown, search.selectedProjectId],
  );
  // An explicit project id outranks weaker repository inference so valid links still open.
  const selectedProjectId = linkedProjectId ?? projectIdForRepository ?? scopedProjectId;
  // Keep known connecting servers selected so shared project ids cannot resolve on the wrong machine. Only
  // forgotten server ids fall back to the remaining unambiguous project.
  const selectedEnvironmentId = resolveSelectedEnvironmentId(
    search.selectedEnvironmentId,
    knownEnvironmentIds,
    scopedEnvironmentId,
  );
  const selectedProject = useMemo(
    () => findScopedProject(projects, selectedEnvironmentId, selectedProjectId),
    [projects, selectedEnvironmentId, selectedProjectId],
  );
  // Use a fixed shared-panel ref so tabs survive connection-order and capability changes across servers.
  const rightPanelRef = capableEnvironments.length === 0 ? null : PULL_REQUESTS_PANEL_REF;
  const openPanelPullRequestUrl = useOpenPanelPullRequestUrl(rightPanelRef);
  const rightPanelState = useRightPanelStore((state) =>
    selectThreadRightPanelState(state.byThreadKey, rightPanelRef),
  );
  const selectedRightPanelSurface = useRightPanelStore((state) =>
    selectSelectedRightPanelSurface(state.byThreadKey, rightPanelRef),
  );
  const selectedPullRequestSurface =
    selectedRightPanelSurface?.kind === "pull-request" ? selectedRightPanelSurface : null;
  const activePullRequestSurface = rightPanelState.isOpen ? selectedPullRequestSurface : null;
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  const rightPanelPresenceValue = useMemo(
    () => ({
      activeSurface: selectedPullRequestSurface,
      surfaces: rightPanelState.surfaces,
    }),
    [rightPanelState.surfaces, selectedPullRequestSurface],
  );
  const rightPanelPresence = usePanelPresence(
    rightPanelState.isOpen && selectedPullRequestSurface !== null,
    rightPanelPresenceValue,
    panelAnimationsActive,
    rightPanelRef?.threadId ?? null,
    panelAnimationDurationMs,
  );
  const rightPanelPresent = rightPanelPresence.present;
  const renderedPullRequestSurface = rightPanelPresence.value?.activeSurface ?? null;
  const renderedRightPanelSurfaces = rightPanelPresence.value?.surfaces ?? [];
  // The open tab names its own server; a link that arrived before any tab was opened names it
  // through the project it selected.
  const panelEnvironmentId =
    (renderedPullRequestSurface?.environmentId as EnvironmentId | undefined) ??
    selectedProject?.environmentId ??
    null;
  const updateSearch = useCallback(
    (patch: {
      [Key in keyof PullRequestsSearch]?: PullRequestsSearch[Key] | undefined;
    }) =>
      void navigate({
        // Rebuilt rather than spread so a cleared field leaves the URL instead of
        // lingering as an explicit `undefined`.
        search: (previous: PullRequestsSearch): PullRequestsSearch => {
          const next = { ...previous, ...patch };
          return {
            involvement: next.involvement ?? previous.involvement,
            state: next.state ?? previous.state,
            ...(next.sort && next.sort !== "ready" ? { sort: next.sort } : {}),
            ...(next.repository ? { repository: next.repository } : {}),
            ...(next.number ? { number: next.number } : {}),
            ...(next.projectId ? { projectId: next.projectId } : {}),
            ...(next.environmentId ? { environmentId: next.environmentId } : {}),
            ...(next.host ? { host: next.host } : {}),
            ...(next.selectedHost ? { selectedHost: next.selectedHost } : {}),
            ...(next.selectedProjectId ? { selectedProjectId: next.selectedProjectId } : {}),
            ...(next.selectedEnvironmentId
              ? { selectedEnvironmentId: next.selectedEnvironmentId }
              : {}),
            ...(next.q ? { q: next.q } : {}),
            ...(next.draft ? { draft: next.draft } : {}),
            ...(next.review ? { review: next.review } : {}),
            ...(next.checks ? { checks: next.checks } : {}),
            ...(next.author ? { author: next.author } : {}),
            ...(next.labels && next.labels.length > 0 ? { labels: next.labels } : {}),
          };
        },
        replace: true,
      }),
    [navigate],
  );

  const clearedSelection = {
    repository: undefined,
    number: undefined,
    selectedProjectId: undefined,
    selectedEnvironmentId: undefined,
    selectedHost: undefined,
  };
  // List controls change the rows behind the detail, not the independent selected surface. The
  // reader can keep working in that panel while narrowing, sorting, or switching projects.
  const updateListScope = (patch: PullRequestListPreferencePatch) => {
    const currentPreferences = pullRequestListPreferences({
      ...search,
      ...patch,
      involvement: patch.involvement ?? search.involvement,
      state: patch.state ?? search.state,
    });
    // Opening a selected-only link does not save its default all/open list. Once a list control
    // changes, the entire visible scope is intentional and becomes the next sidebar destination.
    writePullRequestListPreferences(currentPreferences);
    updateSearch(patch);
  };

  // Debounce host requests while narrowing loaded rows immediately so typing stays responsive.
  const typedQuery = (search.q ?? "").trim();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const sentQuery = useDebouncedValue(typedQuery, SEARCH_DEBOUNCE_MS);
  const querySettled = typedQuery === sentQuery;
  const typedParsed = useMemo(() => parsePullRequestQuery(typedQuery), [typedQuery]);
  const sentParsed = useMemo(() => parsePullRequestQuery(sentQuery), [sentQuery]);

  const menuFilters = useMemo(
    (): PullRequestListFilters => ({
      ...(search.draft ? { draft: search.draft } : {}),
      ...(search.review ? { review: search.review } : {}),
      ...(search.checks ? { checks: search.checks } : {}),
      ...(search.author ? { author: search.author } : {}),
      ...(search.labels ? { labels: search.labels.map((label) => [label]) } : {}),
    }),
    [search.author, search.checks, search.draft, search.labels, search.review],
  );
  const menuFiltered = Object.keys(menuFilters).length > 0;
  // Typed qualifiers override matching menu fields because they express the latest choice.
  const filters = useMemo(
    (): PullRequestListFilters => ({ ...menuFilters, ...sentParsed.filters }),
    [menuFilters, sentParsed.filters],
  );
  const hasFilters = Object.keys(filters).length > 0;
  const localFilters = useMemo(
    (): PullRequestListFilters => ({ ...menuFilters, ...typedParsed.filters }),
    [menuFilters, typedParsed.filters],
  );
  const hasLocalFilters = Object.keys(localFilters).length > 0;
  // Restrict project-scoped reads to environments holding the project; unrelated hosts cannot answer that
  // scope.
  const queryEnvironmentIds = useMemo(
    () =>
      resolveQueryEnvironmentIds(
        environmentIds,
        projects,
        scopedProject,
        scopedProjectId,
        projectsKnown,
      ),
    [environmentIds, projects, projectsKnown, scopedProject, scopedProjectId],
  );
  /**
   * Read each repository on one environment to avoid duplicate host work; single-project ambiguous ids remain
   * intentionally queried on every matching server.
   */
  const environmentQueries = useMemo((): ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly projectIds?: ReadonlyArray<ProjectId>;
  }> => {
    const plain = queryEnvironmentIds.map((environmentId) => ({ environmentId }));
    if (!projectsKnown || scopedProjectId !== undefined) return plain;
    const assignment = assignProjectsToEnvironments(
      projects,
      queryEnvironmentIds,
      queryEnvironmentIds[0],
    );
    const totals = new Map<EnvironmentId, number>();
    for (const project of projects) {
      totals.set(project.environmentId, (totals.get(project.environmentId) ?? 0) + 1);
    }
    return queryEnvironmentIds.flatMap((environmentId) => {
      const projectIds = assignment.get(environmentId);
      if (projectIds === undefined) return [];
      // Omit an all-projects filter to keep the query equivalent to the environment's unrestricted listing.
      if (projectIds.length === (totals.get(environmentId) ?? 0)) return [{ environmentId }];
      return [{ environmentId, projectIds }];
    });
  }, [projects, projectsKnown, queryEnvironmentIds, scopedProjectId]);
  // Part of the scope, since a different split is a different question and its answers must not
  // be filed under the same page state.
  const assignmentKey = useMemo(
    () =>
      environmentQueries
        .map(({ environmentId, projectIds }) => `${environmentId}#${projectIds?.join("+") ?? "*"}`)
        .join("|"),
    [environmentQueries],
  );
  const turnRefreshes = usePullRequestTurnRefreshes(
    environmentQueries.map(({ environmentId }) => environmentId),
  );
  const turnRefreshToken = turnRefreshes
    .map(([environmentId, revision]) => `${environmentId}:${revision}`)
    .join("|");
  // Page size is view state, not a URL concern: a shared link should open the first page.
  const scopeKey = `${environmentKey}:${assignmentKey}:${search.state}:${search.involvement}:${scopedProjectId ?? ""}:${search.host ?? ""}:${search.draft ?? ""}:${search.review ?? ""}:${search.checks ?? ""}:${search.author ?? ""}:${search.labels?.join("\u0000") ?? ""}`;
  const filterKey = `${scopeKey}:${sentQuery}`;
  const statsScopeRef = useRef<PullRequestStatsScope>({ key: filterKey, policy: statsPolicy });
  statsScopeRef.current = { key: filterKey, policy: statsPolicy };
  // Keep continuations per repository/environment; absent entries have exhausted their rows.
  const [page, setPage] = useState<{
    key: string;
    size: number;
    cursors: Readonly<Record<string, PullRequestListCursors>> | null;
    /** Hosts without cursors must be reread at a larger limit or their remaining rows would stay unreachable. */
    regrown: ReadonlyArray<string>;
  }>({ key: filterKey, size: PAGE_SIZE, cursors: null, regrown: [] });
  const pageSize = page.key === filterKey ? page.size : PAGE_SIZE;
  const sentCursors = page.key === filterKey ? page.cursors : null;
  const sentRegrown = page.key === filterKey ? page.regrown : [];

  // Search changes reset pagination so clearing search cannot restore an old scrolled slice.
  useEffect(() => {
    setPage({ key: filterKey, size: PAGE_SIZE, cursors: null, regrown: [] });
  }, [filterKey]);

  const listTargets = useMemo(
    () =>
      environmentQueries.flatMap(({ environmentId, projectIds }) => {
        const cursors = sentCursors?.[environmentId];
        // Read only environments with continuations or cursorless growth; exhausted hosts would resend existing
        // rows.
        if (sentCursors !== null && cursors === undefined && !sentRegrown.includes(environmentId)) {
          return [];
        }
        return [
          {
            environmentId,
            input: {
              state: search.state,
              // Request host-side involvement filtering so matches are not lost beyond the fetched page.
              involvement: search.involvement,
              limit: pageSize,
              ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
              ...(projectIds ? { projectIds } : {}),
              ...(search.host ? { host: search.host } : {}),
              ...(hasFilters ? { filters } : {}),
              ...(sentParsed.text ? { query: sentParsed.text } : {}),
              ...(cursors === undefined ? {} : { cursors }),
            } satisfies PullRequestListInput,
          },
        ];
      }),
    [
      filters,
      hasFilters,
      pageSize,
      environmentQueries,
      scopedProjectId,
      search.host,
      search.involvement,
      search.state,
      sentCursors,
      sentRegrown,
      sentParsed.text,
    ],
  );
  const listQuery = usePullRequestList(listTargets);

  /**
   * Keep an independently keyed unsearched read for workspace metadata and instant search clearing; carried
   * answers cannot identify which question they belong to.
   */
  const baselineTargets = useMemo(
    () =>
      environmentQueries.map(({ environmentId, projectIds }) => ({
        environmentId,
        input: {
          state: search.state,
          involvement: search.involvement,
          limit: PAGE_SIZE,
          ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
          ...(projectIds ? { projectIds } : {}),
          ...(search.host ? { host: search.host } : {}),
          ...(menuFiltered ? { filters: menuFilters } : {}),
        } satisfies PullRequestListInput,
      })),
    [
      menuFiltered,
      menuFilters,
      environmentQueries,
      scopedProjectId,
      search.host,
      search.involvement,
      search.state,
    ],
  );
  const baselineQuery = usePullRequestList(baselineTargets);
  const baselineEmpty =
    baselineQuery.data?.entries.length === 0 &&
    baselineQuery.data.errors.length === 0 &&
    !baselineQuery.isPending &&
    baselineQuery.error === null;
  const facetTargets = useMemo(() => {
    if (!filtersOpen) return NO_LIST_TARGETS;
    return environmentQueries.map(({ environmentId, projectIds }) => ({
      environmentId,
      input: {
        state: "all",
        involvement: search.involvement,
        limit: PAGE_SIZE,
        ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
        ...(projectIds ? { projectIds } : {}),
        ...(search.host ? { host: search.host } : {}),
      } satisfies PullRequestListInput,
    }));
  }, [environmentQueries, filtersOpen, scopedProjectId, search.host, search.involvement]);
  const facetQuery = usePullRequestList(facetTargets);
  // Read authored/reviewing partitions separately so old priority rows cannot be missing from the feed's
  // first page. Skip partitions during search and reuse the same query atoms as the priority tabs.
  const partitionsWanted = search.involvement === "all" && typedQuery.length === 0;
  // Keep input field order identical to the feed so priority tabs reuse these query atoms.
  const partitionTargets = useMemo(() => {
    // Wait for the main list to prove indexed repositories before partition reads can trigger costly per-repo
    // fallback.
    if (
      !partitionsWanted ||
      baselineQuery.data === null ||
      baselineQuery.data.entries.length === 0
    ) {
      return { authored: NO_LIST_TARGETS, reviewing: NO_LIST_TARGETS };
    }
    const targetsFor = (involvement: PullRequestInvolvement) =>
      environmentQueries.map(({ environmentId, projectIds }) => ({
        environmentId,
        input: {
          state: search.state,
          involvement,
          limit: PAGE_SIZE,
          ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
          ...(projectIds ? { projectIds } : {}),
          ...(search.host ? { host: search.host } : {}),
          ...(menuFiltered ? { filters: menuFilters } : {}),
        } satisfies PullRequestListInput,
      }));
    return { authored: targetsFor("authored"), reviewing: targetsFor("reviewing") };
  }, [
    menuFiltered,
    menuFilters,
    partitionsWanted,
    baselineQuery.data,
    environmentQueries,
    scopedProjectId,
    search.host,
    search.state,
  ]);
  const authoredQuery = usePullRequestList(partitionTargets.authored);
  const reviewingQuery = usePullRequestList(partitionTargets.reviewing);
  // The header's refresh punches through the server's cache before re-reading; the error and
  // empty states retry plainly, because a failure is never cached.
  const invalidate = useAtomCommand(pullRequestEnvironment.invalidate, { reportFailure: false });
  // Refresh all visible resources; signal the panel to reread its own detail rather than reaching into it.
  const [detailRefreshToken, setDetailRefreshToken] = useState(0);
  // Track refresh before invalidation returns so the button cannot trigger duplicate work during the slow
  // phase.
  const [invalidating, setInvalidating] = useState(false);
  const refreshListAndStats = (
    requestedStatsScope = statsScopeRef.current,
    actedEnvironmentId?: EnvironmentId,
  ) => {
    refreshList(true, actedEnvironmentId);
    const visible = visibleStatsKeys.current;
    const batches = pullRequestStatsRefreshBatches({
      requestedScope: requestedStatsScope,
      currentScope: statsScopeRef.current,
      entriesByKey: entriesByStatsKey.current,
      candidateKeys: visible.key === requestedStatsScope.key ? visible.values : new Set(),
      statsByRow: statsByRowRef.current,
    });
    if (batches !== null) {
      setStatsTargetState({ key: requestedStatsScope.key, batches });
      statsQuery.refresh(
        batches
          .filter(({ environmentId }) =>
            actedEnvironmentId === undefined ? true : environmentId === actedEnvironmentId,
          )
          .map(({ environmentId, input }) => ({ environmentId, input })),
      );
    }
  };
  const refreshFromHost = async () => {
    const requestedStatsScope = statsScopeRef.current;
    setInvalidating(true);
    try {
      await Promise.all(
        queryEnvironmentIds.map((environmentId) => invalidate({ environmentId, input: {} })),
      );
    } finally {
      setInvalidating(false);
    }
    refreshListAndStats(requestedStatsScope);
    setDetailRefreshToken((token) => token + 1);
  };
  const refreshing = invalidating || listQuery.isPending;

  // Hold the last answer while new queries load so pagination grows and search narrows without blanking the
  // page.
  const [loaded, setLoaded] = useState<{
    environmentKey: string;
    scope: string;
    query: string;
    data: MergedPullRequestList;
    partitions?: PullRequestPartitionsSnapshot;
  } | null>(null);
  // Accumulate continuation rows without replacing existing order; declare before snapshot writes so
  // persistence includes the whole list.
  const [ordered, setOrdered] = useState<{
    key: string;
    entries: ReadonlyArray<EnvironmentPullRequestEntry>;
  } | null>(null);
  // Show row actions optimistically and roll back their own writes if the host refuses.
  const [overrides, setOverrides] = useState<ReadonlyMap<string, PullRequestListOverride>>(
    () => new Map(),
  );
  const overrideToken = useRef(0);
  /** Writes the action's outcome onto the row; the token names this write for a later rollback. */
  const overrideEntry = (
    entry: EnvironmentPullRequestEntry,
    action: PullRequestAction,
  ): number | null => {
    const token = ++overrideToken.current;
    const override = pullRequestOverrideAfterAction(entry, action, new Date(), token);
    if (override === null) return null;
    setOverrides((current) => new Map(current).set(pullRequestEntryKey(entry), override));
    return token;
  };
  /** A rollback for one write only: a later action's note over the same row is left alone. */
  const revertOverride = (key: string, token: number | null) => {
    if (token === null) return;
    setOverrides((current) => {
      if (current.get(key)?.token !== token) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  };
  const detailOverrideTokens = useRef(new Map<string, number | null>());
  const speedActionRef = useRef<(result: PullRequestSpeedActionResult) => void>(() => {});
  speedActionRef.current = ({ entry, action }) => {
    // Some hosts accept a merge before it completes. Let the next host read declare it merged.
    if (action !== "merge") overrideEntry(entry, action);
  };
  const onSpeedAction = useCallback((result: PullRequestSpeedActionResult) => {
    speedActionRef.current(result);
  }, []);
  const onBatchClosed = useCallback((entry: EnvironmentPullRequestEntry) => {
    speedActionRef.current({ entry, action: "close" });
  }, []);
  const { close: closeBatch, closingKeys } = usePullRequestCloseBatch(onBatchClosed);
  // Hydrate the last answer after registry recreation so reloads keep rows visible while live reads
  // reconcile.
  useEffect(() => {
    if (environmentKey.length === 0) return;
    setLoaded((current) => {
      // Only hold snapshots for the same environment set; carried rows may belong to disconnected machines.
      if (current !== null && current.environmentKey === environmentKey) return current;
      const snapshot = readPullRequestListSnapshot(
        typeof window === "undefined" ? undefined : window.localStorage,
        environmentKey,
      );
      if (snapshot === null) return null;
      return {
        environmentKey,
        scope: snapshot.scope,
        query: "",
        data: snapshot.data,
        ...(snapshot.partitions === undefined ? {} : { partitions: snapshot.partitions }),
      };
    });
  }, [environmentKey]);
  useEffect(() => {
    // Record only settled queries; mid-switch data belongs to the previous search, not the new text.
    if (!listQuery.data || listQuery.isPending) return;
    const data = listQuery.data;
    setLoaded((current) => {
      // Keep held partitions until their independent reads land; an earlier feed response must not drop them.
      const partitions =
        partitionsWanted && baselineEmpty
          ? { authored: [], reviewing: [] }
          : partitionsWanted && authoredQuery.data !== null && reviewingQuery.data !== null
            ? { authored: authoredQuery.data.entries, reviewing: reviewingQuery.data.entries }
            : current !== null &&
                current.environmentKey === environmentKey &&
                current.scope === scopeKey
              ? current.partitions
              : undefined;
      // Persist only unsearched lists and use accumulated rows/full baseline hosts; a continuation alone omits
      // earlier pages and exhausted environments. Preserve partitions that have already arrived.
      if (environmentKey.length > 0 && sentQuery.length === 0) {
        const accumulatedEntries = ordered?.key === filterKey ? ordered.entries : data.entries;
        writePullRequestListSnapshot(
          typeof window === "undefined" ? undefined : window.localStorage,
          environmentKey,
          {
            scope: scopeKey,
            data: {
              ...data,
              entries: accumulatedEntries,
              viewers: baselineQuery.data?.viewers ?? data.viewers,
              providers: baselineQuery.data?.providers ?? data.providers,
            },
            ...(partitions === undefined ? {} : { partitions }),
          },
        );
      }
      return {
        environmentKey,
        scope: scopeKey,
        query: sentQuery,
        data: { ...data, entries: ordered?.key === filterKey ? ordered.entries : data.entries },
        ...(partitions === undefined ? {} : { partitions }),
      };
    });
  }, [
    environmentKey,
    scopeKey,
    sentQuery,
    listQuery.data,
    listQuery.isPending,
    baselineEmpty,
    partitionsWanted,
    authoredQuery.data,
    reviewingQuery.data,
    ordered,
    filterKey,
    baselineQuery.data,
  ]);
  // Narrow held rows while new filters load, but discard a different environment set that may include
  // disconnected hosts.
  const narrowed = useMemo(() => {
    if (loaded === null || loaded.environmentKey !== environmentKey || loaded.scope === scopeKey) {
      return null;
    }
    const entries = narrowPullRequestsToFilters(loaded.data.entries, {
      state: search.state,
      projectId: scopedProjectId,
      host: search.host,
    });
    return entries.length === 0 ? null : { ...loaded.data, entries };
  }, [environmentKey, loaded, scopeKey, scopedProjectId, search.host, search.state]);
  // Take cleared-search data from its unsearched query, not a lingering search response. Grown pages must use
  // the listing query because the baseline contains only the first page.
  const answered =
    (sentQuery.length === 0 && sentCursors === null && pageSize === PAGE_SIZE
      ? baselineQuery.data
      : listQuery.data) ??
    (loaded?.scope === scopeKey && loaded.query === sentQuery ? loaded.data : null);
  // Reuse the unsearched baseline immediately when clearing search instead of waiting another round trip.
  const carried =
    (sentQuery.length === 0 ? baselineQuery.data : undefined) ??
    (loaded?.scope === scopeKey ? loaded.data : null) ??
    narrowed;
  const listData = answered ?? carried;
  const showingCarried = answered === null && carried !== null;
  const loadingMore = listQuery.isPending && listData !== null;
  const firstLoad = listQuery.isPending && listData === null;

  useEffect(() => {
    if (!answered || listQuery.isPending || (listQuery.error && listQuery.data === null)) return;
    setOrdered((previous) => {
      if (previous === null || previous.key !== filterKey) {
        return {
          key: filterKey,
          entries: rankPullRequestMatches(answered.entries, sentParsed.text),
        };
      }
      if (sentCursors !== null) {
        // A continuation cannot remove held rows; append only new rows, sorted within the arriving slice.
        const held = new Set(previous.entries.map(pullRequestEntryKey));
        const arrived = answered.entries.filter((entry) => !held.has(pullRequestEntryKey(entry)));
        const appended = rankPullRequestMatches(
          arrived.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
          sentParsed.text,
        );
        return { key: filterKey, entries: [...previous.entries, ...appended] };
      }
      // Whole-page refreshes use current host order so newly updated rows land at the top.
      return {
        key: filterKey,
        entries: reusePullRequestEntries(
          previous.entries,
          rankPullRequestMatches(answered.entries, sentParsed.text),
          pullRequestEntryKey,
        ),
      };
    });
    // The host's word outranks the reader's, once it has actually said it: an override is
    // cleared by an answer that agrees with it, not by any answer that happens to land.
    setOverrides((current) =>
      settlePullRequestOverrides(current, answered.entries, pullRequestEntryKey, Date.now()),
    );
  }, [
    answered,
    filterKey,
    sentCursors,
    sentParsed.text,
    listQuery.isPending,
    listQuery.error,
    listQuery.data,
  ]);

  // Continue only this question's answered cursors; carried rows belong to another listing and would skip
  // matches.
  const nextCursors = answered?.nextCursors ?? {};
  const regrown = (answered?.truncatedEnvironments ?? []).filter(
    (environmentId) => nextCursors[environmentId] === undefined,
  );
  const canContinue = !showingCarried && Object.keys(nextCursors).length > 0;
  const loadMore = () => {
    if (canContinue) {
      setPage({
        key: filterKey,
        size: regrown.length === 0 ? pageSize : Math.min(pageSize + PAGE_SIZE, MAX_PAGE_SIZE),
        cursors: nextCursors,
        regrown,
      });
      return;
    }
    setPage({
      key: filterKey,
      size: Math.min(pageSize + PAGE_SIZE, MAX_PAGE_SIZE),
      cursors: null,
      regrown: [],
    });
  };

  // Refresh a whole page covering visible rows; rereading only a cursor slice would leave earlier rows stale.
  const refreshList = (includeRelated = false, actedEnvironmentId?: EnvironmentId) => {
    const related = (
      includeRelated
        ? [
            ...baselineTargets,
            ...facetTargets,
            ...partitionTargets.authored,
            ...partitionTargets.reviewing,
          ]
        : []
    ).filter(
      ({ environmentId }) =>
        actedEnvironmentId === undefined || environmentId === actedEnvironmentId,
    );
    if (sentCursors === null) {
      listQuery.refresh([
        ...listTargets.filter(
          ({ environmentId }) =>
            actedEnvironmentId === undefined || environmentId === actedEnvironmentId,
        ),
        ...related,
      ]);
      return;
    }
    if (related.length > 0) listQuery.refresh(related);
    const loadedCount = ordered?.key === filterKey ? ordered.entries.length : pageSize;
    setPage({
      key: filterKey,
      regrown: [],
      size: Math.min(
        Math.max(pageSize, Math.ceil(loadedCount / PAGE_SIZE) * PAGE_SIZE),
        MAX_PAGE_SIZE,
      ),
      cursors: null,
    });
  };

  const appliedTurnRefreshToken = useRef("");
  const refreshAfterTurn = useEffectEvent(() => {
    if (sentCursors !== null) refreshList();
  });
  useEffect(() => {
    if (turnRefreshToken.length === 0 || appliedTurnRefreshToken.current === turnRefreshToken) {
      return;
    }
    appliedTurnRefreshToken.current = turnRefreshToken;
    refreshAfterTurn();
  }, [turnRefreshToken]);

  // Refresh through the server cache only while actively viewed to preserve host quota.
  useLiveRefresh(
    () => {
      refreshList(true);
    },
    { enabled: pullRequestsSupported },
  );

  const viewers = baselineQuery.data?.viewers ?? listData?.viewers ?? EMPTY_VIEWERS;
  const listErrors = baselineQuery.data?.errors ?? listData?.errors ?? [];
  const facets = useMemo(
    () =>
      collectPullRequestListFacets(
        [
          ...(facetQuery.data?.entries ?? []),
          ...(baselineQuery.data?.entries ?? listData?.entries ?? []),
        ],
        search.state,
      ),
    [baselineQuery.data?.entries, facetQuery.data?.entries, listData?.entries, search.state],
  );

  const searchingHosts = useMemo(
    () =>
      new Set(
        (baselineQuery.data?.providers ?? listData?.providers ?? []).flatMap((provider) =>
          provider.searchesOnHost ? [provider.host] : [],
        ),
      ),
    [baselineQuery.data?.providers, listData?.providers],
  );

  const entries = useMemo(() => {
    const known = ordered?.key === filterKey ? ordered.entries : (listData?.entries ?? []);
    const involvementEntries = filterPullRequestsByInvolvement(known, viewers, search.involvement);
    // Host searches can match invisible body/review/commit text, so do not narrow their answered results again.
    // Narrow carried rows and non-searching hosts locally; Azure DevOps supplies no text filter.
    const narrowedEntries = hasLocalFilters
      ? involvementEntries.filter((entry) =>
          matchesPullRequestFilters(entry, localFilters, pullRequestEntryViewer(entry, viewers)),
        )
      : involvementEntries;
    // Keep relevance order during search; otherwise merge hosts by newest update.
    if (typedParsed.text.length === 0) {
      return narrowedEntries.toSorted((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      );
    }
    const answeredLocally = querySettled && !showingCarried;
    return narrowedEntries.filter(
      (entry) =>
        (answeredLocally && searchingHosts.has(entry.host)) ||
        matchesPullRequestQuery(entry, typedParsed.text),
    );
  }, [
    filterKey,
    hasLocalFilters,
    localFilters,
    listData,
    ordered,
    querySettled,
    search.involvement,
    searchingHosts,
    showingCarried,
    typedParsed.text,
    viewers,
  ]);

  // Seed the first tab paint from list rows while each tab's cached detail read lands.
  const listedPullRequestTabStatuses = useMemo<Record<string, PullRequestTabStatusSeed>>(
    () =>
      Object.fromEntries(
        entries.map((entry) => [
          pullRequestSurfaceId(entry),
          {
            state: entry.state,
            isDraft: entry.isDraft,
          },
        ]),
      ),
    [entries],
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    if (search.involvement !== "all") return [{ key: "others" as const, label: "", entries }];
    // An empty whole-list answer also empties the priority groups. Their old snapshot must
    // not restore the last merged rows after the partition reads are no longer mounted.
    if (baselineEmpty) {
      return groupPullRequestsByInvolvement(entries, viewers);
    }
    // Hold complete priority snapshots until both live partitions arrive; locally grouping one feed page loses
    // old rows.
    const held =
      loaded !== null && loaded.environmentKey === environmentKey && loaded.scope === scopeKey
        ? loaded.partitions
        : undefined;
    // Apply local filters to priority partitions too when their hosts cannot filter those fields.
    const narrow = (rows: ReadonlyArray<EnvironmentPullRequestEntry> | undefined) =>
      rows === undefined || !hasLocalFilters
        ? rows
        : rows.filter((entry) =>
            matchesPullRequestFilters(entry, localFilters, pullRequestEntryViewer(entry, viewers)),
          );
    const authored = narrow(
      partitionsWanted ? (authoredQuery.data?.entries ?? held?.authored) : undefined,
    );
    const reviewing = narrow(
      partitionsWanted ? (reviewingQuery.data?.entries ?? held?.reviewing) : undefined,
    );
    if (authored === undefined || reviewing === undefined) {
      return groupPullRequestsByInvolvement(entries, viewers);
    }
    return partitionPullRequestsWithPriority(entries, authored, reviewing);
  }, [
    hasLocalFilters,
    baselineEmpty,
    localFilters,
    authoredQuery.data?.entries,
    entries,
    environmentKey,
    loaded,
    partitionsWanted,
    reviewingQuery.data?.entries,
    scopeKey,
    search.involvement,
    viewers,
  ]);

  // Line counts account for ~40% of GitHub's full-page read; fetch them separately so rows can render first.
  // Date sorts keep optional line-count reads near the viewport. Size and readiness sorts need
  // every loaded count before their order is final. Counts stay cached across both policies.
  const entriesByStatsKey = useRef<ReadonlyMap<string, EnvironmentPullRequestEntry>>(new Map());
  entriesByStatsKey.current = new Map(
    groups.flatMap((group) =>
      group.entries.map((entry) => [pullRequestEntryKey(entry), entry] as const),
    ),
  );
  const visibleStatsKeys = useRef({ key: filterKey, values: new Set<string>() });
  const [statsByRow, setStatsByRow] = useState<PullRequestDiffStats>(() => new Map());
  const statsByRowRef = useRef(statsByRow);
  statsByRowRef.current = statsByRow;
  const [statsTargetState, setStatsTargetState] = useState<{
    readonly key: string;
    readonly batches: ReadonlyArray<PullRequestStatsBatch>;
  }>({ key: filterKey, batches: [] });
  const statsBatches = statsTargetState.key === filterKey ? statsTargetState.batches : [];
  const statsTargets = useMemo(
    () =>
      statsBatches.map(({ environmentId, input }) => ({
        environmentId,
        input,
      })),
    [statsBatches],
  );
  const statsObserver = useRef<IntersectionObserver | null>(null);
  const statsRows = useRef(new Set<HTMLDivElement>());
  const statsPending = useRef(true);
  const statsPolicyRef = useRef(statsPolicy);
  statsPolicyRef.current = statsPolicy;
  const registerStatsRow = useCallback((node: HTMLDivElement | null) => {
    if (node === null || typeof IntersectionObserver === "undefined") return;
    statsRows.current.add(node);
    statsObserver.current?.observe(node);
    return () => {
      statsRows.current.delete(node);
      statsObserver.current?.unobserve(node);
      const key = node.dataset.pullRequestStatsKey;
      const visible = visibleStatsKeys.current;
      if (
        statsPolicyRef.current !== "visible" ||
        key === undefined ||
        !visible.values.delete(key) ||
        statsPending.current
      ) {
        return;
      }
      setStatsTargetState((current) => {
        if (current.key !== visible.key) return current;
        const batches = retainVisiblePullRequestStatsBatches(current.batches, visible.values);
        return batches.length === current.batches.length ? current : { key: current.key, batches };
      });
    };
  }, []);
  useEffect(() => {
    if (statsPolicy !== "eager") return;
    setStatsTargetState((current) => {
      const batches = current.key === filterKey ? current.batches : [];
      const added = pullRequestStatsRequestBatches({
        entriesByKey: entriesByStatsKey.current,
        candidateKeys: visibleStatsKeys.current.values,
        policy: statsPolicy,
        activeBatches: batches,
        statsByRow: statsByRowRef.current,
      });
      if (added.length === 0 && current.key === filterKey) return current;
      return { key: filterKey, batches: [...batches, ...added] };
    });
  }, [filterKey, groups, statsPolicy]);
  useEffect(() => {
    if (statsPolicy !== "visible" || typeof IntersectionObserver === "undefined") return;
    visibleStatsKeys.current = { key: filterKey, values: new Set() };
    const observer = new IntersectionObserver(
      (observed) => {
        const visible = visibleStatsKeys.current;
        if (visible.key !== filterKey) return;
        let changed = false;
        const entered = new Set<string>();
        for (const item of observed) {
          const key = (item.target as HTMLElement).dataset.pullRequestStatsKey;
          if (key === undefined) continue;
          const wasVisible = visible.values.has(key);
          if (item.isIntersecting && entriesByStatsKey.current.has(key)) {
            visible.values.add(key);
            if (!wasVisible) entered.add(key);
          } else {
            visible.values.delete(key);
          }
          changed ||= wasVisible !== visible.values.has(key);
        }
        if (!changed) return;
        setStatsTargetState((current) => {
          const batches = current.key === filterKey ? current.batches : [];
          const retained = statsPending.current
            ? batches
            : retainVisiblePullRequestStatsBatches(batches, visible.values);
          const added = pullRequestStatsRequestBatches({
            entriesByKey: entriesByStatsKey.current,
            candidateKeys: entered,
            policy: statsPolicy,
            activeBatches: batches,
            statsByRow: statsByRowRef.current,
          });
          if (added.length === 0 && retained.length === batches.length) return current;
          return { key: filterKey, batches: [...retained, ...added] };
        });
      },
      { root: scrollRef.current, rootMargin: "480px" },
    );
    statsObserver.current = observer;
    for (const row of statsRows.current) observer.observe(row);
    return () => {
      observer.disconnect();
      if (statsObserver.current === observer) statsObserver.current = null;
    };
  }, [filterKey, statsPolicy]);
  const statsQuery = usePullRequestListStats(statsTargets);
  statsPending.current = statsQuery.isPending;
  useEffect(() => {
    if (statsPolicy !== "visible" || statsQuery.isPending) return;
    const visible = visibleStatsKeys.current;
    setStatsTargetState((current) => {
      if (current.key !== filterKey || visible.key !== filterKey) return current;
      const batches = retainVisiblePullRequestStatsBatches(current.batches, visible.values);
      return batches.length === current.batches.length ? current : { key: current.key, batches };
    });
  }, [filterKey, statsPolicy, statsQuery.isPending]);
  // New stats queries start empty; merge into held counts so existing rows retain their figures.
  useEffect(() => {
    const stats = statsQuery.stats;
    if (stats === null) return;
    setStatsByRow((previous) => mergePullRequestDiffStats(previous, stats));
  }, [statsQuery.stats]);
  const displayGroups = useMemo(() => {
    // Apply optimistic actions after grouping so closed rows leave separately fetched priority groups too.
    const enriched = groups.map((group) => {
      const answered = applyPullRequestOverrides(
        group.entries.map((entry) => withDiffStat(entry, statsByRow)),
        overrides,
        pullRequestEntryKey,
        search.state,
      );
      // A row whose draft flag just changed has to pass the local filters again: a draft
      // filter that let it in may not let the new one in.
      return {
        ...group,
        entries:
          hasLocalFilters && overrides.size > 0
            ? answered.filter(
                (entry) =>
                  !overrides.has(pullRequestEntryKey(entry)) ||
                  matchesPullRequestFilters(
                    entry,
                    localFilters,
                    pullRequestEntryViewer(entry, viewers),
                  ),
              )
            : answered,
      };
    });
    // Searching keeps its relevance order and priority groups unless the reader explicitly asks
    // for another sort. The readiness queue is the default browse order, not a way to bury a
    // closer text match.
    return sortPullRequestGroups(
      enriched,
      sort,
      typedParsed.text,
      (entry) =>
        entry.additions + entry.deletions > 0 || statsByRow.has(pullRequestDiffStatKey(entry)),
      search.involvement,
    );
  }, [
    groups,
    hasLocalFilters,
    localFilters,
    overrides,
    search.involvement,
    search.state,
    sort,
    statsByRow,
    typedParsed.text,
    viewers,
  ]);
  const shownCount = displayGroups.reduce((count, group) => count + group.entries.length, 0);
  // Build the switcher from workspace hosts so selecting one cannot hide the other options.
  const [hosts, setHosts] = useState<PullRequestListResult["providers"]>([]);
  useEffect(() => {
    // Only update switcher hosts from an answer to current filters; carried summaries may describe a narrower
    // scope.
    if (answered === null) return;
    // Filtered answers seed only an empty switcher; unfiltered answers supply its full host set.
    setHosts((previous) =>
      search.host === undefined || previous.length === 0 ? answered.providers : previous,
    );
  }, [answered, search.host]);
  const showProvider = hosts.length > 1;
  const hostActionsOf = useMemo(() => pullRequestHostActions(hosts), [hosts]);
  const [closeSweepKeys, setCloseSweepKeys] = useState<ReadonlySet<string>>(() => new Set());
  const closeSensorRef = useRef<SidebarPointerSensor | null>(null);
  const closeSweepRows = useMemo(
    () =>
      new Map(
        displayGroups.flatMap((group) =>
          group.entries.map(
            (entry) => [pullRequestEntryKey(entry), { entry, groupKey: group.key }] as const,
          ),
        ),
      ),
    [displayGroups],
  );
  const closeSweepRef = useRef({
    displayGroups,
    closeSweepRows,
    closingKeys,
    closeBatch,
    hostActionsOf,
  });
  closeSweepRef.current = { displayGroups, closeSweepRows, closingKeys, closeBatch, hostActionsOf };
  useEffect(() => () => closeSensorRef.current?.cancel(), [filterKey, search.q, sort]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || closeSensorRef.current === null) return;
      event.preventDefault();
      closeSensorRef.current.cancel();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);
  const startCloseSweep = useCallback((entry: EnvironmentPullRequestEntry, event: PointerEvent) => {
    closeSensorRef.current?.cancel();
    const originKey = pullRequestEntryKey(entry);
    const group = closeSweepRef.current.displayGroups.find((candidate) =>
      candidate.entries.some((row) => pullRequestEntryKey(row) === originKey),
    );
    if (!group || closeSweepRef.current.closingKeys.has(originKey)) return;
    const orderedKeys = closeSweepRef.current.displayGroups.flatMap((candidate) =>
      candidate.entries.map(pullRequestEntryKey),
    );
    const canClose = (key: string) => {
      const row = closeSweepRef.current.closeSweepRows.get(key);
      return (
        row?.groupKey === group.key &&
        row.entry.state === "open" &&
        closeSweepRef.current.hostActionsOf(row.entry).has("close") &&
        !closeSweepRef.current.closingKeys.has(key) &&
        !scrollRef.current?.querySelector(
          `[data-pull-request-key="${CSS.escape(key)}"] [data-pull-request-action-pending="true"]`,
        )
      );
    };
    let sweptKeys: string[] = [];
    let targetKey: string | null = null;
    const sweepTo = (key: string) => {
      if (key === targetKey) return;
      targetKey = key;
      sweptKeys = resolveSidebarSweepKeys(orderedKeys, originKey, key, canClose);
      setCloseSweepKeys(new Set(sweptKeys));
    };
    closeSensorRef.current = new SidebarPointerSensor({
      active: originKey,
      event,
      options: {
        distance: 6,
        onAttach: () => {},
        onFinish: () => {
          closeSensorRef.current = null;
          setCloseSweepKeys(new Set());
        },
      },
      onPending: () => {},
      onStart: () => sweepTo(originKey),
      onMove: ({ y }) => {
        const viewport = scrollRef.current;
        if (!viewport) return;
        const bounds = viewport.getBoundingClientRect();
        const visibleY = Math.min(Math.max(y, bounds.top), bounds.bottom - 1);
        let key: string | null = null;
        for (const row of viewport.querySelectorAll<HTMLElement>("[data-pull-request-key]")) {
          if (key !== null && row.getBoundingClientRect().top > visibleY) break;
          key = row.dataset.pullRequestKey ?? null;
        }
        if (key !== null) sweepTo(key);
      },
      onEnd: () => {
        const batch = sweptKeys.filter(canClose).flatMap((key) => {
          const row = closeSweepRef.current.closeSweepRows.get(key);
          return row ? [row.entry] : [];
        });
        void closeSweepRef.current.closeBatch(batch);
      },
      onCancel: () => {},
      onAbort: () => {},
    });
  }, []);
  const heldPullRequestsBySurface = useMemo(
    () =>
      new Map(
        groups.flatMap((group) =>
          group.entries.map((entry) => [pullRequestListEntryId(entry), entry] as const),
        ),
      ),
    [groups],
  );
  const listedPullRequestsBySurface = useMemo(
    () =>
      new Map(
        displayGroups.flatMap((group) =>
          group.entries.map((entry) => [pullRequestListEntryId(entry), entry] as const),
        ),
      ),
    [displayGroups],
  );

  const linkedSelection = useMemo(
    () =>
      search.repository && search.number && selectedProject
        ? {
            environmentId: selectedProject.environmentId,
            repository: search.repository,
            number: search.number,
            projectId: selectedProject.id,
            ...(selectedHost ? { host: selectedHost } : {}),
          }
        : null,
    [search.number, search.repository, selectedProject, selectedHost],
  );
  const rightPanelAvailable = selectedPullRequestSurface !== null;
  // A review guide maximizes the panel; tab changes must preserve that choice until the user toggles it.
  const [maximized, setMaximized] = useState(false);
  const rightPanelMaximized = rightPanelState.isOpen && maximized;
  if (!rightPanelState.isOpen && maximized) setMaximized(false);
  const toggleRightPanelMaximized = () => {
    if (rightPanelState.isOpen) setMaximized((value) => !value);
  };
  const onGuideShown = useCallback(() => setMaximized(true), []);
  useEffect(() => {
    if (!pullRequestsSupported || rightPanelRef === null || linkedSelection === null) return;
    useRightPanelStore.getState().openPullRequest(rightPanelRef, linkedSelection);
  }, [linkedSelection, pullRequestsSupported, rightPanelRef]);

  const selected =
    rightPanelState.isOpen && activePullRequestSurface !== null
      ? {
          environmentId: activePullRequestSurface.environmentId,
          repository: activePullRequestSurface.repository,
          number: activePullRequestSurface.number,
          projectId: activePullRequestSurface.projectId as ProjectId,
          host:
            activePullRequestSurface.host ??
            (selectedProject?.repositoryIdentity
              ? pullRequestHostOf(
                  selectedProject.repositoryIdentity,
                  selectedProject.repositoryIdentity.provider as SourceControlProviderKind,
                )
              : undefined),
        }
      : null;

  const selectSurfaceInUrl = (surface: PullRequestSurface | null) =>
    updateSearch(
      surface === null
        ? clearedSelection
        : {
            repository: surface.repository,
            number: surface.number,
            selectedProjectId: surface.projectId as ProjectId,
            selectedHost: surface.host,
            ...(surface.environmentId === undefined
              ? {}
              : { selectedEnvironmentId: surface.environmentId as EnvironmentId }),
          },
    );

  const toggleRightPanel = () => {
    if (rightPanelRef === null) return;
    if (rightPanelState.isOpen) {
      useRightPanelStore.getState().close(rightPanelRef);
      updateSearch(clearedSelection);
      return;
    }
    if (selectedPullRequestSurface === null) return;
    useRightPanelStore.getState().show(rightPanelRef);
    selectSurfaceInUrl(selectedPullRequestSurface);
  };

  // Projects provide the pre-load host shape; only server summaries establish readability.
  const expectedHosts = useMemo(() => {
    const byHost = new Map<string, PullRequestExpectedHost>();
    for (const project of projects) {
      const kind = project.repositoryIdentity?.provider as SourceControlProviderKind | undefined;
      if (kind === undefined) continue;
      const host = pullRequestHostOf(project.repositoryIdentity, kind);
      if (!byHost.has(host)) byHost.set(host, { host, kind });
    }
    return [...byHost.values()];
  }, [projects]);

  const unavailableProjects = useMemo(
    () =>
      new Map(
        listErrors.map(
          (error) =>
            [
              pullRequestProjectKey({ id: error.projectId, environmentId: error.environmentId }),
              error.message,
            ] as const,
        ),
      ),
    [listErrors],
  );

  // Stable so the memoized rows can skip re-rendering when the list around them changes.
  const selectEntry = useCallback(
    (entry: PullRequestRowTarget) => {
      if (rightPanelRef === null) return;
      useRightPanelStore.getState().openPullRequest(rightPanelRef, entry);
      updateSearch({
        repository: entry.repository,
        number: entry.number,
        selectedProjectId: entry.projectId,
        selectedEnvironmentId: entry.environmentId,
        selectedHost: entry.host,
      });
    },
    [rightPanelRef, updateSearch],
  );

  const searchInput = (
    <PullRequestSearchInput
      value={search.q ?? ""}
      busy={typedQuery.length > 0 && (!querySettled || showingCarried)}
      onChange={(query) => updateListScope({ q: query || undefined })}
    />
  );
  const panelToggleControls = (
    <PanelLayoutControls
      showTerminalControl={false}
      showThreadPanelControl={false}
      terminalAvailable={false}
      terminalOpen={false}
      terminalShortcutLabel={null}
      threadPanelOpen={false}
      threadPanelPresentation="inline"
      threadPanelShortcutLabel={null}
      onToggleThreadPanel={() => undefined}
      rightPanelAvailable={rightPanelAvailable}
      rightPanelOpen={rightPanelState.isOpen}
      rightPanelShortcutLabel={shortcutLabelForCommand(keybindings, "rightPanel.toggle")}
      rightPanelUnavailableLabel="Select a pull request first"
      onToggleTerminal={() => undefined}
      onToggleRightPanel={toggleRightPanel}
    />
  );
  const openPanelControls = (
    <div
      // Match the shared workspace controls inset, including the border-compensating mr-px.
      className="absolute top-[var(--workspace-controls-top)] right-[var(--workspace-controls-right)] z-50 mr-px flex h-[var(--workspace-topbar-height)] items-center gap-1 [-webkit-app-region:no-drag]"
      data-workspace-titlebar-controls
    >
      {rightPanelState.isOpen ? (
        <RightPanelMaximizeControl
          maximized={rightPanelMaximized}
          onToggle={toggleRightPanelMaximized}
        />
      ) : null}
      {panelToggleControls}
    </div>
  );
  // Carried rows narrowing to nothing cannot prove current filters are empty while the host request is
  // pending.
  const carriedToNothing =
    showingCarried && listQuery.isPending && shownCount === 0 && typedQuery.length === 0;
  const listBody = (
    <>
      {!capabilityKnown ? (
        <PullRequestListGhost rows={7} />
      ) : !pullRequestsSupported ? (
        <PullRequestsUnavailableState
          title="Pull requests unavailable"
          error="Update your T3 Code servers to browse pull requests."
        />
      ) : firstLoad ? (
        <PullRequestListGhost rows={7} />
      ) : listQuery.error && shownCount === 0 ? (
        <PullRequestsUnavailableState
          error={listQuery.error}
          refreshing={listQuery.isPending}
          onRetry={() => listQuery.refresh()}
        />
      ) : carriedToNothing ? (
        <PullRequestListGhost rows={7} />
      ) : shownCount === 0 ? (
        <PullRequestListEmptyState
          hasProjects={!projectsKnown || projects.length > 0}
          refreshing={refreshing}
          onRefresh={() => void refreshFromHost()}
          query={typedQuery}
          filtered={
            menuFiltered ||
            search.state !== "open" ||
            search.involvement !== "all" ||
            scopedProjectId !== undefined ||
            search.host !== undefined
          }
          searching={typedQuery.length > 0 && (!querySettled || showingCarried)}
          canLoadMore={listData?.truncated === true && (canContinue || pageSize < MAX_PAGE_SIZE)}
          loadingMore={loadingMore}
          onClearQuery={() => updateListScope({ q: undefined })}
          onLoadMore={loadMore}
        />
      ) : (
        <div className={cn("space-y-3", closeSweepKeys.size > 0 && "**:pointer-events-none")}>
          {displayGroups.map((group) => (
            <div key={group.key} className="space-y-0.5">
              {group.label ? <PullRequestGroupHeader group={group} /> : null}
              {group.entries.map((entry) => {
                const entryKey = pullRequestEntryKey(entry);
                return (
                  <PullRequestRow
                    key={entryKey}
                    statsKey={entryKey}
                    statsRef={registerStatsRow}
                    entry={entry}
                    showProjectTitle
                    showProvider={showProvider}
                    {...(capableEnvironments.length > 1 &&
                    environmentLabels.get(entry.environmentId) !== undefined
                      ? { environmentLabel: environmentLabels.get(entry.environmentId)! }
                      : {})}
                    matchedElsewhere={
                      typedParsed.text.length > 0 &&
                      scorePullRequestMatch(entry, typedParsed.text) <= MATCHED_ELSEWHERE_SCORE
                    }
                    selected={
                      selected?.environmentId === entry.environmentId &&
                      selected.repository === entry.repository &&
                      selected.host?.toLowerCase() === entry.host.toLowerCase() &&
                      selected.number === entry.number
                    }
                    onSelect={selectEntry}
                    speedMode={speedMode}
                    hostActions={hostActionsOf(entry)}
                    onActed={onSpeedAction}
                    closing={closingKeys.has(entryKey)}
                    sweeping={closeSweepKeys.has(entryKey)}
                    onCloseSweepStart={startCloseSweep}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}

      {listQuery.error && shownCount > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-surface px-3 py-2 text-xs">
          <span>{listQuery.error} Showing the last pull requests loaded.</span>
          <Button size="xs" variant="outline" onClick={() => listQuery.refresh()}>
            Retry
          </Button>
        </div>
      ) : null}
      {listData?.truncated && entries.length > 0 ? (
        <div className="flex justify-center py-3 text-xs text-muted-foreground">
          {loadingMore ? (
            <span className="flex items-center gap-2">
              <Spinner aria-hidden size="sm" />
              {sentCursors === null ? "Updating pull requests" : "Loading more"}
            </span>
          ) : canContinue || pageSize < MAX_PAGE_SIZE ? (
            <Button
              size="sm"
              variant="outline"
              onClick={loadMore}
              disabled={listQuery.isPending || showingCarried}
            >
              Load more pull requests
            </Button>
          ) : (
            <span>Narrow your search to find more pull requests.</span>
          )}
        </div>
      ) : null}
    </>
  );
  // Share host names/icons with pills; include hostname only when multiple installs need distinguishing.
  const hostEntries = hosts.length > 0 ? hosts : expectedHosts;
  const hostMenuOptions: ReadonlyArray<PullRequestFilterOption<string>> = [
    { value: "", label: "All", Icon: Plug2Icon },
    ...hostEntries.map((entry) => {
      const summary = hosts.find((host) => host.host === entry.host);
      return {
        value: entry.host,
        label: pullRequestHostLabel(hostEntries, entry),
        Icon: getSourceControlPresentationForKind(entry.kind).Icon,
        ...(summary === undefined || summary.configured
          ? {}
          : { unavailable: summary.detail ?? "This host could not be read." }),
      };
    }),
  ];
  const serverMenuOptions: ReadonlyArray<PullRequestFilterOption<string>> = [
    { value: "", label: "All servers", Icon: LayersIcon },
    ...capableEnvironments.map((environment) => ({
      value: environment.environmentId,
      label: environment.label,
      Icon: environmentMachineIcon(resolveEnvironmentMachineKind(environment.serverConfig)),
    })),
  ];
  const sortMenu = (
    <CompactFilterMenu
      label="Sort pull requests"
      triggerIcon={<ArrowDownUpIcon aria-hidden className="size-4" />}
      triggerLabel="Sort"
      outlined
      value={sort}
      options={SORT_OPTIONS}
      onChange={(next) => updateListScope({ sort: next })}
    />
  );
  const filtersMenu = (
    <PullRequestFiltersMenuInSidebarOrder
      onOpenChange={setFiltersOpen}
      state={search.state}
      stateOptions={STATE_TABS}
      onState={(state) => updateListScope({ state })}
      involvement={search.involvement}
      involvementOptions={INVOLVEMENT_TABS}
      onInvolvement={(involvement) => updateListScope({ involvement })}
      filters={menuFilters}
      onFilters={(next) =>
        updateListScope({
          draft: next.draft,
          review: next.review,
          checks: next.checks,
          author: next.author,
          labels: next.labels?.flatMap((group) => group),
        })
      }
      authorOptions={facets.authors}
      labelOptions={facets.labels}
      host={search.host}
      hostOptions={hostMenuOptions}
      onHost={(host) => updateListScope({ host })}
      server={scopedEnvironmentId ?? undefined}
      serverOptions={serverMenuOptions}
      // Narrowing to one server drops a project scope belonging to another, which would
      // otherwise narrow the list to nothing with no visible filter to explain it.
      onServer={(server) => updateListScope({ environmentId: server, projectId: undefined })}
      projects={scopedProjects}
      projectId={scopedProjectId}
      projectEnvironmentId={scopedProject?.environmentId}
      unavailable={unavailableProjects}
      // Scope projects with their owning environment to avoid duplicate-id matches; All projects preserves server
      // scope.
      onProject={(projectId, environmentId) =>
        updateListScope(environmentId === undefined ? { projectId } : { projectId, environmentId })
      }
    />
  );
  const columnProps = {
    refreshing,
    onRefresh: () => void refreshFromHost(),
    searchValue: search.q ?? "",
    involvement: search.involvement,
    state: search.state,
    host: search.host,
    hostMenuOptions,
    onInvolvement: (involvement: PullRequestInvolvement) => updateListScope({ involvement }),
    onState: (state: PullRequestListState) => updateListScope({ state }),
    onHost: (host: string | undefined) => updateListScope({ host }),
    searchInput,
    sortMenu,
    filtersMenu,
    rightPanelControl:
      // Reserve space for the fixed panel toggle so refresh cannot slide under it while the panel is closed.
      !pullRequestsSupported ? null : (
        <span
          aria-hidden
          className={cn(
            "shrink-0",
            rightPanelState.isOpen ? "-ml-3 w-0" : "w-7 sm:w-5",
            panelAnimationsActive && "transition-[width,margin] ease-out",
          )}
          style={
            panelAnimationsActive
              ? { transitionDuration: `${panelAnimationDurationMs}ms` }
              : undefined
          }
        />
      ),
    titlebarControls:
      // Electron drag hit-testing ignores z-index; mount no-drag controls inside the header while closed and keep
      // motion overlaps non-draggable.
      pullRequestsSupported ? (
        rightPanelPresent ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-full w-7 [-webkit-app-region:no-drag]"
          />
        ) : (
          openPanelControls
        )
      ) : null,
    rightPanelOpen: rightPanelState.isOpen,
    maximizedAway: rightPanelMaximized,
    listBody,
    scrollRef,
  };

  const activateSurface = (surface: PullRequestSurface) => {
    if (rightPanelRef === null) return;
    useRightPanelStore.getState().activateSurface(rightPanelRef, surface.id);
    selectSurfaceInUrl(surface);
  };
  const closeSurface = (surface: PullRequestSurface) => {
    if (rightPanelRef === null) return;
    useRightPanelStore.getState().closeSurface(rightPanelRef, surface.id);
    const next = selectActiveRightPanelSurface(
      useRightPanelStore.getState().byThreadKey,
      rightPanelRef,
    );
    selectSurfaceInUrl(next?.kind === "pull-request" ? next : null);
  };
  const closeOtherSurfaces = (surface: PullRequestSurface) => {
    if (rightPanelRef === null) return;
    useRightPanelStore.getState().closeOtherSurfaces(rightPanelRef, surface.id);
    selectSurfaceInUrl(surface);
  };
  const closeSurfacesToRight = (surface: PullRequestSurface) => {
    if (rightPanelRef === null) return;
    useRightPanelStore.getState().closeSurfacesToRight(rightPanelRef, surface.id);
    const next = selectActiveRightPanelSurface(
      useRightPanelStore.getState().byThreadKey,
      rightPanelRef,
    );
    selectSurfaceInUrl(next?.kind === "pull-request" ? next : null);
  };
  const closeAllSurfaces = () => {
    if (rightPanelRef === null) return;
    useRightPanelStore.getState().closeAllSurfaces(rightPanelRef);
    selectSurfaceInUrl(null);
  };

  // This page has no ChatView, so it handles the shared panel shortcuts itself.
  const copyPullRequestFromShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!openPanelPullRequestUrl) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    const url = openPanelPullRequestUrl;
    void writeTextToClipboard(url, "pull request link").then(
      (didCopy) => {
        if (didCopy)
          toastManager.add({ type: "success", title: "PR link copied", description: url });
      },
      (error) => {
        toastManager.add({
          type: "error",
          title: "Failed to copy PR link",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      },
    );
  });
  const closeActiveSurfaceFromShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (activePullRequestSurface === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) closeSurface(activePullRequestSurface);
  });
  const toggleRightPanelFromShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!rightPanelAvailable) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) toggleRightPanel();
  });
  const toggleRightPanelMaximizedFromShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!rightPanelState.isOpen) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) toggleRightPanelMaximized();
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isCommandPaletteOpen()) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: getShortcutContext(),
      });
      if (command === "rightPanel.close") closeActiveSurfaceFromShortcut(event);
      if (command === "rightPanel.toggle") toggleRightPanelFromShortcut(event);
      if (command === "rightPanel.toggleMaximized") toggleRightPanelMaximizedFromShortcut(event);
      if (command === "thread.copyReference") copyPullRequestFromShortcut(event);
    };
    // Let panel shortcuts consume Escape before page navigation at window.
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [keybindings]);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="relative flex min-h-0 flex-1">
        {pullRequestsSupported && rightPanelPresent ? openPanelControls : null}
        <PullRequestsColumn {...columnProps} />

        {rightPanelPresent && renderedPullRequestSurface && panelEnvironmentId !== null ? (
          <RightPanelTabs
            mode="inline"
            open={rightPanelState.isOpen}
            maximized={rightPanelMaximized}
            keybindings={keybindings}
            getShortcutContext={getShortcutContext}
            widthStorageKey="t3code:pull-request-panel-width"
            // Use roughly half the viewport because the chat default leaves too little space for the PR list.
            defaultWidth={typeof window === "undefined" ? 640 : Math.floor(window.innerWidth / 2)}
            surfaces={renderedRightPanelSurfaces}
            environmentId={panelEnvironmentId}
            activeSurfaceId={renderedPullRequestSurface.id}
            pendingSurfaceIds={EMPTY_PENDING_SURFACES}
            previewSessions={EMPTY_PREVIEW_SESSIONS}
            desktopByTabId={EMPTY_PREVIEW_DESKTOP_STATE}
            terminalLabelsById={EMPTY_TERMINAL_LABELS}
            onActivate={(surface) => {
              if (surface.kind === "pull-request") activateSurface(surface);
            }}
            onCloseSurface={(surface) => {
              if (surface.kind === "pull-request") closeSurface(surface);
            }}
            onCloseOtherSurfaces={(surface) => {
              if (surface.kind === "pull-request") closeOtherSurfaces(surface);
            }}
            onCloseSurfacesToRight={(surface) => {
              if (surface.kind === "pull-request") closeSurfacesToRight(surface);
            }}
            onCloseAllSurfaces={closeAllSurfaces}
            onMoveSurface={(surfaceId, toIndex) => {
              if (rightPanelRef !== null)
                useRightPanelStore.getState().moveSurface(rightPanelRef, surfaceId, toIndex);
            }}
            onCopyFilePath={() => undefined}
            onAddBrowser={() => undefined}
            onAddBrowserInProfile={() => undefined}
            onAddTerminal={() => undefined}
            onAddDiff={() => undefined}
            onAddFiles={() => undefined}
            onAddPullRequest={() => undefined}
            onAddPullRequests={() => undefined}
            onAddDevice={() => undefined}
            browserAvailable={false}
            terminalAvailable={false}
            diffAvailable={false}
            filesAvailable={false}
            pullRequestAvailable={false}
            pullRequestsAvailable={false}
            deviceAvailable={false}
            pullRequestStatusSeeds={listedPullRequestTabStatuses}
          >
            <PullRequestDetailPanel
              getShortcutContext={getShortcutContext}
              shortcutsEnabled={activePullRequestSurface?.id === renderedPullRequestSurface.id}
              key={renderedPullRequestSurface.id}
              environmentId={panelEnvironmentId}
              onGuideShown={onGuideShown}
              onSelectPullRequest={(reference) => {
                if (rightPanelRef === null) return;
                useRightPanelStore.getState().openPullRequest(rightPanelRef, {
                  projectId: reference.projectId,
                  repository: reference.repository,
                  number: reference.number,
                  ...(reference.host ? { host: reference.host } : {}),
                  environmentId: panelEnvironmentId,
                });
                updateSearch({
                  repository: reference.repository,
                  number: reference.number,
                  selectedHost: reference.host,
                  selectedProjectId: reference.projectId,
                  selectedEnvironmentId: panelEnvironmentId,
                });
              }}
              reference={{
                projectId: renderedPullRequestSurface.projectId as ProjectId,
                repository: renderedPullRequestSurface.repository,
                number: renderedPullRequestSurface.number,
                ...(renderedPullRequestSurface.host
                  ? { host: renderedPullRequestSurface.host }
                  : {}),
              }}
              listEntry={
                listedPullRequestsBySurface.get(
                  pullRequestListEntryId(renderedPullRequestSurface),
                ) ?? null
              }
              refreshToken={detailRefreshToken}
              // Host actions can change both readiness and diff size, so refresh the counts
              // alongside the list. The panel already refreshes itself after each action.
              onActed={(action, phase = "done") => {
                // Apply and roll back state-only actions optimistically; refresh counts/checks after other actions
                // complete. Look up held rows too because closed rows have already left the visible list.
                const acted = heldPullRequestsBySurface.get(
                  pullRequestListEntryId(renderedPullRequestSurface),
                );
                const stateOnly =
                  action !== undefined &&
                  acted !== undefined &&
                  pullRequestOverrideAfterAction(acted, action, new Date(), 0) !== null;
                if (stateOnly) {
                  const key = pullRequestEntryKey(acted);
                  // Hosts can queue a merge without merging, so apply its override only after completion.
                  // Merge failures wrote no override; do not revert an earlier action on the same row.
                  if (phase === "sent" && action !== "merge") {
                    detailOverrideTokens.current.set(key, overrideEntry(acted, action));
                  }
                  if (phase === "failed" && action !== "merge") {
                    revertOverride(key, detailOverrideTokens.current.get(key) ?? null);
                  }
                  if (phase !== "sent") detailOverrideTokens.current.delete(key);
                  if (phase === "done" && action === "merge") {
                    overrideEntry(acted, action);
                    refreshListAndStats(undefined, panelEnvironmentId);
                  }
                  return;
                }
                if (phase === "done") refreshListAndStats(undefined, panelEnvironmentId);
              }}
            />
          </RightPanelTabs>
        ) : null}
      </div>
    </SidebarInset>
  );
}

/** A compact stand-in for one pill group when the header is narrow. */
/** Keep thread-activity subscriptions out of the page. */
function PullRequestFiltersMenuInSidebarOrder(
  props: ComponentProps<typeof PullRequestFiltersMenu>,
) {
  const sidebarProjectGroups = useSidebarProjectGroups();
  const projects = useMemo(
    () => sortProjectsByGroupOrder(props.projects, sidebarProjectGroups),
    [props.projects, sidebarProjectGroups],
  );
  return <PullRequestFiltersMenu {...props} projects={projects} />;
}

function CompactFilterMenu<Value extends string>({
  label,
  triggerIcon,
  triggerLabel,
  outlined = false,
  iconOnly = false,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  triggerIcon?: ReactNode;
  triggerLabel?: string;
  outlined?: boolean;
  iconOnly?: boolean;
  value: Value;
  options: ReadonlyArray<PullRequestFilterOption<Value>>;
  onChange: (value: Value) => void;
  className?: string;
}) {
  const current = options.find((option) => option.value === value) ?? options[0];
  if (!current) return null;
  return (
    <Menu>
      <MenuTrigger
        aria-label={triggerLabel || iconOnly ? `${label}: ${current.label}` : label}
        title={iconOnly ? `${label}: ${current.label}` : undefined}
        render={
          outlined ? (
            <Button variant="outline" size={iconOnly ? "icon" : "default"} />
          ) : (
            <Button variant="ghost-muted" size="sm" />
          )
        }
        className={cn("min-w-0", className)}
      >
        {iconOnly ? (
          <current.Icon aria-hidden className="size-4" />
        ) : triggerLabel ? (
          <>
            {triggerIcon}
            <span>{triggerLabel}</span>
          </>
        ) : (
          <>
            <span className="truncate">{current.label}</span>
            <ChevronDownIcon aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />
          </>
        )}
      </MenuTrigger>
      <MenuPopup align="start" side="bottom">
        <MenuRadioGroup value={value} onValueChange={(next) => onChange(next as Value)}>
          {options.map((option) => {
            const item = (
              <MenuRadioItem
                key={option.value}
                value={option.value}
                disabled={option.unavailable !== undefined}
                className="data-disabled:pointer-events-auto"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <PullRequestFilterOptionIcon option={option} />
                  {option.label}
                </span>
              </MenuRadioItem>
            );
            return option.unavailable === undefined ? (
              item
            ) : (
              <Tooltip key={option.value}>
                <TooltipTrigger render={item} />
                <TooltipPopup side="right">{option.unavailable}</TooltipPopup>
              </Tooltip>
            );
          })}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

/** Keep search expanded while it holds a query so active filtering stays visible. */
function ExpandableSearch({
  searchInput,
  searchValue,
  open,
  onOpenChange,
  focusToken,
  onFocusWithin,
}: {
  searchInput: ReactNode;
  searchValue: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bumped to pull focus into the input while it is already showing — the Mod+F path. */
  focusToken: number;
  /** Unmount fires no blur; preserve focus-within intent so the replacement input can continue typing. */
  onFocusWithin?: (focused: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    containerRef.current?.querySelector("input")?.focus();
  }, [open]);
  const appliedFocusToken = useRef(focusToken);
  useEffect(() => {
    if (appliedFocusToken.current === focusToken) return;
    appliedFocusToken.current = focusToken;
    const input = containerRef.current?.querySelector("input");
    input?.focus();
    input?.select();
  }, [focusToken]);
  if (open || searchValue.length > 0) {
    return (
      <div
        ref={containerRef}
        className="w-56 min-w-24 shrink"
        onFocus={() => onFocusWithin?.(true)}
        onBlur={() => {
          onFocusWithin?.(false);
          if (searchValue.length === 0) onOpenChange(false);
        }}
      >
        {searchInput}
      </div>
    );
  }
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label="Search pull requests"
      onClick={() => onOpenChange(true)}
    >
      <SearchIcon className="size-4" />
    </Button>
  );
}

/**
 * The topbar is a window drag region; interactive children must opt out through drag-region descendant
 * rules.
 */
function PullRequestsColumn({
  refreshing,
  onRefresh,
  searchValue,
  involvement,
  state,
  host,
  hostMenuOptions,
  onInvolvement,
  onState,
  onHost,
  searchInput,
  sortMenu,
  filtersMenu,
  rightPanelControl,
  titlebarControls,
  rightPanelOpen,
  maximizedAway,
  listBody,
  scrollRef,
}: {
  refreshing: boolean;
  onRefresh: () => void;
  searchValue: string;
  involvement: PullRequestInvolvement;
  state: PullRequestListState;
  host: string | undefined;
  hostMenuOptions: ReadonlyArray<PullRequestFilterOption<string>>;
  onInvolvement: (involvement: PullRequestInvolvement) => void;
  onState: (state: PullRequestListState) => void;
  onHost: (host: string | undefined) => void;
  searchInput: ReactNode;
  sortMenu: ReactNode;
  filtersMenu: ReactNode;
  rightPanelControl: ReactNode;
  titlebarControls: ReactNode;
  rightPanelOpen: boolean;
  maximizedAway: boolean;
  listBody: ReactNode;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const markerRef = useRef<HTMLDivElement | null>(null);
  const [condensed, setCondensed] = useState(false);
  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;
    const observer = new IntersectionObserver(
      ([entry]) => setCondensed(entry ? !entry.isIntersecting : false),
      { root: scrollRef.current },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, []);
  // Narrowing search can unmount the condensed input; transfer focus and caret to the in-flow search.
  const topbarSearchFocusedRef = useRef(false);
  const inFlowSearchRef = useRef<HTMLDivElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchExpanded = searchOpen || searchValue.length > 0;
  // Desktop has no native find-in-page; Mod+F must focus the page's own current search input.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key.toLowerCase() !== "f" || !(event.metaKey || event.ctrlKey)) return;
      if (event.altKey || event.shiftKey) return;
      event.preventDefault();
      if (condensed) {
        setSearchOpen(true);
        setSearchFocusToken((token) => token + 1);
        return;
      }
      const input = inFlowSearchRef.current?.querySelector("input");
      input?.focus();
      input?.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [condensed]);
  useEffect(() => {
    if (condensed) return;
    // The fold-out is gone from the chrome; forgetting it open keeps the next condensing
    // from starting with an empty expanded search nobody asked for.
    setSearchOpen(false);
    if (!topbarSearchFocusedRef.current) return;
    topbarSearchFocusedRef.current = false;
    const input = inFlowSearchRef.current?.querySelector("input");
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [condensed]);

  return (
    // Painted flat like the chat column: the inset underneath carries the chrome grain, and a
    // content surface that lets it show reads as a different background than every thread.
    <div
      className={cn(
        "@container/pr-list flex min-h-0 min-w-0 flex-col overflow-x-hidden bg-background",
        maximizedAway ? "w-0 flex-none" : "flex-1",
      )}
    >
      {/*
       * While closed, mount no-drag controls as header descendants because Electron ignores sibling z-index.
       * While open, use the route-level box so the toggle retains its top-right anchor.
       */}
      <WorkspacePageHeader
        electron={isElectron}
        reserveNativeControls={!rightPanelOpen}
        className="relative bg-background"
      >
        {titlebarControls}
        {condensed ? (
          <WorkspaceBreadcrumb ariaLabel="Pull request scope" className="overflow-hidden">
            {/* An expanded search owns the scarce horizontal space. The page title stays
                available to readers while the live filters remain available in both states. */}
            <WorkspaceBreadcrumbItem current className={cn(searchExpanded && "sr-only")}>
              <h1 className="truncate">Pull Requests</h1>
            </WorkspaceBreadcrumbItem>
            {searchExpanded ? null : <WorkspaceBreadcrumbSeparator />}
            <WorkspaceBreadcrumbItem className="shrink gap-1.5">
              <CompactFilterMenu
                label="Filter by state"
                value={state}
                options={STATE_TABS}
                onChange={onState}
                className="shrink-0"
              />
              <CompactFilterMenu
                label="Filter by involvement"
                value={involvement}
                options={INVOLVEMENT_TABS}
                onChange={onInvolvement}
              />
              {hostMenuOptions.length > 2 ? (
                <CompactFilterMenu
                  label="Filter by host"
                  value={host ?? ""}
                  options={hostMenuOptions}
                  onChange={(next) => onHost(next === "" ? undefined : next)}
                />
              ) : null}
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        ) : (
          <WorkspaceBreadcrumb ariaLabel="Pull requests breadcrumb">
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">Pull Requests</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        )}
        <div className="min-w-0 flex-1" />
        {condensed ? (
          <div className="flex shrink items-center gap-1.5">
            <ExpandableSearch
              searchInput={searchInput}
              searchValue={searchValue}
              open={searchOpen}
              onOpenChange={setSearchOpen}
              focusToken={searchFocusToken}
              onFocusWithin={(focused) => {
                topbarSearchFocusedRef.current = focused;
              }}
            />
            <PullRequestRefreshControl compact refreshing={refreshing} onRefresh={onRefresh} />
          </div>
        ) : null}
        {rightPanelControl}
      </WorkspacePageHeader>

      <div
        ref={scrollRef}
        className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto"
      >
        {/* Match the shared fade-band padding so resting controls remain below the mask. */}
        <WorkspacePageContainer width="expanded" className="min-h-full gap-4">
          <div className="flex flex-col gap-3">
            <div ref={inFlowSearchRef} className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 basis-full @lg/pr-list:basis-0 @lg/pr-list:flex-1">
                {searchInput}
              </div>
              {sortMenu}
              {filtersMenu}
              <CompactFilterMenu
                label="Filter by provider"
                outlined
                iconOnly={host !== undefined}
                triggerIcon={<Plug2Icon aria-hidden className="size-4" />}
                triggerLabel="All"
                value={host ?? ""}
                options={hostMenuOptions}
                onChange={(next) => onHost(next === "" ? undefined : next)}
              />
              {!condensed ? (
                <PullRequestRefreshControl refreshing={refreshing} onRefresh={onRefresh} />
              ) : null}
            </div>
            {/* Scrolled past this marker, the controls are gone and the title takes over. */}
            <div ref={markerRef} aria-hidden className="-mt-3 h-px w-full" />
          </div>

          {listBody}
        </WorkspacePageContainer>
      </div>
    </div>
  );
}

function PullRequestRefreshControl({
  compact = false,
  refreshing,
  onRefresh,
}: {
  compact?: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <Button
      size={compact ? "icon-sm" : "icon"}
      variant={compact ? "ghost" : "outline"}
      aria-label="Refresh pull requests"
      onClick={onRefresh}
      disabled={refreshing}
    >
      <RefreshIcon size="md" refreshing={refreshing} />
    </Button>
  );
}
