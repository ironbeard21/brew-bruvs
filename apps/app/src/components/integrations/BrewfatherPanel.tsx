// SPDX-License-Identifier: AGPL-3.0-or-later
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Brewery } from "../../api/breweries";
import {
  type BrewfatherImport,
  type BrewfatherRecipeDraft,
  type BrewfatherSaveResult,
  usePreviewBrewfather,
  useSaveBrewfather,
} from "../../api/integrations";
import type { CreateRecipeInput } from "../../api/recipes";
import { useThemedStyles } from "../../state/theme";
import { useUnits } from "../../state/units";
import { radii, spacing, type ThemeColors } from "../../theme";
import { formatBatchStatus, formatDateTime, formatVolume } from "../batches/batchFlows";
import { parseNumber, useOnUnitSystemChange } from "../calculators/parseNumber";
import {
  convertDisplayUnitForSystem,
  type DisplayUnit,
  defaultDisplayUnitFor,
  displayUnitToSi,
  formatInventoryAmount,
  formatNumberInput,
  siToDisplayValue,
} from "../inventory/inventoryUnits";
import { RecipeBuilder } from "../recipes/RecipeBuilder";
import { Banner, Button, Card, TextField } from "../ui";

export interface BrewfatherPanelProps {
  serverUrl: string;
  authToken: string | null;
  activeBrewery?: Brewery | null;
  onOpenRecipes?: () => void;
  onOpenBatches?: () => void;
  onOpenInventory?: () => void;
  customFetch?: typeof fetch;
}

interface ReviewRecipeItem {
  ref: string;
  draft: BrewfatherRecipeDraft;
  selected: boolean;
}

interface ReviewBatchItem {
  key: string;
  data: BrewfatherImport["batches"][number];
  selected: boolean;
}

interface ReviewInventoryItem {
  key: string;
  data: BrewfatherImport["inventory"][number];
  displayUnit: DisplayUnit;
  qtyText: string;
  selected: boolean;
}

function summarizeIngredients(draft: BrewfatherRecipeDraft): {
  total: number;
  matched: number;
  freeText: number;
} {
  const all = [
    ...draft.content.fermentables,
    ...draft.content.hops,
    ...draft.content.yeasts,
    ...draft.content.miscs,
  ];
  let matched = 0;
  for (const item of all) {
    if (item.catalogId) matched += 1;
  }
  return { total: all.length, matched, freeText: all.length - matched };
}

function formatCreditSummary(credit: NonNullable<BrewfatherRecipeDraft["credit"]>): string {
  const parts: string[] = [];
  if (credit.author) parts.push(`Author: ${credit.author}`);
  if (credit.site) parts.push(`Site: ${credit.site}`);
  if (credit.sourceUrl) parts.push(credit.sourceUrl);
  return parts.join(" · ");
}

