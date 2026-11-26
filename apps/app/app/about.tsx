// SPDX-License-Identifier: AGPL-3.0-or-later
import { useRouter } from "expo-router";
import { useCurrentUser } from "../src/api/auth";
import { useCatalogSources } from "../src/api/catalog";
import { useServerHealth } from "../src/api/health";
import { AppShell } from "../src/components/AppShell";
import { AboutPanel } from "../src/components/settings/AboutPanel";
import { useServer } from "../src/state/server";

export default function AboutScreen() {
  const router = useRouter();
  const { serverUrl, authToken } = useServer();
  const currentUser = useCurrentUser(serverUrl, authToken);
  const serverHealth = useServerHealth(serverUrl);
  const sourcesQuery = useCatalogSources(
    serverUrl,
    authToken,
    Boolean(serverUrl && currentUser.data),
  );

  return (
    <AppShell
      title="About Brew-Bruvs"
      subtitle="Software license, source code, and open-data catalog attribution."
    >
      <AboutPanel
        sourceUrl={serverHealth.data?.sourceUrl}
        attribution={sourcesQuery.data ?? null}
        loading={sourcesQuery.isLoading}
        onOpenPrivacyPolicy={() => router.push("/privacy")}
        error={
          sourcesQuery.isError
            ? sourcesQuery.error instanceof Error
              ? sourcesQuery.error.message
              : "Could not reach /api/catalog/sources"
            : null
        }
      />
    </AppShell>
  );
}
