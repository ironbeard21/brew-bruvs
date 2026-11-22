// SPDX-License-Identifier: AGPL-3.0-or-later
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useCurrentUser } from "../../src/api/auth";
import { useCreateBatch } from "../../src/api/batches";
import {
  type RecipeVersionInput,
  useDeleteRecipe,
  useForkRecipe,
  useRecipeDetail,
  useSaveRecipeVersion,
} from "../../src/api/recipes";
import { AppShell } from "../../src/components/AppShell";
import { RecipeBuilder } from "../../src/components/recipes/RecipeBuilder";
import { Banner, Button, Card } from "../../src/components/ui";
import { useServer } from "../../src/state/server";
import { spacing } from "../../src/theme";

export default function RecipeDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const recipeId = typeof params.id === "string" ? params.id : "";

  const { serverUrl, authToken } = useServer();
  const currentUser = useCurrentUser(serverUrl, authToken);
  const detailQuery = useRecipeDetail(serverUrl, authToken, recipeId || null);
  const saveVersion = useSaveRecipeVersion(serverUrl, authToken, recipeId);
  const forkMutation = useForkRecipe(serverUrl, authToken);
  const deleteMutation = useDeleteRecipe(serverUrl, authToken);
  const createBatch = useCreateBatch(serverUrl, authToken);
  const [batchError, setBatchError] = useState<string | null>(null);

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
  const canManage = Boolean(
    currentUser.data && (currentUser.data.id === recipe.owner.id || currentUser.data.isAdmin),
  );

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

  const handleStartBatch = async () => {
    setBatchError(null);
    try {
      const batch = await createBatch.mutateAsync({
        recipeId: recipe.id,
        version: recipe.latestVersion,
      });
      router.push(`/batches/${batch.id}`);
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : "Could not start batch.");
    }
  };

  return (
    <AppShell
      title={recipe.name}
      subtitle={`${recipe.beverage.toUpperCase()} · v${recipe.latestVersion} · ${recipe.visibility}`}
    >
      {currentUser.data ? (
        <View style={styles.batchBar}>
          <Button
            label={createBatch.isPending ? "Starting batch..." : "Start batch from this recipe"}
            disabled={createBatch.isPending}
            onPress={() => void handleStartBatch()}
            testID="start-batch-button"
          />
          {batchError ? <Banner tone="error" message={batchError} /> : null}
        </View>
      ) : null}
      <RecipeBuilder
        key={`${recipe.id}-${recipe.latestVersion}`}
        serverUrl={serverUrl}
        authToken={authToken}
        recipe={recipe}
        canManage={canManage}
        onSaveVersion={handleSaveVersion}
        {...(currentUser.data ? { onFork: handleFork } : {})}
        onDelete={handleDelete}
        onOpenRecipe={(id) => router.push(`/recipes/${id}`)}
        saving={saveVersion.isPending || forkMutation.isPending || deleteMutation.isPending}
      />
    </AppShell>
  );
}

const styles = StyleSheet.create({
  batchBar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
});
