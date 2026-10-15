import { resolveEnvironmentMachineKind, type EnvironmentId } from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, LayersIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { useEnvironments } from "../../state/environments";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { ProjectFavicon } from "../ProjectFavicon";
import { ITEM_ROW_CLASSNAME } from "./itemRows";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import type { SettingsScopeSearch } from "./settingsScope";
import { settingsScopeEnvironmentLabels } from "./settingsScopeAxis";
import { useSettingsProjectGroups } from "./useSettingsProjectGroups";

interface ScopeChoice {
  label: string;
  secondary?: string;
  icon: ReactNode;
  search: SettingsScopeSearch;
}

/** Offer an explicit target change when a category has no settings at this scope. */
export function SettingsScopeNotice({
  children,
  target,
  targetId,
  eligibleEnvironmentIds,
}: {
  children: string;
  target: "environment" | "all" | "project" | "checkout";
  targetId?: string;
  eligibleEnvironmentIds?: readonly EnvironmentId[];
}) {
  const { selectScope, search } = useSettingsScope();
  const navigate = useNavigate({ from: "/settings" });
  const pathname = useLocation({ select: (location) => location.pathname });
  const { environments } = useEnvironments();
  const groups = useSettingsProjectGroups();
  const choiceGroups: { key: string; title?: string; choices: ScopeChoice[] }[] =
    target === "checkout"
      ? groups
          .filter((group) => !search.project || group.projectKey === search.project)
          .map((group) => ({
            key: group.projectKey,
            title: group.displayName,
            choices: group.memberProjects.map((member) => {
              const environment = environments.find(
                (entry) => entry.environmentId === member.environmentId,
              );
              return {
                label: environment
                  ? settingsScopeEnvironmentLabels(environment).primary
                  : (member.environmentLabel ?? "Environment"),
                secondary: member.workspaceRoot,
                icon: environment ? (
                  <EnvironmentMachineIcon
                    aria-hidden
                    kind={resolveEnvironmentMachineKind(environment.serverConfig)}
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                ) : null,
                search: {
                  project: group.projectKey,
                  machine: member.environmentId,
                  checkout: member.physicalProjectKey,
                },
              };
            }),
          }))
      : [
          {
            key: target,
            choices:
              target === "project"
                ? groups.map((group) => ({
                    label: group.displayName,
                    secondary: group.workspaceRoot,
                    icon: <ProjectFavicon project={group} className="size-4 shrink-0" />,
                    search: { project: group.projectKey },
                  }))
                : target === "environment"
                  ? environments
                      .filter(
                        (entry) =>
                          eligibleEnvironmentIds === undefined ||
                          eligibleEnvironmentIds.includes(entry.environmentId),
                      )
                      .map((entry) => {
                        const { primary, secondary } = settingsScopeEnvironmentLabels(entry);
                        return {
                          label: primary,
                          secondary,
                          icon: (
                            <EnvironmentMachineIcon
                              aria-hidden
                              kind={resolveEnvironmentMachineKind(entry.serverConfig)}
                              className="size-4 shrink-0 text-muted-foreground"
                            />
                          ),
                          search: { machine: entry.environmentId },
                        };
                      })
                  : [
                      {
                        label: "Open all environments",
                        icon: (
                          <LayersIcon
                            aria-hidden
                            className="size-4 shrink-0 text-muted-foreground"
                          />
                        ),
                        search: {},
                      },
                    ],
          },
        ];
  const choiceCount = choiceGroups.reduce((total, group) => total + group.choices.length, 0);
  const renderChoices = (choices: ScopeChoice[]) =>
    choices.map((choice) => (
      <button
        key={JSON.stringify(choice.search)}
        type="button"
        className={cn(
          ITEM_ROW_CLASSNAME,
          "flex w-full min-w-0 cursor-pointer items-center gap-3 text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        )}
        onClick={() => {
          if (targetId)
            void navigate({ to: pathname, search: () => choice.search, hash: targetId });
          else selectScope(choice.search);
        }}
      >
        {choice.icon}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{choice.label}</span>
          {choice.secondary ? (
            <span title={choice.secondary} className="block truncate text-xs text-muted-foreground">
              {choice.secondary}
            </span>
          ) : null}
        </span>
        <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>
    ));
  return (
    <SettingsPageContainer>
      <div className="space-y-3">
        <p role="status" className="px-3 text-sm text-muted-foreground sm:px-4">
          {children}
        </p>
        <div
          className={cn(
            "space-y-4",
            choiceCount > 6 && "max-h-96 overflow-y-auto overscroll-contain",
          )}
        >
          {choiceGroups.map((group) =>
            group.title ? (
              <SettingsSection key={group.key} title={group.title}>
                {renderChoices(group.choices)}
              </SettingsSection>
            ) : (
              <SettingsGroup key={group.key}>{renderChoices(group.choices)}</SettingsGroup>
            ),
          )}
        </div>
      </div>
    </SettingsPageContainer>
  );
}
