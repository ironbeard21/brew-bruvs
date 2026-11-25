// SPDX-License-Identifier: AGPL-3.0-or-later
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useCurrentUser } from "../../src/api/auth";
import { useBreweryDetail } from "../../src/api/breweries";
import { AppShell } from "../../src/components/AppShell";
import { BreweryDetailView } from "../../src/components/breweries/BreweryDetailView";
import { Banner, Button, Card } from "../../src/components/ui";
import { useServer } from "../../src/state/server";

export default function BreweryDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const breweryId = typeof params.id === "string" ? params.id : "";

  const { serverUrl, authToken } = useServer();
  const currentUser = useCurrentUser(serverUrl, authToken);
  const detailQuery = useBreweryDetail(serverUrl, authToken, breweryId || null);

  if (!serverUrl) {
    return (
      <AppShell title="Brewery">
        <Card>
          <Banner tone="info" message="Connect to a Brew-Bruvs server to view this brewery." />
          <Button label="Connect to server" onPress={() => router.push("/connect")} />
        </Card>
      </AppShell>
    );
  }

  if (currentUser.isPending || detailQuery.isPending) {
    return (
      <AppShell title="Brewery">
        <Card>
          <Banner tone="info" message="Loading brewery..." />
        </Card>
      </AppShell>
    );
  }

  if (!currentUser.data) {
    return (
      <AppShell title="Brewery">
        <Card>
          <Banner tone="info" message="Sign in to view this brewery." />
          <Button label="Sign in" onPress={() => router.push("/login")} />
        </Card>
      </AppShell>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <AppShell title="Brewery">
        <Card>
          <Banner
            tone="error"
            message={
              detailQuery.error instanceof Error
                ? detailQuery.error.message
                : "Brewery could not be loaded."
            }
          />
          <Button
            label="Back to breweries"
            variant="secondary"
            onPress={() => router.push("/breweries")}
          />
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={detailQuery.data.name}
      subtitle="Members, roles, invites, and shared workspace settings."
    >
      <View style={styles.backRow}>
        <Button
          label="← All breweries"
          variant="ghost"
          onPress={() => router.push("/breweries")}
          testID="back-to-breweries-button"
        />
      </View>
      <BreweryDetailView
        serverUrl={serverUrl}
        authToken={authToken}
        currentUserId={currentUser.data.id}
        detail={detailQuery.data}
        onLeftOrDeleted={() => router.replace("/breweries")}
      />
    </AppShell>
  );
}

const styles = StyleSheet.create({
  backRow: { alignSelf: "flex-start" },
});
