// SPDX-License-Identifier: AGPL-3.0-or-later
import { useRouter } from "expo-router";
import { useCurrentUser } from "../../src/api/auth";
import { AppShell } from "../../src/components/AppShell";
import { BreweryHub } from "../../src/components/breweries/BreweryHub";
import { Banner, Button, Card } from "../../src/components/ui";
import { useServer } from "../../src/state/server";

export default function BreweriesScreen() {
  const router = useRouter();
  const { serverUrl, authToken } = useServer();
  const currentUser = useCurrentUser(serverUrl, authToken);

  if (!serverUrl) {
    return (
      <AppShell
        title="Breweries"
        subtitle="Connect to a Brew-Bruvs server to create and share breweries."
      >
        <Card>
          <Banner
            tone="info"
            message="You are currently in offline mode. Connect to a Brew-Bruvs server to create or join breweries."
          />
          <Button label="Connect to server" onPress={() => router.push("/connect")} />
        </Card>
      </AppShell>
    );
  }

  if (currentUser.isPending) {
    return (
      <AppShell title="Breweries">
        <Card>
          <Banner tone="info" message="Checking your session..." />
        </Card>
      </AppShell>
    );
  }

  if (!currentUser.data) {
    return (
      <AppShell title="Breweries" subtitle="Sign in to create or join a shared brewery.">
        <Card>
          <Banner
            tone="info"
            message="Sign in on your connected server to manage breweries and invites."
          />
          <Button label="Sign in" onPress={() => router.push("/login")} />
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Breweries"
      subtitle="Switch between your personal workspace and shared breweries, manage roles, and accept invites."
    >
      <BreweryHub
        serverUrl={serverUrl}
        authToken={authToken}
        currentUserId={currentUser.data.id}
        onOpenBrewery={(id) => router.push(`/breweries/${id}`)}
        onCreatedBrewery={(created) => router.push(`/breweries/${created.id}`)}
        onAcceptedInvite={(joined) => router.push(`/breweries/${joined.id}`)}
      />
    </AppShell>
  );
}