export function BrewfatherPanel({
  serverUrl,
  authToken,
  activeBrewery = null,
  onOpenRecipes,
  onOpenBatches,
  onOpenInventory,
  customFetch,
}: BrewfatherPanelProps) {
  const styles = useThemedStyles(createStyles);
  const { unitSystem } = useUnits();

  const [userId, setUserId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [reviewRecipes, setReviewRecipes] = useState<ReviewRecipeItem[] | null>(null);
  const [reviewBatches, setReviewBatches] = useState<ReviewBatchItem[]>([]);
  const [reviewInventory, setReviewInventory] = useState<ReviewInventoryItem[]>([]);
  const [editingRecipeRef, setEditingRecipeRef] = useState<string | null>(null);
  const [editingSessionKey, setEditingSessionKey] = useState(0);
  const [saveResult, setSaveResult] = useState<BrewfatherSaveResult | null>(null);

  const previewMutation = usePreviewBrewfather(serverUrl, authToken, customFetch);
  const saveMutation = useSaveBrewfather(serverUrl, authToken, customFetch);

  useOnUnitSystemChange(unitSystem, (nextSystem) => {
    setReviewInventory((prev) =>
      prev.map((inv) => {
        const nextUnit = convertDisplayUnitForSystem(inv.displayUnit, nextSystem);
        if (nextUnit === inv.displayUnit) return inv;
        const parsed = parseNumber(inv.qtyText);
        if (parsed === null) return { ...inv, displayUnit: nextUnit };
        const si = displayUnitToSi(parsed, inv.displayUnit);
        return {
          ...inv,
          displayUnit: nextUnit,
          qtyText: formatNumberInput(siToDisplayValue(si.amount, nextUnit), nextUnit),
        };
      }),
    );
  });

  const recipeNameByRef = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of reviewRecipes ?? []) {
      map.set(r.ref, r.draft.name);
    }
    return map;
  }, [reviewRecipes]);

  const handleFetchPreview = async () => {
    setError(null);
    setNotice(null);
    const trimmedUserId = userId.trim();
    const trimmedApiKey = apiKey.trim();
    if (!trimmedUserId || !trimmedApiKey) {
      setError("Enter both your Brewfather User ID and API Key.");
      return;
    }
    try {
      const preview = await previewMutation.mutateAsync({
        userId: trimmedUserId,
        apiKey: trimmedApiKey,
      });
      // Immediately clear credentials from memory (inputs and TanStack Query mutation state).
      setUserId("");
      setApiKey("");
      setSaveResult(null);
      setEditingRecipeRef(null);
      setReviewRecipes(
        preview.recipes.map((r) => ({
          ref: r.ref,
          draft: r.draft,
          selected: true,
        })),
      );
      setReviewBatches(
        preview.batches.map((b, idx) => ({
          key: `bf-batch-${idx}-${b.recipeRef}`,
          data: b,
          selected: true,
        })),
      );
      setReviewInventory(
        preview.inventory.map((inv, idx) => {
          const dispUnit = defaultDisplayUnitFor(inv.quantityUnit, unitSystem, inv.quantity);
          return {
            key: `bf-inv-${idx}-${inv.name}`,
            data: inv,
            displayUnit: dispUnit,
            qtyText: formatNumberInput(siToDisplayValue(inv.quantity, dispUnit), dispUnit),
            selected: true,
          };
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not fetch Brewfather preview.");
    } finally {
      previewMutation.reset();
    }
  };

  const toggleRecipe = (ref: string) => {
    if (!reviewRecipes) return;
    const target = reviewRecipes.find((r) => r.ref === ref);
    if (!target) return;
    const nextSelected = !target.selected;

    setReviewRecipes(
      reviewRecipes.map((r) => (r.ref === ref ? { ...r, selected: nextSelected } : r)),
    );

    if (!nextSelected) {
      let uncheckedBatches = 0;
      const nextBatches = reviewBatches.map((b) => {
        if (b.data.recipeRef === ref && b.selected) {
          uncheckedBatches += 1;
          return { ...b, selected: false };
        }
        return b;
      });
      setReviewBatches(nextBatches);
      setNotice(
        uncheckedBatches > 0
          ? `Unchecked ${uncheckedBatches} linked batch${uncheckedBatches === 1 ? "" : "es"} because their recipe draft was excluded.`
          : null,
      );
    } else {
      setNotice(null);
    }
  };

  const toggleBatch = (key: string) => {
    const target = reviewBatches.find((b) => b.key === key);
    if (!target) return;
    const nextSelected = !target.selected;

    setReviewBatches(
      reviewBatches.map((b) => (b.key === key ? { ...b, selected: nextSelected } : b)),
    );

    if (nextSelected && reviewRecipes) {
      const parent = reviewRecipes.find((r) => r.ref === target.data.recipeRef);
      if (parent && !parent.selected) {
        setReviewRecipes(
          reviewRecipes.map((r) =>
            r.ref === target.data.recipeRef ? { ...r, selected: true } : r,
          ),
        );
        setNotice(
          `Re-selected linked recipe "${parent.draft.name}" so this batch can be imported.`,
        );
        return;
      }
    }
    setNotice(null);
  };

  const toggleInventory = (key: string) => {
    setReviewInventory((prev) =>
      prev.map((inv) => (inv.key === key ? { ...inv, selected: !inv.selected } : inv)),
    );
  };

  const handleApplyRecipeEdit = async (ref: string, input: CreateRecipeInput) => {
    setReviewRecipes((prev) => {
      if (!prev) return prev;
      return prev.map((item) => {
        if (item.ref !== ref) return item;
        const preservedCredit = item.draft.credit ?? input.credit;
        const nextDraft: BrewfatherRecipeDraft = {
          name: input.name,
          beverage: input.beverage,
          batchSizeL: input.batchSizeL,
          ...(input.styleId !== undefined ? { styleId: input.styleId } : {}),
          content: input.content,
          visibility: "private",
          ...(preservedCredit ? { credit: preservedCredit } : {}),
        };
        return { ...item, draft: nextDraft, selected: true };
      });
    });
    setEditingRecipeRef(null);
    setNotice(`Updated draft "${input.name}". Nothing has been saved yet.`);
  };

  const handleSaveImport = async () => {
    if (!reviewRecipes) return;
    setError(null);
    setNotice(null);

    const selectedRecipes = reviewRecipes.filter((r) => r.selected);
    const includedRefs = new Set(selectedRecipes.map((r) => r.ref));
    const selectedBatches = reviewBatches.filter(
      (b) => b.selected && includedRefs.has(b.data.recipeRef),
    );
    const selectedInventory = reviewInventory.filter((inv) => inv.selected);

    if (
      selectedRecipes.length === 0 &&
      selectedBatches.length === 0 &&
      selectedInventory.length === 0
    ) {
      setError("Select at least one recipe, batch, or inventory item to import.");
      return;
    }

    const sanitizedInventory: BrewfatherImport["inventory"] = [];
    for (const inv of selectedInventory) {
      const trimmedName = inv.data.name.trim();
      if (!trimmedName) {
        setError("Every selected inventory item needs a name.");
        return;
      }
      const parsedQty = parseNumber(inv.qtyText);
      if (parsedQty === null || parsedQty < 0) {
        setError(`Enter a valid non-negative quantity for "${trimmedName}".`);
        return;
      }
      const si = displayUnitToSi(parsedQty, inv.displayUnit);
      sanitizedInventory.push({
        ...inv.data,
        name: trimmedName,
        quantity: si.amount,
        quantityUnit: si.unit,
      });
    }

    const payload: BrewfatherImport = {
      recipes: selectedRecipes.map((r) => ({ ref: r.ref, draft: r.draft })),
      batches: selectedBatches.map((b) => ({
        ...b.data,
        ...(b.data.name?.trim() ? { name: b.data.name.trim() } : {}),
      })),
      inventory: sanitizedInventory,
    };

    try {
      const result = await saveMutation.mutateAsync(payload);
      setSaveResult(result);
      setReviewRecipes(null);
      setReviewBatches([]);
      setReviewInventory([]);
      setEditingRecipeRef(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save Brewfather import.");
    }
  };

  const handleReset = () => {
    setReviewRecipes(null);
    setReviewBatches([]);
    setReviewInventory([]);
    setEditingRecipeRef(null);
    setSaveResult(null);
    setError(null);
    setNotice(null);
  };

  // Stage 3: Import complete summary
  if (saveResult) {
    return (
      <Card testID="brewfather-complete-card">
        <Text style={styles.sectionTitle}>Brewfather Import Complete</Text>
        <Banner
          tone="success"
          message={`Imported ${saveResult.recipeIds.length} recipe${saveResult.recipeIds.length === 1 ? "" : "s"}, ${saveResult.batchIds.length} batch${saveResult.batchIds.length === 1 ? "" : "es"}, and ${saveResult.inventoryIds.length} inventory item${saveResult.inventoryIds.length === 1 ? "" : "s"} into your personal library.`}
          testID="brewfather-complete-banner"
        />
        <Text style={styles.muted}>
          All imported recipes start private with source attribution locked. You can move any recipe
          or batch into a shared brewery from its detail page.
        </Text>
        <View style={styles.inlineActions}>
          {onOpenRecipes ? (
            <Button label="Open Recipes" onPress={onOpenRecipes} testID="brewfather-goto-recipes" />
          ) : null}
          {onOpenBatches ? (
            <Button
              label="Open Batches"
              variant="secondary"
              onPress={onOpenBatches}
              testID="brewfather-goto-batches"
            />
          ) : null}
          {onOpenInventory ? (
            <Button
              label="Open Inventory"
              variant="secondary"
              onPress={onOpenInventory}
              testID="brewfather-goto-inventory"
            />
          ) : null}
          <Button
            label="Start another import"
            variant="ghost"
            onPress={handleReset}
            testID="brewfather-import-again"
          />
        </View>
      </Card>
    );
  }

  // Stage 2b: Editing an individual recipe draft with full RecipeBuilder
  if (reviewRecipes && editingRecipeRef) {
    const editingItem = reviewRecipes.find((r) => r.ref === editingRecipeRef);
    if (editingItem) {
      return (
        <View style={styles.stack} testID="brewfather-recipe-editor">
          <Card>
            <View style={styles.reviewHeader}>
              <View style={styles.reviewHeaderText}>
                <Text style={styles.sectionTitle}>
                  Review Recipe Draft: {editingItem.draft.name}
                </Text>
                <Text style={styles.muted}>
                  Adjust any ingredient amount, step, or style below. Tap Apply draft changes to
                  return to your Brewfather import summary before saving.
                </Text>
              </View>
              <Button
                label="Back to import summary"
                variant="secondary"
                onPress={() => setEditingRecipeRef(null)}
                testID="brewfather-editor-back"
              />
            </View>
          </Card>

          <RecipeBuilder
            key={`bf-edit-${editingItem.ref}-${editingSessionKey}`}
            serverUrl={serverUrl}
            authToken={authToken}
            initialImport={editingItem.draft}
            saveLabel="Apply draft changes"
            onSaveNew={(input) => handleApplyRecipeEdit(editingItem.ref, input)}
            {...(customFetch ? { customFetch } : {})}
          />
        </View>
      );
    }
  }

  // Stage 2a: Full Brewfather Draft Review Summary
  if (reviewRecipes) {
    const selectedRecipeCount = reviewRecipes.filter((r) => r.selected).length;
    const selectedBatchCount = reviewBatches.filter((b) => b.selected).length;
    const selectedInvCount = reviewInventory.filter((i) => i.selected).length;
    const totalReadings = reviewBatches
      .filter((b) => b.selected)
      .reduce((acc, b) => acc + b.data.readings.length, 0);
    const totalSelected = selectedRecipeCount + selectedBatchCount + selectedInvCount;

    return (
      <View style={styles.stack} testID="brewfather-review-screen">
        <Card>
          <View style={styles.reviewHeader}>
            <View style={styles.reviewHeaderText}>
              <Text style={styles.sectionTitle}>Review Brewfather Import Draft</Text>
              <Text style={styles.muted}>
                Nothing has been saved yet, and your Brewfather API key has been discarded. Review,
                edit, or uncheck items below before importing into your personal library.
              </Text>
            </View>
            <Button
              label="Discard & start over"
              variant="secondary"
              onPress={handleReset}
              testID="brewfather-discard-button"
            />
          </View>

          <View style={styles.summaryStrip} testID="brewfather-review-counts">
            <View style={styles.summaryPill}>
              <Text style={styles.summaryPillText}>
                {selectedRecipeCount} / {reviewRecipes.length} recipes
              </Text>
            </View>
            <View style={styles.summaryPill}>
              <Text style={styles.summaryPillText}>
                {selectedBatchCount} / {reviewBatches.length} batches ({totalReadings} readings)
              </Text>
            </View>
            <View style={styles.summaryPill}>
              <Text style={styles.summaryPillText}>
                {selectedInvCount} / {reviewInventory.length} inventory items
              </Text>
            </View>
          </View>

          {notice ? (
            <Banner tone="info" message={notice} testID="brewfather-review-notice" />
          ) : null}
          {error ? <Banner tone="error" message={error} testID="brewfather-review-error" /> : null}

          <View style={styles.inlineActions}>
            <Button
              label={
                saveMutation.isPending
                  ? "Saving import..."
                  : `Import ${totalSelected} selected item${totalSelected === 1 ? "" : "s"}`
              }
              disabled={saveMutation.isPending || totalSelected === 0}
              onPress={() => void handleSaveImport()}
              testID="brewfather-save-button"
            />
          </View>
        </Card>

        {/* Recipes Drafts */}
        <Card>
          <Text style={styles.sectionTitle}>Recipes ({reviewRecipes.length})</Text>
          {reviewRecipes.length === 0 ? (
            <Text style={styles.muted}>No recipes were returned from Brewfather.</Text>
          ) : (
            <View style={styles.list} testID="brewfather-recipes-list">
              {reviewRecipes.map((item, idx) => {
                const ing = summarizeIngredients(item.draft);
                return (
                  <View
                    key={item.ref}
                    style={[styles.draftCard, !item.selected && styles.draftCardExcluded]}
                    testID={`brewfather-recipe-card-${idx}`}
                  >
                    <View style={styles.draftRowHeader}>
                      <Pressable
                        onPress={() => toggleRecipe(item.ref)}
                        accessibilityRole="checkbox"
                        accessibilityLabel={`Include recipe ${item.draft.name}`}
                        accessibilityState={{ checked: item.selected }}
                        testID={`brewfather-toggle-recipe-${idx}`}
                        style={[styles.checkBox, item.selected && styles.checkBoxChecked]}
                      >
                        <Text
                          style={[styles.checkBoxText, item.selected && styles.checkBoxTextChecked]}
                        >
                          {item.selected ? "✓" : ""}
                        </Text>
                      </Pressable>

                      <View style={styles.draftMeta}>
                        <View style={styles.badgeRow}>
                          <Text style={styles.draftTitle}>{item.draft.name}</Text>
                          <View style={styles.tagPill}>
                            <Text style={styles.tagPillText}>
                              {item.draft.beverage.toUpperCase()}
                            </Text>
                          </View>
                          <View style={styles.tagPill}>
                            <Text style={styles.tagPillText}>
                              {formatVolume(item.draft.batchSizeL, unitSystem)}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.mutedSmall}>
                          {ing.total} ingredient{ing.total === 1 ? "" : "s"} ({ing.matched}{" "}
                          catalog-matched
                          {ing.freeText > 0 ? `, ${ing.freeText} free text` : ""}) · starts private
                        </Text>
                        {item.draft.credit ? (
                          <Text
                            style={styles.creditText}
                            testID={`brewfather-recipe-credit-${idx}`}
                          >
                            Credit preserved: {formatCreditSummary(item.draft.credit)}
                          </Text>
                        ) : null}
                      </View>

                      <Button
                        label="Review & edit"
                        variant="secondary"
                        onPress={() => {
                          setEditingRecipeRef(item.ref);
                          setEditingSessionKey((k) => k + 1);
                        }}
                        accessibilityLabel={`Review and edit draft ${item.draft.name}`}
                        testID={`brewfather-edit-recipe-${idx}`}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </Card>

        {/* Batches Drafts */}
        <Card>
          <Text style={styles.sectionTitle}>Batches ({reviewBatches.length})</Text>
          {reviewBatches.length === 0 ? (
            <Text style={styles.muted}>No batches were returned from Brewfather.</Text>
          ) : (
            <View style={styles.list} testID="brewfather-batches-list">
              {reviewBatches.map((item, idx) => {
                const linkedRecipeName =
                  recipeNameByRef.get(item.data.recipeRef) ?? item.data.recipeRef;
                return (
                  <View
                    key={item.key}
                    style={[styles.draftCard, !item.selected && styles.draftCardExcluded]}
                    testID={`brewfather-batch-card-${idx}`}
                  >
                    <View style={styles.draftRowHeader}>
                      <Pressable
                        onPress={() => toggleBatch(item.key)}
                        accessibilityRole="checkbox"
                        accessibilityLabel={`Include batch ${item.data.name ?? linkedRecipeName}`}
                        accessibilityState={{ checked: item.selected }}
                        testID={`brewfather-toggle-batch-${idx}`}
                        style={[styles.checkBox, item.selected && styles.checkBoxChecked]}
                      >
                        <Text
                          style={[styles.checkBoxText, item.selected && styles.checkBoxTextChecked]}
                        >
                          {item.selected ? "✓" : ""}
                        </Text>
                      </Pressable>

                      <View style={styles.draftMeta}>
                        <TextField
                          label="Batch Name"
                          value={item.data.name ?? ""}
                          placeholder={linkedRecipeName}
                          onChangeText={(nextName) =>
                            setReviewBatches((prev) =>
                              prev.map((b) =>
                                b.key === item.key
                                  ? { ...b, data: { ...b.data, name: nextName } }
                                  : b,
                              ),
                            )
                          }
                          testID={`brewfather-batch-name-${idx}`}
                        />
                        <View style={styles.badgeRow}>
                          <View style={styles.tagPill}>
                            <Text style={styles.tagPillText}>
                              {formatBatchStatus(item.data.status)}
                            </Text>
                          </View>
                          <View style={styles.tagPill}>
                            <Text style={styles.tagPillText}>
                              {item.data.readings.length} reading
                              {item.data.readings.length === 1 ? "" : "s"}
                            </Text>
                          </View>
                          {item.data.batchSizeL != null ? (
                            <View style={styles.tagPill}>
                              <Text style={styles.tagPillText}>
                                {formatVolume(item.data.batchSizeL, unitSystem)}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={styles.mutedSmall}>
                          Recipe: {linkedRecipeName}
                          {item.data.brewedAt
                            ? ` · Brewed ${formatDateTime(item.data.brewedAt)}`
                            : ""}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </Card>

        {/* Inventory Drafts */}
        <Card>
          <Text style={styles.sectionTitle}>Inventory ({reviewInventory.length})</Text>
          {reviewInventory.length === 0 ? (
            <Text style={styles.muted}>
              No stocked inventory items were returned from Brewfather.
            </Text>
          ) : (
            <View style={styles.list} testID="brewfather-inventory-list">
              {reviewInventory.map((item, idx) => {
                const dispUnit = item.displayUnit;
                return (
                  <View
                    key={item.key}
                    style={[styles.draftCard, !item.selected && styles.draftCardExcluded]}
                    testID={`brewfather-inv-card-${idx}`}
                  >
                    <View style={styles.draftRowHeader}>
                      <Pressable
                        onPress={() => toggleInventory(item.key)}
                        accessibilityRole="checkbox"
                        accessibilityLabel={`Include inventory item ${item.data.name}`}
                        accessibilityState={{ checked: item.selected }}
                        testID={`brewfather-toggle-inv-${idx}`}
                        style={[styles.checkBox, item.selected && styles.checkBoxChecked]}
                      >
                        <Text
                          style={[styles.checkBoxText, item.selected && styles.checkBoxTextChecked]}
                        >
                          {item.selected ? "✓" : ""}
                        </Text>
                      </Pressable>

                      <View style={styles.draftMeta}>
                        <View style={styles.invEditRow}>
                          <View style={styles.invNameCol}>
                            <TextField
                              label="Item Name"
                              value={item.data.name}
                              onChangeText={(nextName) =>
                                setReviewInventory((prev) =>
                                  prev.map((inv) =>
                                    inv.key === item.key
                                      ? { ...inv, data: { ...inv.data, name: nextName } }
                                      : inv,
                                  ),
                                )
                              }
                              testID={`brewfather-inv-name-${idx}`}
                            />
                          </View>
                          <View style={styles.invQtyCol}>
                            <TextField
                              label="Quantity"
                              value={item.qtyText}
                              unit={dispUnit === "floz" ? "fl oz" : dispUnit}
                              keyboardType="decimal-pad"
                              onChangeText={(qtyText) =>
                                setReviewInventory((prev) =>
                                  prev.map((inv) =>
                                    inv.key === item.key ? { ...inv, qtyText } : inv,
                                  ),
                                )
                              }
                              testID={`brewfather-inv-qty-${idx}`}
                            />
                          </View>
                        </View>

                        <View style={styles.badgeRow}>
                          <View
                            style={[
                              styles.tagPill,
                              item.data.catalogId ? styles.matchedPill : undefined,
                            ]}
                          >
                            <Text
                              style={[
                                styles.tagPillText,
                                item.data.catalogId ? styles.matchedPillText : undefined,
                              ]}
                            >
                              {item.data.catalogId ? "Catalog matched" : "Free text"}
                            </Text>
                          </View>
                          <Text style={styles.mutedSmall}>
                            Imported amount:{" "}
                            {formatInventoryAmount(
                              item.data.quantity,
                              item.data.quantityUnit,
                              unitSystem,
                            )}
                            {item.data.alphaAcidPct != null
                              ? ` · ${item.data.alphaAcidPct}% AA`
                              : ""}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </Card>
      </View>
    );
  }

  // Stage 1: One-time credentials input
  return (
    <Card testID="brewfather-credentials-card">
      <Text style={styles.sectionTitle}>Import from Brewfather</Text>
      <Text style={styles.muted}>
        Pull your recipes, batches (including fermentation readings), and stocked inventory from
        Brewfather into an editable review draft.
      </Text>

      <Banner
        tone="info"
        message="Your Brewfather User ID and API Key are used once to fetch a preview and are never stored or logged by Brew-Bruvs."
        testID="brewfather-key-privacy-banner"
      />

      {activeBrewery ? (
        <Text style={styles.mutedSmall}>
          Note: Brewfather imports are added to your personal library as private items. You can move
          recipes or batches into {activeBrewery.name} afterwards.
        </Text>
      ) : null}

      <TextField
        label="Brewfather User ID"
        value={userId}
        onChangeText={setUserId}
        placeholder="Found in Brewfather → Settings → API"
        autoCapitalize="none"
        autoCorrect={false}
        testID="brewfather-user-id-input"
      />

      <TextField
        label="Brewfather API Key (one-time)"
        value={apiKey}
        onChangeText={setApiKey}
        placeholder="Paste generated API key"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        helper="Enable Read Recipes, Read Batches, and Read Inventory when generating the key in Brewfather."
        testID="brewfather-api-key-input"
      />

      {error ? <Banner tone="error" message={error} testID="brewfather-error" /> : null}

      <Button
        label={previewMutation.isPending ? "Fetching from Brewfather..." : "Fetch preview draft"}
        disabled={previewMutation.isPending}
        onPress={() => void handleFetchPreview()}
        testID="brewfather-preview-button"
      />
    </Card>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    stack: { gap: spacing.lg },
    sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
    muted: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
    mutedSmall: { fontSize: 12, lineHeight: 17, color: colors.textMuted },
    reviewHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    reviewHeaderText: { flex: 1, minWidth: 200, gap: 4 },
    summaryStrip: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
    summaryPill: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radii.pill,
      backgroundColor: colors.accentSoft,
    },
    summaryPillText: { fontSize: 12, fontWeight: "700", color: colors.accentPressed },
    inlineActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
    list: { gap: spacing.sm },
    draftCard: {
      padding: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.surfaceSubtle,
      borderWidth: 1,
      borderColor: colors.border,
      gap: spacing.sm,
    },
    draftCardExcluded: {
      opacity: 0.6,
    },
    draftRowHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
      flexWrap: "wrap",
    },
    checkBox: {
      width: 24,
      height: 24,
      borderRadius: radii.sm,
      borderWidth: 2,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 2,
    },
    checkBoxChecked: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    checkBoxText: { fontSize: 14, fontWeight: "800", color: colors.surface },
    checkBoxTextChecked: { color: colors.surface },
    draftMeta: { flex: 1, minWidth: 180, gap: spacing.xs },
    draftTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
    badgeRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
    tagPill: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radii.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    tagPillText: { fontSize: 11, fontWeight: "700", color: colors.textMuted },
    matchedPill: { backgroundColor: colors.successSoft, borderColor: colors.success },
    matchedPillText: { color: colors.success },
    creditText: { fontSize: 12, fontWeight: "600", color: colors.accentPressed },
    invEditRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    invNameCol: { flex: 2, minWidth: 160 },
    invQtyCol: { flex: 1, minWidth: 120 },
  });
