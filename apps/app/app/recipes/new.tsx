// SPDX-License-Identifier: AGPL-3.0-or-later
import { useRouter } from "expo-router";
import { useCurrentUser } from "../../src/api/auth";
import { type CreateRecipeInput, useCreateRecipe } from "../../src/api/recipes";
import { AppShell } from "../../src/components/AppShell";
import { RecipeBuilder } from "../../src/components/recipes/RecipeBuilder";
import { Banner, Button, Card } from "../../src/components/ui";
import { useServer } from "../../src/state/server";

export default function NewRecipeScreen() {
  const router = useRouter();
  const { serverUrl, authToken } = useServer();
  const currentUser = useCurrentUser(serverUrl, authToken);
  const createRecipe = useCreateRecipe(serverUrl, authToken);

  if (!serverUrl) {
    return (
      <AppShell title="New Recipe" subtitle="Connect to a server first to save recipes.">
        <Card>
          <Banner
            tone="info"
            message="Connect to a Brew-Bruvs server to create and save recipes."
          />
          <Button label="Connect to server" onPress={() => router.push("/connect")} />
        </Card>
      </AppShell>
    );
  }

  if (!currentUser.isPending && !currentUser.data) {
    return (
      <AppShell title="New Recipe" subtitle="Sign in to create and save recipes.">
        <Card>
          <Banner
            tone="info"
            message="Sign in on your connected server before creating a recipe."
          />
          <Button label="Go to sign in" onPress={() => router.push("/login")} />
        </Card>
      </AppShell>
    );
  }

  const handleSaveNew = async (input: CreateRecipeInput) => {
    const created = await createRecipe.mutateAsync(input);
    router.replace(`/recipes/${created.id}`);
  };

  return (
    <AppShell
      title="New Recipe"
      subtitle="Build your recipe with catalog or custom ingredients and watch live stats update against your chosen style."
    >
      <RecipeBuilder
        serverUrl={serverUrl}
        authToken={authToken}
        onSaveNew={handleSaveNew}
        saving={createRecipe.isPending}
      />
    </AppShell>
  );
}
