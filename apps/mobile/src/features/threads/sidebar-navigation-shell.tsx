import { createV5StackNavigator as createNativeStackNavigator } from "../../native/createV5StackNavigator";
import { NavigationContainer, NavigationIndependentTree } from "@react-navigation/native";
import { type NativeStackNavigationOptions } from "@react-navigation/native-stack";
import type { ReactNode } from "react";
import { Platform } from "react-native";

import { getCompactBrandHeaderOptions } from "../../components/CompactBrandTitle";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { nativeHeaderScrollEdgeEffects } from "../../native/StackHeader";
import { useMobileNavigationTheme } from "../../lib/useMobileNavigationTheme";

const SCROLL_EDGE_EFFECTS = nativeHeaderScrollEdgeEffects(Platform.OS, Platform.Version);

type SidebarScreenOptions = NativeStackNavigationOptions & {
  // The patched iOS 26 editor item style leading-aligns the inline title.
  readonly unstable_navigationItemStyle?: "editor";
};

/** Only dynamic search callbacks and header items are configured by the screen content. */
const SIDEBAR_SCREEN_OPTIONS: SidebarScreenOptions = {
  contentStyle: { backgroundColor: "transparent" },
  headerLargeTitle: false,
  headerShadowVisible: false,
  headerShown: true,
  headerStyle: NATIVE_LIQUID_GLASS_SUPPORTED ? { backgroundColor: "transparent" } : undefined,
  ...getCompactBrandHeaderOptions({ fontSize: 18, fontWeight: "800" }),
  headerTransparent: NATIVE_LIQUID_GLASS_SUPPORTED,
  scrollEdgeEffects: NATIVE_LIQUID_GLASS_SUPPORTED ? SCROLL_EDGE_EFFECTS : undefined,
  unstable_navigationItemStyle: NATIVE_LIQUID_GLASS_SUPPORTED ? "editor" : undefined,
};

const SidebarStack = createNativeStackNavigator();

/** This navigation-inert stack owns native sidebar chrome; all destination navigation stays on the root stack. */
export function SidebarNavigationShell(props: { readonly children: ReactNode }) {
  const navigationTheme = useMobileNavigationTheme("sidebar");

  return (
    <NavigationIndependentTree>
      <NavigationContainer theme={navigationTheme}>
        <SidebarStack.Navigator
          screenOptions={SIDEBAR_SCREEN_OPTIONS}
          initialRouteName="SidebarThreads"
        >
          <SidebarStack.Screen name="SidebarThreads">{() => props.children}</SidebarStack.Screen>
        </SidebarStack.Navigator>
      </NavigationContainer>
    </NavigationIndependentTree>
  );
}
