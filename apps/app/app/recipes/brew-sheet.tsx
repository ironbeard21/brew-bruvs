// SPDX-License-Identifier: AGPL-3.0-or-later
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { type CatalogStyle, useCatalogItem } from "../../src/api/catalog";
import {
  type RecipeFileFormat,
  useExportRecipeVersion,
  useRecipeDetail,
  useRecipeVersion,
} from "../../src/api/recipes";
import { AppShell } from "../../src/components/AppShell";
import { BrewSheetView } from "../../src/components/recipes/BrewSheetView";
import { deliverExportedFile } from "../../src/components/recipes/fileIO";
import { Banner, Button, Card } from "../../src/components/ui";
import { useServer } from "../../src/state/server";

export default function BrewSheetScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; version?: string }>();
  const recipeId = typeof params.id === "string" ? params.id : "";
  const requestedVersion =
    typeof params.version === "string" && /^\d+$/.test(params.version)
      ? Number(params.version)
      : null;

  const { serverUrl, authToken } = useServer();
  const detailQuery = useRecipeDetail(serverUrl, authToken, recipeId || null);
  const versionQuery = useRecipeVersion(
    serverUrl,
    authToken,
    recipeId || null,
    requestedVersion && detailQuery.data && requestedVersion !== detailQuery.data.latestVersion
      ? requestedVersion
      : null,
  );
  const exportMutation = useExportRecipeVersion(serverUrl, authToken);

  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const recipe = detailQuery.data;
  const version = versionQuery.data ?? recipe?.version ?? null;
  const styleQuery = useCatalogItem(serverUrl, authToken, "styles", version?.styleId ?? null);
  const style: CatalogStyle | null =
    styleQuery.data && styleQuery.data.catalog === "styles" ? styleQuery.data : null;

  if (!serverUrl) {
    return (
      <AppShell title="Brew Sheet">
        <Card>
          <Banner tone="info" message="Connect to a Brew-Bruvs server to open this brew sheet." />
          <Button label="Connect to server" onPress={() => router.push("/connect")} />
        </Card>
      </AppShell>
    );
  }

  if (detailQuery.isPending || versionQuery.isLoading) {
    return (
      <AppShell title="Brew Sheet">
        <Card>
          <Banner tone="info" message="Loading brew sheet..." />
        </Card>
      </AppShell>
    );
  }

  if (detailQuery.isError || !recipe || !version) {
    return (
      <AppShell title="Brew Sheet">
        <Card>
          <Banner
            tone="error"
            message={
              detailQuery.error instanceof Error
                ? detailQuery.error.message
                : "Recipe could not be loaded for brew sheet."
            }
          />
          <Button
            label="Back to library"
            variant="secondary"
            onPress={() => router.push("/recipes")}
          />
        </Card>
      </AppShell>
    );
  }

  const handleExport = async (format: RecipeFileFormat) => {
    setExportError(null);
    setExportNotice(null);
    try {
      const exported = await exportMutation.mutateAsync({
        recipeId: recipe.id,
        version: version.version,
        format,
      });
      await deliverExportedFile(exported);
      setExportNotice(`Exported ${exported.filename} (${format.toUpperCase()}).`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Could not export recipe.");
    }
  };

  return (
    <AppShell>
      <BrewSheetView
        recipe={recipe}
        version={version}
        style={style}
        onBack={() => router.push(`/recipes/${recipe.id}`)}
        onExport={handleExport}
        exporting={exportMutation.isPending}
        exportNotice={exportNotice}
        exportError={exportError}
      />
    </AppShell>
  );
}
