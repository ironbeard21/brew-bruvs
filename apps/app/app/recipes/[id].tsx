// SPDX-License-Identifier: AGPL-3.0-or-later
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useCurrentUser } from "../../src/api/auth";
import { useCreateBatch } from "../../src/api/batches";
import { useMoveRecipeToBrewery } from "../../src/api/breweries";
import {
  type RecipeFileFormat,
  type RecipeVersionInput,
  useDeleteRecipe,
  useExportRecipeVersion,
  useForkRecipe,
  useRecipeDetail,
  useSaveRecipeVersion,
} from "../../src/api/recipes";
import { AppShell } from "../../src/components/AppShell";
import { MoveToBreweryBar } from "../../src/components/breweries/OwnerPickerCard";
import { OwnerBadge } from "../../src/components/OwnerBadge";
import { deliverExportedFile } from "../../src/components/recipes/fileIO";
import { RecipeBuilder } from "../../src/components/recipes/RecipeBuilder";
import { Banner, Button, Card } from "../../src/components/ui";
import { useOptionalBrewery } from "../../src/state/brewery";
import { canPerformOnOwner, canWriteBrewery } from "../../src/state/permissions";
import { useServer } from "../../src/state/server";
import { spacing } from "../../src/theme";

export default function RecipeDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const recipeId = typeof params.id === "string" ? params.id : "";

  const { serverUrl, authToken } = useServer();
  const currentUser = useCurrentUser(serverUrl, authToken);
  const { activeBrewery, breweries, writableBreweries } = useOptionalBrewery();
  const detailQuery = useRecipeDetail(serverUrl, authToken, recipeId || null);
  const saveVersion = useSaveRecipeVersion(serverUrl, authToken, recipeId);
  const forkMutation = useForkRecipe(serverUrl, authToken);
  const deleteMutation = useDeleteRecipe(serverUrl, authToken);
  const createBatch = useCreateBatch(serverUrl, authToken);
  const exportMutation = useExportRecipeVersion(serverUrl, authToken);
  const moveRecipe = useMoveRecipeToBrewery(serverUrl, authToken);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [moveNotice, setMoveNotice] = useState<string | null>(null);

  if (!serverUrl) {
    return (
      <AppShell title="Recipe" subtitle="Connect to a server to view recipes.">
        <Card>
          <Banner tone="info" message="Connect to a Brew-Bruvs server to load this recipe." />
          <Button label="Connect to server" onPress={() => router.push("/connect")} />
        </Card>
      </AppShell>
    );
  }

  if (detailQuery.isPending) {
    return (
      <AppShell title="Recipe">
        <Card>
          <Banner tone="info" message="Loading recipe..." />
        </Card>
      </AppShell>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <AppShell title="Recipe">
        <Card>
          <Banner
            tone="error"
            message={
              detailQuery.error instanceof Error
                ? detailQuery.error.message
                : "Recipe could not be loaded."
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

  const recipe = detailQuery.data;
  const userId = currentUser.data?.id ?? null;
  const canEdit = canPerformOnOwner(userId, breweries, recipe.owner, "edit");
  const canDelete = canPerformOnOwner(userId, breweries, recipe.owner, "delete");
  const canShare = canPerformOnOwner(userId, breweries, recipe.owner, "share");
  const canStartBatchInWorkspace = Boolean(
    userId && (!activeBrewery || canWriteBrewery(activeBrewery.role)),
  );
  const canMoveToBrewery =
    recipe.owner.type === "user" && recipe.owner.id === userId && writableBreweries.length > 0;
  const targetBreweryIdForBatch =
    activeBrewery && canWriteBrewery(activeBrewery.role) ? activeBrewery.id : undefined;

  const handleSaveVersion = async (input: RecipeVersionInput) => {
    await saveVersion.mutateAsync(input);
  };

  const handleFork = async () => {
    const forked = await forkMutation.mutateAsync({ recipeId: recipe.id });
    router.push(`/recipes/${forked.id}`);
  };

  const handleDelete = async () => {
    await deleteMutation.mutateAsync(recipe.id);
    router.replace("/recipes");
  };

  const activeVersion = selectedVersion ?? recipe.latestVersion;

  const handleStartBatch = async () => {
    setBatchError(null);
    try {
      const batch = await createBatch.mutateAsync({
        recipeId: recipe.id,
        version: activeVersion,
        ...(targetBreweryIdForBatch ? { breweryId: targetBreweryIdForBatch } : {}),
      });
      router.push(`/batches/${batch.id}`);
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : "Could not start batch.");
    }
  };

  const handleMoveToBrewery = async (breweryId: string) => {
    setMoveNotice(null);
    await moveRecipe.mutateAsync({ recipeId: recipe.id, breweryId });
    const target = writableBreweries.find((b) => b.id === breweryId);
    setMoveNotice(`Moved recipe to ${target?.name ?? "brewery"}.`);
  };

  const handleExport = async (format: RecipeFileFormat) => {
    setExportError(null);
    setExportNotice(null);
    try {
      const exported = await exportMutation.mutateAsync({
        recipeId: recipe.id,
        version: activeVersion,
        format,
      });
      await deliverExportedFile(exported);
      setExportNotice(`Exported ${exported.filename} (${format.toUpperCase()}).`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Could not export recipe.");
    }
  };

  return (
    <AppShell
      title={recipe.name}
      subtitle={`${recipe.beverage.toUpperCase()} · v${recipe.latestVersion} · ${recipe.visibility}`}
    >
      <View style={styles.actionStack}>
        <View style={styles.batchBar}>
          <OwnerBadge owner={recipe.owner} currentUserId={userId} testID="recipe-owner-badge" />
          {canStartBatchInWorkspace ? (
            <Button
              label={
                createBatch.isPending
                  ? "Starting batch..."
                  : activeBrewery
                    ? `Start batch in ${activeBrewery.name}`
                    : "Start batch from this recipe"
              }
              disabled={createBatch.isPending}
              onPress={() => void handleStartBatch()}
              testID="start-batch-button"
            />
          ) : null}
          <Button
            label="Brew sheet"
            variant="secondary"
            onPress={() =>
              router.push(`/recipes/brew-sheet?id=${recipe.id}&version=${activeVersion}`)
            }
            testID="open-brew-sheet-button"
          />
          <Button
            label={exportMutation.isPending ? "Exporting..." : "Export BeerXML"}
            variant="secondary"
            disabled={exportMutation.isPending}
            onPress={() => void handleExport("beerxml")}
            testID="export-beerxml-button"
          />
          <Button
            label={exportMutation.isPending ? "Exporting..." : "Export BeerJSON"}
            variant="secondary"
            disabled={exportMutation.isPending}
            onPress={() => void handleExport("beerjson")}
            testID="export-beerjson-button"
          />
          {canMoveToBrewery ? (
            <MoveToBreweryBar
              itemLabel="recipe"
              writableBreweries={writableBreweries}
              moving={moveRecipe.isPending}
              onMove={handleMoveToBrewery}
              testID="move-recipe"
            />
          ) : null}
        </View>
        {moveNotice ? (
          <Banner tone="success" message={moveNotice} testID="move-recipe-notice" />
        ) : null}
        {batchError ? <Banner tone="error" message={batchError} /> : null}
        {exportNotice ? (
          <Banner tone="success" message={exportNotice} testID="export-success-banner" />
        ) : null}
        {exportError ? <Banner tone="error" message={exportError} /> : null}
      </View>
      <RecipeBuilder
        key={`${recipe.id}-${recipe.latestVersion}`}
        serverUrl={serverUrl}
        authToken={authToken}
        recipe={recipe}
        canEdit={canEdit}
        canDelete={canDelete}
        canShare={canShare}
        activeBreweryId={recipe.owner.type === "brewery" ? recipe.owner.id : null}
        onSaveVersion={handleSaveVersion}
        {...(currentUser.data ? { onFork: handleFork } : {})}
        onDelete={handleDelete}
        onOpenRecipe={(id) => router.push(`/recipes/${id}`)}
        onVersionChange={setSelectedVersion}
        saving={saveVersion.isPending || forkMutation.isPending || deleteMutation.isPending}
      />
    </AppShell>
  );
}

const styles = StyleSheet.create({
  actionStack: {
    gap: spacing.xs,
  },
  batchBar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
});
