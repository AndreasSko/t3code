import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";
import type { MobileThemeVariables } from "./mobileTheme";

/** Use for APIs without className support; shares the root theme commit to avoid CSS-variable subscriptions. */
export function useUniwindTheme(): MobileThemeVariables {
  return useAppearancePreferences().themeVariables;
}
