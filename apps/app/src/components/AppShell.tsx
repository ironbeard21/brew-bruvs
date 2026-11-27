// SPDX-License-Identifier: AGPL-3.0-or-later
import { usePathname, useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCurrentUser, useUpdateMe } from "../api/auth";
import { useOptionalBrewery } from "../state/brewery";
import { useServer } from "../state/server";
import { colors, DESKTOP_BREAKPOINT, radii, spacing } from "../theme";
import { UnitToggle } from "./UnitToggle";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export interface AppShellProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
}

function formatHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function AppShell({ children, title, subtitle }: AppShellProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;
  const pathname = usePathname();
  const router = useRouter();
  const { serverUrl, authToken, offlineMode } = useServer();
  const currentUser = useCurrentUser(serverUrl, authToken);
  const updateMe = useUpdateMe(serverUrl, authToken);
  const { myInvitesCount } = useOptionalBrewery();

  const onCalculators = pathname === "/calculators";
  const onRecipes = pathname === "/recipes" || pathname.startsWith("/recipes/");
  const onBatches = pathname === "/batches" || pathname.startsWith("/batches/");
  const onInventory = pathname === "/inventory" || pathname.startsWith("/inventory/");
  const onEquipment = pathname === "/equipment" || pathname.startsWith("/equipment/");
  const onBreweries = pathname === "/breweries" || pathname.startsWith("/breweries/");
  const onSettings =
    pathname === "/settings" || pathname === "/admin" || pathname === "/integrations";
  const onAbout = pathname === "/about";
  const onServer = pathname === "/connect" || pathname === "/login";

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <View nativeID="app-shell-header" style={styles.headerOuter}>
        <View style={[styles.headerInner, isDesktop && styles.headerInnerDesktop]}>
          <View style={styles.brandRow}>
            <Text accessibilityRole="header" style={styles.brandTitle}>
              Brew-Bruvs
            </Text>
            <View
              style={[
                styles.statusPill,
                serverUrl ? styles.statusPillConnected : styles.statusPillOffline,
              ]}
              accessible
              accessibilityLabel={
                serverUrl
                  ? `Connected to ${formatHost(serverUrl)}`
                  : offlineMode
                    ? "Offline mode"
                    : "Not connected to a server"
              }
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.statusPillText,
                  serverUrl ? styles.statusPillTextConnected : styles.statusPillTextOffline,
                ]}
              >
                {serverUrl ? formatHost(serverUrl) : offlineMode ? "Offline" : "No server"}
              </Text>
            </View>
          </View>

          <View style={styles.controlsRow}>
            <View style={styles.navRow}>
              <Pressable
                onPress={() => router.push("/calculators")}
                accessibilityRole="tab"
                accessibilityLabel="Calculators"
                accessibilityState={{ selected: onCalculators }}
                testID="nav-calculators"
                style={[styles.navLink, onCalculators && styles.navLinkActive]}
              >
                <Text style={[styles.navLinkText, onCalculators && styles.navLinkTextActive]}>
                  Calculators
                </Text>
              </Pressable>

              <Pressable
                onPress={() => router.push("/recipes")}
                accessibilityRole="tab"
                accessibilityLabel="Recipes"
                accessibilityState={{ selected: onRecipes }}
                testID="nav-recipes"
                style={[styles.navLink, onRecipes && styles.navLinkActive]}
              >
                <Text style={[styles.navLinkText, onRecipes && styles.navLinkTextActive]}>
                  Recipes
                </Text>
              </Pressable>

              <Pressable
                onPress={() => router.push("/batches")}
                accessibilityRole="tab"
                accessibilityLabel="Batches"
                accessibilityState={{ selected: onBatches }}
                testID="nav-batches"
                style={[styles.navLink, onBatches && styles.navLinkActive]}
              >
                <Text style={[styles.navLinkText, onBatches && styles.navLinkTextActive]}>
                  Batches
                </Text>
              </Pressable>

              <Pressable
                onPress={() => router.push("/inventory")}
                accessibilityRole="tab"
                accessibilityLabel="Inventory and shopping list"
                accessibilityState={{ selected: onInventory }}
                testID="nav-inventory"
                style={[styles.navLink, onInventory && styles.navLinkActive]}
              >
                <Text style={[styles.navLinkText, onInventory && styles.navLinkTextActive]}>
                  Inventory
                </Text>
              </Pressable>

              <Pressable
                onPress={() => router.push("/equipment")}
                accessibilityRole="tab"
                accessibilityLabel="Equipment and lending"
                accessibilityState={{ selected: onEquipment }}
                testID="nav-equipment"
                style={[styles.navLink, onEquipment && styles.navLinkActive]}
              >
                <Text style={[styles.navLinkText, onEquipment && styles.navLinkTextActive]}>
                  Equipment
                </Text>
              </Pressable>

              <Pressable
                onPress={() => router.push("/breweries")}
                accessibilityRole="tab"
                accessibilityLabel={
                  myInvitesCount > 0 ? `Breweries (${myInvitesCount} invites)` : "Breweries"
                }
                accessibilityState={{ selected: onBreweries }}
                testID="nav-breweries"
                style={[styles.navLink, onBreweries && styles.navLinkActive]}
              >
                <Text style={[styles.navLinkText, onBreweries && styles.navLinkTextActive]}>
                  {myInvitesCount > 0 ? `Breweries (${myInvitesCount})` : "Breweries"}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => router.push("/settings")}
                accessibilityRole="tab"
                accessibilityLabel="Settings"
                accessibilityState={{ selected: onSettings }}
                testID="nav-settings"
                style={[styles.navLink, onSettings && styles.navLinkActive]}
              >
                <Text style={[styles.navLinkText, onSettings && styles.navLinkTextActive]}>
                  Settings
                </Text>
              </Pressable>

              <Pressable
                onPress={() => router.push(serverUrl ? "/login" : "/connect")}
                accessibilityRole="tab"
                accessibilityLabel={serverUrl ? "Account and server" : "Connect to server"}
                accessibilityState={{ selected: onServer }}
                testID="nav-server"
                style={[styles.navLink, onServer && styles.navLinkActive]}
              >
                <Text style={[styles.navLinkText, onServer && styles.navLinkTextActive]}>
                  {serverUrl ? "Account" : "Server"}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => router.push("/about")}
                accessibilityRole="tab"
                accessibilityLabel="About and licenses"
                accessibilityState={{ selected: onAbout }}
                testID="nav-about"
                style={[styles.navLink, onAbout && styles.navLinkActive]}
              >
                <Text style={[styles.navLinkText, onAbout && styles.navLinkTextActive]}>About</Text>
              </Pressable>
            </View>

            <UnitToggle
              onUnitChange={(next) => {
                if (serverUrl && currentUser.data && currentUser.data.units !== next) {
                  updateMe.mutate({ units: next });
                }
              }}
            />
          </View>
        </View>
        <WorkspaceSwitcher signedIn={Boolean(serverUrl && currentUser.data)} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, isDesktop && styles.contentDesktop]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.container}>
          {title ? (
            <View style={styles.pageHeader}>
              <Text accessibilityRole="header" style={styles.pageTitle}>
                {title}
              </Text>
              {subtitle ? <Text style={styles.pageSubtitle}>{subtitle}</Text> : null}
            </View>
          ) : null}
          {children}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  headerOuter: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerInner: {
    width: "100%",
    maxWidth: 1120,
    alignSelf: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  headerInnerDesktop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.3,
  },
  statusPill: {
    maxWidth: 190,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  statusPillConnected: {
    backgroundColor: colors.successSoft,
  },
  statusPillOffline: {
    backgroundColor: colors.surfaceSubtle,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: "600",
  },
  statusPillTextConnected: {
    color: colors.success,
  },
  statusPillTextOffline: {
    color: colors.textMuted,
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    flexShrink: 1,
    maxWidth: "100%",
    gap: spacing.xs,
  },
  navLink: {
    minHeight: 38,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radii.md,
    justifyContent: "center",
  },
  navLinkActive: {
    backgroundColor: colors.accentSoft,
  },
  navLinkText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textMuted,
  },
  navLinkTextActive: {
    color: colors.accentPressed,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },
  contentDesktop: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  container: {
    width: "100%",
    maxWidth: 1120,
    alignSelf: "center",
    gap: spacing.lg,
  },
  pageHeader: {
    gap: spacing.xs,
  },
  pageTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.4,
  },
  pageSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
  },
});
