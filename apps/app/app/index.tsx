// SPDX-License-Identifier: AGPL-3.0-or-later
import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useServer } from "../src/state/server";
import { colors } from "../src/theme";

export default function IndexScreen() {
  const { hydrated, serverUrl, offlineMode } = useServer();

  if (!hydrated) {
    return (
      <View style={styles.loading} accessibilityLabel="Loading Brew-Bruvs">
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (serverUrl) {
    return <Redirect href="/login" />;
  }

  if (offlineMode) {
    return <Redirect href="/calculators" />;
  }

  return <Redirect href="/connect" />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.canvas,
  },
});
