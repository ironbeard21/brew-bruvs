// SPDX-License-Identifier: AGPL-3.0-or-later
import { useRouter } from "expo-router";
import { useCurrentUser } from "../../src/api/auth";
import { type CreateRecipeInput, useCreateRecipe } from "../../src/api/recipes";
import { AppShell } from "../../src/components/AppShell";
import { RecipeImportFlow } from "../../src/components/recipes/RecipeImportFlow";
import { Banner, Button, Card } from "../../src/components/ui";
import { useServer } from "../../src/state/server";

export default function ImportRecipeScreen() {
  const router = useRouter();
  const { serverUrl, authToken } = useServer();
  const currentUser = useCurrentUser(serverUrl, authToken);
  const createRecipe = useCreateRecipe(serverUrl, authToken);

  if (!serverUrl) {
    return (
      <AppShell title="Import Recipe" subtitle="Connect to a server to import recipes.">
        <Card>
          <Banner tone="info" message="Connect to a Brew-Bruvs server to import recipes." />
          <Button label="Connect to server" onPress={() => router.push("/connect")} />
        </Card>
      </AppShell>
    );
  }

  if (!currentUser.isPending && !currentUser.data) {
    return (
      <AppShell title="Import Recipe" subtitle="Sign in to import a recipe into your library.">
        <Card>
          <Banner tone="info" message="Sign in to import BeerXML, BeerJSON, or URL recipes." />
          <Button label="Sign in" onPress={() => router.push("/login")} />
        </Card>
      </AppShell>
    );
  }

  const handleSaveImported = async (input: CreateRecipeInput) => {
    const created = await createRecipe.mutateAsync(input);
    router.replace(`/recipes/${created.id}`);
  };

  return (
    <AppShell
      title="Import Recipe"
      subtitle="Import BeerXML, BeerJSON, or a public recipe URL, review every amount, and keep permanent credit."
    >
      <RecipeImportFlow
        serverUrl={serverUrl}
        authToken={authToken}
        onSaveImported={handleSaveImported}
        saving={createRecipe.isPending}
      />
    </AppShell>
  );
}
