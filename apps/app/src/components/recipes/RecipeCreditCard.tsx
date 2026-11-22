// SPDX-License-Identifier: AGPL-3.0-or-later
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { Recipe } from "../../api/recipes";
import { colors, radii } from "../../theme";
import { Card } from "../ui";

export interface RecipeCreditCardProps {
  recipe: Recipe;
  onOpenOriginal?: (recipeId: string) => void;
}

/**
 * Displays permanent, non-editable attribution for imported and forked recipes
 * (AGENTS.md Rule 5: imported recipes keep their credit and it can never be removed).
 */
export function RecipeCreditCard({ recipe, onOpenOriginal }: RecipeCreditCardProps) {
  if (!recipe.credit && !recipe.forkedFrom) {
    return null;
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.heading}>Attribution (permanent)</Text>

      {recipe.credit ? (
        <View style={styles.section} testID="recipe-credit-box">
          {recipe.credit.author ? (
            <Text style={styles.line}>
              <Text style={styles.label}>Author: </Text>
              {recipe.credit.author}
            </Text>
          ) : null}
          {recipe.credit.site ? (
            <Text style={styles.line}>
              <Text style={styles.label}>Site: </Text>
              {recipe.credit.site}
            </Text>
          ) : null}
          {recipe.credit.sourceUrl ? (
            <Pressable
              onPress={() => {
                if (recipe.credit?.sourceUrl) void Linking.openURL(recipe.credit.sourceUrl);
              }}
              accessibilityRole="link"
              accessibilityLabel={`Open source recipe at ${recipe.credit.sourceUrl}`}
            >
              <Text style={styles.link}>Source: {recipe.credit.sourceUrl}</Text>
            </Pressable>
          ) : null}
          {recipe.credit.license ? (
            <Text style={styles.line}>
              <Text style={styles.label}>License: </Text>
              {recipe.credit.license}
            </Text>
          ) : null}
          {recipe.credit.importedAt ? (
            <Text style={styles.meta}>
              Imported on {new Date(recipe.credit.importedAt).toLocaleDateString()}
            </Text>
          ) : null}
        </View>
      ) : null}

      {recipe.forkedFrom ? (
        <View style={styles.section} testID="recipe-forked-from-box">
          <Text style={styles.line}>
            <Text style={styles.label}>Forked from: </Text>
            {recipe.forkedFrom.uri}
          </Text>
          {recipe.forkedFrom.recipeId && onOpenOriginal ? (
            <Pressable
              onPress={() => {
                if (recipe.forkedFrom?.recipeId) onOpenOriginal(recipe.forkedFrom.recipeId);
              }}
              accessibilityRole="link"
              accessibilityLabel="Open original recipe"
              testID="open-fork-source-link"
            >
              <Text style={styles.link}>View original recipe</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.borderStrong,
  },
  heading: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.accentPressed,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  section: {
    gap: 4,
    paddingTop: 2,
  },
  label: {
    fontWeight: "700",
    color: colors.text,
  },
  line: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },
  link: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.accent,
    textDecorationLine: "underline",
  },
  meta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
    borderRadius: radii.sm,
  },
});
