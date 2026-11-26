// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Recipe } from "../../api/recipes";
import { SharePanel } from "../sharing/ShareDialog";
import { Card } from "../ui";

export interface RecipeSharingCardProps {
  serverUrl: string | null;
  authToken: string | null;
  recipe: Recipe;
  canManage: boolean;
  customFetch?: typeof fetch;
}

export function RecipeSharingCard({
  serverUrl,
  authToken,
  recipe,
  canManage,
  customFetch,
}: RecipeSharingCardProps) {
  return (
    <Card>
      <SharePanel
        serverUrl={serverUrl}
        authToken={authToken}
        resourceType="recipe"
        resourceId={recipe.id}
        visibility={recipe.visibility}
        owner={recipe.owner}
        canManage={canManage}
        hasCredit={Boolean(recipe.credit)}
        publicSharingBlocked={recipe.publicSharingBlocked}
        showTitle
        {...(customFetch ? { customFetch } : {})}
      />
    </Card>
  );
}
