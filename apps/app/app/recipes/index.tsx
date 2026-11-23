// SPDX-License-Identifier: AGPL-3.0-or-later
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useCurrentUser } from "../../src/api/auth";
import { type Beverage, useDeleteRecipe, useForkRecipe, useRecipes } from "../../src/api/recipes";
import { AppShell } from "../../src/components/AppShell";
import { Banner, Button, Card, SegmentedControl, TextField } from "../../src/components/ui";
import { useServer } from "../../src/state/server";
import { colors, radii, spacing } from "../../src/theme";

type BeverageFilter = "all" | Beverage;

const BEVERAGE_FILTERS: readonly { value: BeverageFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "beer", label: "Beer" },
  { value: "mead", label: "Mead" },
  { value: "wine", label: "Wine" },
  { value: "cider", label: "Cider" },
];

const SCOPE_OPTIONS = [
  { value: "all", label: "All visible" },
  { value: "mine", label: "Mine only" },
] as const;

export default function RecipeLibraryScreen() {
  const router = useRouter();
  const { serverUrl, authToken } = useServer();
  const currentUser = useCurrentUser(serverUrl, authToken);

  const [query, setQuery] = useState("");
  const [beverage, setBeverage] = useState<BeverageFilter>("all");
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const recipesQuery = useRecipes(serverUrl, authToken, {
    q: query,
    mine: scope === "mine",
    enabled: Boolean(serverUrl),
  });
  const forkMutation = useForkRecipe(serverUrl, authToken);
  const deleteMutation = useDeleteRecipe(serverUrl, authToken);

  const signedIn = Boolean(currentUser.data);
  const allItems = recipesQuery.data ?? [];
  const filteredItems =
    beverage === "all" ? allItems : allItems.filter((r) => r.beverage === beverage);

  const handleFork = async (recipeId: string) => {
    setActionError(null);
    try {
      const forked = await forkMutation.mutateAsync({ recipeId });
      router.push(`/recipes/${forked.id}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not fork recipe.");
    }
  };

  const handleDelete = async (recipeId: string) => {
    setActionError(null);
    try {
      await deleteMutation.mutateAsync(recipeId);
      setConfirmDeleteId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not delete recipe.");
    }
  };

  if (!serverUrl) {
    return (
      <AppShell
        title="Recipe Library"
        subtitle="Connect to a Brew-Bruvs server to create, search, and manage recipes."
      >
        <Card>
          <Banner
            tone="info"
            message="You are currently in offline mode. Connect to a Brew-Bruvs server to access your recipe library."
          />
          <Button label="Connect to server" onPress={() => router.push("/connect")} />
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Recipe Library"
      subtitle="Search, filter, build, fork, and version recipes across beer, mead, wine, and cider."
    >
      <View style={styles.stack}>
        <Card>
          <View style={styles.topActions}>
            <View style={styles.searchFlex}>
              <TextField
                label="Search Recipes"
                value={query}
                onChangeText={setQuery}
                placeholder="Search by recipe name..."
                testID="recipe-library-search"
              />
            </View>
            {signedIn ? (
              <View style={styles.headerButtons}>
                <Button
                  label="Import recipe"
                  variant="secondary"
                  onPress={() => router.push("/recipes/import")}
                  testID="import-recipe-button"
                />
                <Button
                  label="New recipe"
                  onPress={() => router.push("/recipes/new")}
                  testID="new-recipe-button"
                />
              </View>
            ) : (
              <Button
                label="Sign in to create"
                variant="secondary"
                onPress={() => router.push("/login")}
                testID="sign-in-for-recipes-button"
              />
            )}
          </View>

          <View style={styles.filtersRow}>
            <View style={styles.filterGroup}>
              <SegmentedControl
                options={BEVERAGE_FILTERS}
                value={beverage}
                onChange={setBeverage}
                accessibilityLabel="Filter recipes by beverage"
                compact
              />
            </View>
            {signedIn ? (
              <View style={styles.scopeGroup}>
                <SegmentedControl
                  options={SCOPE_OPTIONS}
                  value={scope}
                  onChange={setScope}
                  accessibilityLabel="Filter recipes by ownership"
                  compact
                />
              </View>
            ) : null}
          </View>
        </Card>

        {actionError ? <Banner tone="error" message={actionError} testID="library-error" /> : null}

        {recipesQuery.isPending ? (
          <Card>
            <Banner tone="info" message="Loading recipes..." />
          </Card>
        ) : recipesQuery.isError ? (
          <Card>
            <Banner
              tone="error"
              message={
                recipesQuery.error instanceof Error
                  ? recipesQuery.error.message
                  : "Could not load recipes."
              }
            />
          </Card>
        ) : filteredItems.length === 0 ? (
          <Card>
            <Text style={styles.emptyTitle}>No matching recipes</Text>
            <Text style={styles.muted}>
              {signedIn
                ? "Create your first recipe to start tracking ingredients, live stats, and versions."
                : "Sign in to view your private recipes or create a new one."}
            </Text>
            {signedIn ? (
              <Button
                label="Create recipe"
                onPress={() => router.push("/recipes/new")}
                testID="empty-new-recipe-button"
              />
            ) : null}
          </Card>
        ) : (
          <View style={styles.list} testID="recipe-list">
            {filteredItems.map((recipe) => {
              const isOwner = currentUser.data?.id === recipe.owner.id;
              return (
                <Card key={recipe.id} style={styles.recipeCard}>
                  <Pressable
                    onPress={() => router.push(`/recipes/${recipe.id}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open recipe ${recipe.name}`}
                    testID={`recipe-card-${recipe.id}`}
                    style={styles.cardHeader}
                  >
                    <View style={styles.cardTitleCol}>
                      <Text style={styles.recipeName}>{recipe.name}</Text>
                      <Text style={styles.recipeMeta}>
                        {recipe.beverage.toUpperCase()} · v{recipe.latestVersion} ·{" "}
                        {recipe.visibility}
                        {recipe.credit?.author ? ` · Credit: ${recipe.credit.author}` : ""}
                        {recipe.forkedFrom ? " · Forked" : ""}
                      </Text>
                    </View>
                  </Pressable>

                  <View style={styles.cardActions}>
                    <Button
                      label="Open"
                      variant="secondary"
                      onPress={() => router.push(`/recipes/${recipe.id}`)}
                      accessibilityLabel={`Open ${recipe.name}`}
                      testID={`open-recipe-${recipe.id}`}
                    />
                    {signedIn ? (
                      <Button
                        label="Fork"
                        variant="secondary"
                        disabled={forkMutation.isPending}
                        onPress={() => void handleFork(recipe.id)}
                        accessibilityLabel={`Fork ${recipe.name}`}
                        testID={`fork-recipe-${recipe.id}`}
                      />
                    ) : null}
                    {isOwner ? (
                      confirmDeleteId === recipe.id ? (
                        <Button
                          label="Confirm delete"
                          variant="secondary"
                          disabled={deleteMutation.isPending}
                          onPress={() => void handleDelete(recipe.id)}
                          accessibilityLabel={`Confirm delete ${recipe.name}`}
                          testID={`confirm-delete-recipe-${recipe.id}`}
                        />
                      ) : (
                        <Button
                          label="Delete"
                          variant="ghost"
                          onPress={() => setConfirmDeleteId(recipe.id)}
                          accessibilityLabel={`Delete ${recipe.name}`}
                          testID={`delete-recipe-${recipe.id}`}
                        />
                      )
                    ) : null}
                  </View>
                </Card>
              );
            })}
          </View>
        )}
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  topActions: { flexDirection: "row", alignItems: "flex-end", gap: spacing.md, flexWrap: "wrap" },
  headerButtons: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" },
  searchFlex: { flex: 1, minWidth: 200 },
  filtersRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
  filterGroup: { flexGrow: 1 },
  scopeGroup: {},
  emptyTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  muted: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
  list: { gap: spacing.md },
  recipeCard: { gap: spacing.sm },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitleCol: { flex: 1, gap: 4 },
  recipeName: { fontSize: 17, fontWeight: "700", color: colors.text },
  recipeMeta: {
    fontSize: 13,
    color: colors.textMuted,
    borderRadius: radii.sm,
  },
  cardActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
