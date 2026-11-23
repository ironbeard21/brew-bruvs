// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCurrentUser } from "../src/api/auth";
import { useCatalogSources } from "../src/api/catalog";
import { AppShell } from "../src/components/AppShell";
import { AboutPanel } from "../src/components/settings/AboutPanel";
import { useServer } from "../src/state/server";

export default function AboutScreen() {
  const { serverUrl, authToken } = useServer();
  const currentUser = useCurrentUser(serverUrl, authToken);
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
        attribution={sourcesQuery.data ?? null}
        loading={sourcesQuery.isLoading}
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
