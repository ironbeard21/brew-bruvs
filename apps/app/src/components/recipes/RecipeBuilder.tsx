// SPDX-License-Identifier: AGPL-3.0-or-later
import { units } from "@brew-bruvs/brew-math";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { type CatalogItem, type CatalogStyle, useCatalogItem } from "../../api/catalog";
import {
  type Beverage,
  type CreateRecipeInput,
  type EquipmentProfile,
  fetchRecipeVersion,
  type RecipeDetail,
  type RecipeVersionInput,
  useCreateEquipmentProfile,
  useEquipmentProfiles,
  useRecipeVersions,
  useScaleRecipe,
} from "../../api/recipes";
import { useUnits } from "../../state/units";
import { colors, DESKTOP_BREAKPOINT, radii, spacing } from "../../theme";
import { formatFixed, parseNumber, useOnUnitSystemChange } from "../calculators/parseNumber";
import { Banner, Button, Card, SegmentedControl, TextField } from "../ui";
import { CatalogPicker } from "./CatalogPicker";
import {
  computeLiveRecipeStats,
  convertDraftUnits,
  createBlankDraft,
  draftFromVersion,
  draftToVersionInput,
  type FermentableKind,
  type FermentableUse,
  type FermentationStage,
  type HopUse,
  type MashStepType,
  type MiscKind,
  type MiscUse,
  newLineKey,
  type RecipeDraft,
  type YeastForm,
} from "./liveStats";
import { RecipeCreditCard } from "./RecipeCreditCard";
import { RecipeSharingCard } from "./RecipeSharingCard";
import { StatsPanel } from "./StatsPanel";

const BEVERAGE_OPTIONS: readonly { value: Beverage; label: string }[] = [
  { value: "beer", label: "Beer" },
  { value: "mead", label: "Mead" },
  { value: "wine", label: "Wine" },
  { value: "cider", label: "Cider" },
];

const FERM_KIND_OPTIONS: readonly { value: FermentableKind; label: string }[] = [
  { value: "grain", label: "Grain" },
  { value: "extract", label: "Extract" },
  { value: "sugar", label: "Sugar" },
  { value: "honey", label: "Honey" },
  { value: "juice", label: "Juice" },
  { value: "fruit", label: "Fruit" },
  { value: "adjunct", label: "Adjunct" },
];

const FERM_USE_OPTIONS: readonly { value: FermentableUse; label: string }[] = [
  { value: "mash", label: "Mash" },
  { value: "steep", label: "Steep" },
  { value: "boil", label: "Boil" },
  { value: "fermentation", label: "Ferm." },
  { value: "package", label: "Package" },
];

const HOP_USE_OPTIONS: readonly { value: HopUse; label: string }[] = [
  { value: "boil", label: "Boil" },
  { value: "whirlpool", label: "Whirlpool" },
  { value: "dry_hop", label: "Dry Hop" },
  { value: "first_wort", label: "First Wort" },
  { value: "mash", label: "Mash" },
];

const YEAST_FORM_OPTIONS: readonly { value: YeastForm; label: string }[] = [
  { value: "dry", label: "Dry" },
  { value: "liquid", label: "Liquid" },
  { value: "slurry", label: "Slurry" },
  { value: "culture", label: "Culture" },
];

const MISC_KIND_OPTIONS: readonly { value: MiscKind; label: string }[] = [
  { value: "nutrient", label: "Nutrient" },
  { value: "sulfite", label: "Sulfite" },
  { value: "acid", label: "Acid" },
  { value: "stabilizer", label: "Stabilizer" },
  { value: "spice", label: "Spice" },
  { value: "fining", label: "Fining" },
  { value: "water_agent", label: "Water" },
  { value: "oak", label: "Oak" },
  { value: "other", label: "Other" },
];

const MISC_USE_OPTIONS: readonly { value: MiscUse; label: string }[] = [
  { value: "mash", label: "Mash" },
  { value: "boil", label: "Boil" },
  { value: "primary", label: "Primary" },
  { value: "secondary", label: "Secondary" },
  { value: "bulk_aging", label: "Aging" },
  { value: "bottling", label: "Bottling" },
];

const MASH_TYPE_OPTIONS: readonly { value: MashStepType; label: string }[] = [
  { value: "infusion", label: "Infusion" },
  { value: "temperature", label: "Temp" },
  { value: "decoction", label: "Decoction" },
];

const FERM_STAGE_OPTIONS: readonly { value: FermentationStage; label: string }[] = [
  { value: "primary", label: "Primary" },
  { value: "secondary", label: "Secondary" },
  { value: "conditioning", label: "Cond." },
  { value: "bulk_aging", label: "Bulk Age" },
  { value: "bottle_aging", label: "Bottle Age" },
];

function inferFermentableKind(raw: string | null | undefined): FermentableKind {
  const lower = (raw ?? "").toLowerCase();
  if (lower.includes("honey")) return "honey";
  if (lower.includes("juice") || lower.includes("must") || lower.includes("cider")) return "juice";
  if (lower.includes("fruit")) return "fruit";
  if (lower.includes("extract") || lower.includes("lme") || lower.includes("dme")) return "extract";
  if (lower.includes("sugar")) return "sugar";
  if (lower.includes("adjunct")) return "adjunct";
  return "grain";
}

function inferMiscKind(raw: string | null | undefined): MiscKind {
  const lower = (raw ?? "").toLowerCase();
  if (lower.includes("nutrient")) return "nutrient";
  if (lower.includes("sulfite") || lower.includes("metabisulfite")) return "sulfite";
  if (lower.includes("acid")) return "acid";
  if (lower.includes("sorbate") || lower.includes("stabiliz")) return "stabilizer";
  if (lower.includes("fining")) return "fining";
  if (lower.includes("water")) return "water_agent";
  if (lower.includes("spice")) return "spice";
  if (lower.includes("herb")) return "herb";
  if (lower.includes("oak")) return "oak";
  return "other";
}

export interface RecipeBuilderProps {
  serverUrl: string | null;
  authToken: string | null;
  recipe?: RecipeDetail | null;
  canManage?: boolean;
  onSaveNew?: (input: CreateRecipeInput) => Promise<void>;
  onSaveVersion?: (input: RecipeVersionInput) => Promise<void>;
  onFork?: () => Promise<void>;
  onDelete?: () => Promise<void>;
  onOpenRecipe?: (recipeId: string) => void;
  saving?: boolean;
  customFetch?: typeof fetch;
}

export function RecipeBuilder({
  serverUrl,
  authToken,
  recipe = null,
  canManage = true,
  onSaveNew,
  onSaveVersion,
  onFork,
  onDelete,
  onOpenRecipe,
  saving = false,
  customFetch,
}: RecipeBuilderProps) {
  const { unitSystem } = useUnits();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [draft, setDraft] = useState<RecipeDraft>(() =>
    recipe ? draftFromVersion(recipe.version, unitSystem) : createBlankDraft(unitSystem),
  );
  const [selectedStyle, setSelectedStyle] = useState<CatalogStyle | null>(null);
  const [viewingVersion, setViewingVersion] = useState<number | null>(
    recipe ? recipe.version.version : null,
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Inline equipment profile creation state
  const [showNewProfile, setShowNewProfile] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileBatchText, setProfileBatchText] = useState(unitSystem === "us" ? "5.0" : "18.9");
  const [profileEffText, setProfileEffText] = useState("72");
  const [profileError, setProfileError] = useState<string | null>(null);

  useOnUnitSystemChange(unitSystem, (next) => {
    setDraft((prev) => convertDraftUnits(prev, next));
  });

  // Load style metadata when editing an existing recipe with a styleId
  const styleQuery = useCatalogItem(
    serverUrl,
    authToken,
    "styles",
    selectedStyle?.id === draft.styleId ? null : draft.styleId,
    customFetch,
  );

  useEffect(() => {
    if (styleQuery.data && styleQuery.data.catalog === "styles") {
      setSelectedStyle(styleQuery.data);
    }
  }, [styleQuery.data]);

  const versionsQuery = useRecipeVersions(serverUrl, authToken, recipe?.id ?? null, customFetch);
  const profilesQuery = useEquipmentProfiles(serverUrl, authToken, Boolean(serverUrl), customFetch);
  const createProfile = useCreateEquipmentProfile(serverUrl, authToken, customFetch);
  const scaleMutation = useScaleRecipe(serverUrl, authToken, recipe?.id ?? "", customFetch);

  const profiles = profilesQuery.data ?? [];
  const activeProfile: EquipmentProfile | null =
    profiles.find((p) => p.id === draft.equipmentProfileId) ?? null;

  const liveStats = computeLiveRecipeStats(
    draft,
    unitSystem,
    draft.styleId ? selectedStyle : null,
    activeProfile,
  );

  const volUnit = unitSystem === "us" ? "US gal" : "L";
  const massUnit = unitSystem === "us" ? "lb" : "kg";
  const smallUnit = unitSystem === "us" ? "oz" : "g";
  const tempUnit = unitSystem === "us" ? "°F" : "°C";
  const colorUnit = unitSystem === "us" ? "°L" : "EBC";

  const handleLoadVersion = async (versionNum: number) => {
    if (!serverUrl || !recipe) return;
    setFormError(null);
    setSaveMessage(null);
    try {
      const loaded = await fetchRecipeVersion(
        serverUrl,
        authToken,
        recipe.id,
        versionNum,
        customFetch,
      );
      setDraft(draftFromVersion(loaded, unitSystem));
      setViewingVersion(loaded.version);
      if (loaded.styleId !== selectedStyle?.id) {
        setSelectedStyle(null);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : `Could not load v${versionNum}.`);
    }
  };

  const handleSelectProfile = async (profile: EquipmentProfile, scaleExisting: boolean) => {
    setFormError(null);
    if (scaleExisting && recipe) {
      try {
        const scaled = await scaleMutation.mutateAsync(profile.id);
        setDraft(
          draftFromVersion(
            {
              ...recipe.version,
              batchSizeL: scaled.batchSizeL,
              equipmentProfileId: scaled.equipmentProfileId,
              content: scaled.content,
            },
            unitSystem,
          ),
        );
        setSaveMessage(`Scaled draft to ${profile.name}. Save a new version to keep it.`);
        return;
      } catch (err) {
        setFormError(err instanceof Error ? err.message : "Could not scale recipe.");
        return;
      }
    }

    setDraft((prev) => ({
      ...prev,
      equipmentProfileId: profile.id,
      ...(profile.batchSizeL != null
        ? {
            batchSizeText:
              unitSystem === "us"
                ? formatFixed(units.litersToGallons(profile.batchSizeL), 2)
                : formatFixed(profile.batchSizeL, 2),
          }
        : {}),
      ...(profile.efficiencyPct != null ? { efficiencyText: String(profile.efficiencyPct) } : {}),
    }));
  };

  const handleCreateProfile = async () => {
    setProfileError(null);
    const batchVal = parseNumber(profileBatchText);
    const effVal = parseNumber(profileEffText);
    if (!profileName.trim() || batchVal === null || batchVal <= 0) {
      setProfileError("Enter a profile name and positive batch size.");
      return;
    }
    try {
      const created = await createProfile.mutateAsync({
        name: profileName.trim(),
        batchSizeL: unitSystem === "us" ? units.gallonsToLiters(batchVal) : batchVal,
        ...(effVal !== null && effVal > 0 && effVal <= 100 ? { efficiencyPct: effVal } : {}),
      });
      setProfileName("");
      setShowNewProfile(false);
      await handleSelectProfile(created, false);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Could not create equipment profile.");
    }
  };

  const handleCatalogAdd = (
    section: "fermentables" | "hops" | "yeasts" | "miscs" | "styles",
    item: CatalogItem,
  ) => {
    if (section === "styles" && item.catalog === "styles") {
      setSelectedStyle(item);
      setDraft((prev) => ({ ...prev, styleId: item.id }));
      return;
    }
    if (section === "fermentables" && item.catalog === "fermentables") {
      const kind = inferFermentableKind(item.fermentableType ?? item.category);
      const isJuice = kind === "juice";
      const colorText =
        item.colorEbc != null
          ? unitSystem === "us"
            ? formatFixed(units.srmToLovibond(units.ebcToSrm(item.colorEbc)), 1)
            : formatFixed(item.colorEbc, 1)
          : "";
      setDraft((prev) => ({
        ...prev,
        fermentables: [
          ...prev.fermentables,
          {
            key: newLineKey("ferm"),
            name: item.name,
            catalogId: item.id,
            kind,
            measure: isJuice ? "volume" : "weight",
            amountText: isJuice
              ? unitSystem === "us"
                ? "5.0"
                : "18.9"
              : unitSystem === "us"
                ? "1.0"
                : "0.5",
            use: kind === "grain" || kind === "adjunct" ? "mash" : "fermentation",
            potentialSgText: item.potentialSg != null ? String(item.potentialSg) : "1.036",
            colorText,
            dayOffsetText: "",
          },
        ],
      }));
      return;
    }
    if (section === "hops" && item.catalog === "hops") {
      setDraft((prev) => ({
        ...prev,
        hops: [
          ...prev.hops,
          {
            key: newLineKey("hop"),
            name: item.name,
            catalogId: item.id,
            amountText: unitSystem === "us" ? "1.0" : "28",
            alphaAcidText: item.alphaAcidPct != null ? String(item.alphaAcidPct) : "6.0",
            use: "boil",
            timeMinText: "60",
            daysText: "",
          },
        ],
      }));
      return;
    }
    if (section === "yeasts" && item.catalog === "yeasts") {
      const avgAtt =
        item.attenuationMinPct != null && item.attenuationMaxPct != null
          ? (item.attenuationMinPct + item.attenuationMaxPct) / 2
          : (item.attenuationMinPct ?? item.attenuationMaxPct ?? 75);
      const rawForm = (item.form ?? "").toLowerCase();
      const form: YeastForm =
        rawForm === "liquid" || rawForm === "slurry" || rawForm === "culture" ? rawForm : "dry";
      setDraft((prev) => ({
        ...prev,
        yeasts: [
          ...prev.yeasts,
          {
            key: newLineKey("yeast"),
            name: item.name,
            catalogId: item.id,
            form,
            packsText: "1",
            attenuationText: formatFixed(avgAtt, 0),
          },
        ],
      }));
      return;
    }
    if (section === "miscs" && item.catalog === "miscs") {
      setDraft((prev) => ({
        ...prev,
        miscs: [
          ...prev.miscs,
          {
            key: newLineKey("misc"),
            name: item.name,
            catalogId: item.id,
            kind: inferMiscKind(item.miscType ?? item.category),
            amountMode: "mass",
            amountText: unitSystem === "us" ? "0.25" : "5",
            use: prev.beverage === "beer" ? "boil" : "primary",
            timeMinText: prev.beverage === "beer" ? "15" : "",
            dayOffsetText: prev.beverage === "beer" ? "" : "1",
          },
        ],
      }));
    }
  };

  const handleSave = async () => {
    setFormError(null);
    setSaveMessage(null);
    const built = draftToVersionInput(draft, unitSystem);
    if (!built.ok) {
      setFormError(built.error);
      return;
    }
    try {
      if (recipe && onSaveVersion) {
        await onSaveVersion(built.input);
        setSaveMessage("Saved as a new recipe version.");
      } else if (onSaveNew) {
        await onSaveNew({
          ...built.input,
          beverage: draft.beverage,
          visibility: "private",
        });
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save recipe.");
    }
  };

  const sidebarCards = (
    <View style={isDesktop ? styles.sideColumn : styles.stack}>
      <StatsPanel live={liveStats} style={draft.styleId ? selectedStyle : null} />

      {recipe ? (
        <RecipeCreditCard
          recipe={recipe}
          {...(onOpenRecipe ? { onOpenOriginal: onOpenRecipe } : {})}
        />
      ) : null}

      {recipe ? (
        <Card>
          <Text style={styles.sectionTitle}>Version History</Text>
          <Text style={styles.muted}>
            Saving creates a new immutable version. Tap any version to inspect it.
          </Text>
          <View style={styles.versionList}>
            {(
              versionsQuery.data ?? [
                {
                  id: recipe.version.id,
                  version: recipe.version.version,
                  name: recipe.version.name,
                  createdAt: recipe.version.createdAt,
                },
              ]
            ).map((v) => {
              const active = v.version === viewingVersion;
              return (
                <Pressable
                  key={v.id}
                  onPress={() => void handleLoadVersion(v.version)}
                  accessibilityRole="button"
                  accessibilityLabel={`Load version ${v.version}: ${v.name}`}
                  accessibilityState={{ selected: active }}
                  testID={`version-item-${v.version}`}
                  style={[styles.versionRow, active && styles.versionRowActive]}
                >
                  <Text style={[styles.versionTitle, active && styles.versionTitleActive]}>
                    v{v.version} · {v.name}
                  </Text>
                  <Text style={styles.versionMeta}>
                    {new Date(v.createdAt).toLocaleDateString()}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>
      ) : null}

      {recipe ? (
        <RecipeSharingCard
          serverUrl={serverUrl}
          authToken={authToken}
          recipe={recipe}
          canManage={canManage}
          {...(customFetch ? { customFetch } : {})}
        />
      ) : null}
    </View>
  );

  return (
    <View style={[styles.workspace, isDesktop && styles.workspaceDesktop]}>
      {!isDesktop ? sidebarCards : null}

      <View style={isDesktop ? styles.mainColumn : styles.stack}>
        {/* Basics, Style, Equipment */}
        <Card>
          <Text style={styles.sectionTitle}>Recipe Details</Text>
          <TextField
            label="Recipe Name"
            value={draft.name}
            onChangeText={(name) => setDraft((p) => ({ ...p, name }))}
            placeholder="House Pale Ale"
            autoCapitalize="words"
            testID="recipe-name-input"
          />

          {!recipe ? (
            <SegmentedControl
              options={BEVERAGE_OPTIONS}
              value={draft.beverage}
              onChange={(beverage) =>
                setDraft((p) => ({
                  ...p,
                  beverage,
                  efficiencyText: beverage === "beer" ? "72" : "100",
                }))
              }
              accessibilityLabel="Beverage type"
            />
          ) : (
            <View style={styles.badgeRow}>
              <Text style={styles.badgeText}>
                Beverage: {recipe.beverage.toUpperCase()} · Latest: v{recipe.latestVersion}
              </Text>
            </View>
          )}

          <View style={styles.rowWrap}>
            <View style={styles.flexField}>
              <TextField
                label="Batch Size"
                value={draft.batchSizeText}
                onChangeText={(batchSizeText) => setDraft((p) => ({ ...p, batchSizeText }))}
                unit={volUnit}
                keyboardType="decimal-pad"
                testID="recipe-batch-size-input"
              />
            </View>
            <View style={styles.flexField}>
              <TextField
                label="Efficiency"
                value={draft.efficiencyText}
                onChangeText={(efficiencyText) => setDraft((p) => ({ ...p, efficiencyText }))}
                unit="%"
                keyboardType="decimal-pad"
                testID="recipe-efficiency-input"
              />
            </View>
            <View style={styles.flexField}>
              <TextField
                label="Boil Time"
                value={draft.boilTimeText}
                onChangeText={(boilTimeText) => setDraft((p) => ({ ...p, boilTimeText }))}
                unit="min"
                keyboardType="decimal-pad"
                testID="recipe-boil-time-input"
              />
            </View>
          </View>

          {/* Style Picker */}
          <View style={styles.subSection}>
            {selectedStyle && draft.styleId ? (
              <View style={styles.selectedPillRow} testID="selected-style-pill">
                <View style={styles.flexOne}>
                  <Text style={styles.selectedPillTitle}>
                    Style: {selectedStyle.styleId} · {selectedStyle.name}
                  </Text>
                  <Text style={styles.muted}>{selectedStyle.styleGuide}</Text>
                </View>
                <Button
                  label="Clear"
                  variant="ghost"
                  onPress={() => {
                    setSelectedStyle(null);
                    setDraft((p) => ({ ...p, styleId: null }));
                  }}
                  accessibilityLabel="Clear selected style"
                />
              </View>
            ) : null}

            <CatalogPicker
              serverUrl={serverUrl}
              authToken={authToken}
              catalog="styles"
              label="Style (BJCP / Catalog)"
              placeholder="Search styles (e.g. American Pale Ale, 18B, Traditional Mead)"
              onSelect={(item) => handleCatalogAdd("styles", item)}
              testIDPrefix="style"
              {...(customFetch ? { customFetch } : {})}
            />
          </View>

          {/* Equipment Profile Picker */}
          <View style={styles.subSection}>
            <View style={styles.itemHeader}>
              <Text style={styles.subTitle}>Equipment Profile</Text>
              <Button
                label={showNewProfile ? "Cancel" : "New profile"}
                variant="ghost"
                onPress={() => setShowNewProfile((v) => !v)}
                testID="toggle-new-equipment-profile"
              />
            </View>

            {profiles.length > 0 ? (
              <View style={styles.profileRow}>
                {profiles.map((prof) => {
                  const selected = prof.id === draft.equipmentProfileId;
                  return (
                    <View key={prof.id} style={styles.profileChipWrap}>
                      <Pressable
                        onPress={() => void handleSelectProfile(prof, false)}
                        accessibilityRole="button"
                        accessibilityLabel={`Use equipment profile ${prof.name}`}
                        accessibilityState={{ selected }}
                        testID={`equipment-profile-${prof.id}`}
                        style={[styles.profileChip, selected && styles.profileChipSelected]}
                      >
                        <Text
                          style={[
                            styles.profileChipText,
                            selected && styles.profileChipTextSelected,
                          ]}
                        >
                          {prof.name}
                        </Text>
                      </Pressable>
                      {recipe && !selected ? (
                        <Button
                          label="Scale"
                          variant="ghost"
                          disabled={scaleMutation.isPending}
                          onPress={() => void handleSelectProfile(prof, true)}
                          accessibilityLabel={`Scale recipe to ${prof.name}`}
                        />
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.muted}>No saved equipment profiles yet.</Text>
            )}

            {showNewProfile ? (
              <View style={styles.lineCard}>
                <TextField
                  label="Profile Name"
                  value={profileName}
                  onChangeText={setProfileName}
                  placeholder="5 gal All-Grain Kettle"
                  autoCapitalize="words"
                  testID="new-profile-name-input"
                />
                <View style={styles.rowWrap}>
                  <View style={styles.flexField}>
                    <TextField
                      label="Batch Size"
                      value={profileBatchText}
                      onChangeText={setProfileBatchText}
                      unit={volUnit}
                      keyboardType="decimal-pad"
                      testID="new-profile-batch-input"
                    />
                  </View>
                  <View style={styles.flexField}>
                    <TextField
                      label="Efficiency"
                      value={profileEffText}
                      onChangeText={setProfileEffText}
                      unit="%"
                      keyboardType="decimal-pad"
                      testID="new-profile-eff-input"
                    />
                  </View>
                </View>
                {profileError ? <Banner tone="error" message={profileError} /> : null}
                <Button
                  label={createProfile.isPending ? "Saving..." : "Save equipment profile"}
                  variant="secondary"
                  disabled={createProfile.isPending}
                  onPress={() => void handleCreateProfile()}
                  testID="save-new-profile-button"
                />
              </View>
            ) : null}
          </View>
        </Card>

        {/* Fermentables (Grains, Extracts, Honey, Juice, Fruit) */}
        <Card>
          <Text style={styles.sectionTitle}>Fermentables</Text>
          <Text style={styles.muted}>
            Search catalog grains, extracts, sugars, honey, or juices — or add a free-text line.
          </Text>

          <CatalogPicker
            serverUrl={serverUrl}
            authToken={authToken}
            catalog="fermentables"
            label="Add Fermentable"
            placeholder="Search Pale Malt, Crystal 60L, Wildflower Honey, Apple Juice..."
            onSelect={(item) => handleCatalogAdd("fermentables", item)}
            onAddCustom={(customName) => {
              const isMeadWine = draft.beverage !== "beer";
              setDraft((p) => ({
                ...p,
                fermentables: [
                  ...p.fermentables,
                  {
                    key: newLineKey("ferm"),
                    name: customName || (isMeadWine ? "Wildflower Honey" : "Custom Malt"),
                    kind:
                      draft.beverage === "mead"
                        ? "honey"
                        : draft.beverage === "beer"
                          ? "grain"
                          : "juice",
                    measure:
                      draft.beverage === "wine" || draft.beverage === "cider" ? "volume" : "weight",
                    amountText: unitSystem === "us" ? "5.0" : "2.0",
                    use: draft.beverage === "beer" ? "mash" : "fermentation",
                    potentialSgText:
                      draft.beverage === "mead"
                        ? "1.035"
                        : draft.beverage === "beer"
                          ? "1.036"
                          : "1.050",
                    colorText: draft.beverage === "beer" ? "2" : "0",
                    dayOffsetText: "",
                  },
                ],
              }));
            }}
            testIDPrefix="fermentable"
            {...(customFetch ? { customFetch } : {})}
          />

          {draft.fermentables.map((f, idx) => (
            <View key={f.key} style={styles.lineCard} testID={`fermentable-row-${idx}`}>
              <View style={styles.itemHeader}>
                <Text style={styles.lineLabel}>
                  {f.catalogId ? "Catalog" : "Custom"} #{idx + 1}
                </Text>
                <Button
                  label="Remove"
                  variant="ghost"
                  onPress={() =>
                    setDraft((p) => ({
                      ...p,
                      fermentables: p.fermentables.filter((x) => x.key !== f.key),
                    }))
                  }
                  accessibilityLabel={`Remove fermentable ${f.name || idx + 1}`}
                />
              </View>
              <TextField
                label="Name"
                value={f.name}
                onChangeText={(name) =>
                  setDraft((p) => ({
                    ...p,
                    fermentables: p.fermentables.map((x) => (x.key === f.key ? { ...x, name } : x)),
                  }))
                }
                testID={`ferm-${idx}-name`}
              />
              <SegmentedControl
                options={FERM_KIND_OPTIONS}
                value={f.kind}
                onChange={(kind) =>
                  setDraft((p) => ({
                    ...p,
                    fermentables: p.fermentables.map((x) =>
                      x.key === f.key
                        ? {
                            ...x,
                            kind,
                            measure: kind === "juice" ? "volume" : "weight",
                            use: kind === "grain" || kind === "adjunct" ? "mash" : "fermentation",
                          }
                        : x,
                    ),
                  }))
                }
                accessibilityLabel={`Fermentable ${idx + 1} kind`}
                compact
              />
              <View style={styles.rowWrap}>
                <View style={styles.flexField}>
                  <TextField
                    label={f.measure === "volume" ? "Volume" : "Weight"}
                    value={f.amountText}
                    onChangeText={(amountText) =>
                      setDraft((p) => ({
                        ...p,
                        fermentables: p.fermentables.map((x) =>
                          x.key === f.key ? { ...x, amountText } : x,
                        ),
                      }))
                    }
                    unit={f.measure === "volume" ? volUnit : massUnit}
                    keyboardType="decimal-pad"
                    testID={`ferm-${idx}-amount`}
                  />
                </View>
                <View style={styles.flexField}>
                  <TextField
                    label={f.measure === "volume" ? "Juice SG" : "Potential"}
                    value={f.potentialSgText}
                    onChangeText={(potentialSgText) =>
                      setDraft((p) => ({
                        ...p,
                        fermentables: p.fermentables.map((x) =>
                          x.key === f.key ? { ...x, potentialSgText } : x,
                        ),
                      }))
                    }
                    unit="SG"
                    keyboardType="decimal-pad"
                    testID={`ferm-${idx}-potential`}
                  />
                </View>
                {f.measure === "weight" ? (
                  <View style={styles.flexField}>
                    <TextField
                      label="Color"
                      value={f.colorText}
                      onChangeText={(colorText) =>
                        setDraft((p) => ({
                          ...p,
                          fermentables: p.fermentables.map((x) =>
                            x.key === f.key ? { ...x, colorText } : x,
                          ),
                        }))
                      }
                      unit={colorUnit}
                      keyboardType="decimal-pad"
                      testID={`ferm-${idx}-color`}
                    />
                  </View>
                ) : null}
              </View>
              <SegmentedControl
                options={FERM_USE_OPTIONS}
                value={f.use}
                onChange={(use) =>
                  setDraft((p) => ({
                    ...p,
                    fermentables: p.fermentables.map((x) => (x.key === f.key ? { ...x, use } : x)),
                  }))
                }
                accessibilityLabel={`Fermentable ${idx + 1} stage`}
                compact
              />
            </View>
          ))}
        </Card>

        {/* Hops */}
        <Card>
          <Text style={styles.sectionTitle}>Hops</Text>
          <CatalogPicker
            serverUrl={serverUrl}
            authToken={authToken}
            catalog="hops"
            label="Add Hop"
            placeholder="Search Cascade, Citra, Zeus / Columbus..."
            onSelect={(item) => handleCatalogAdd("hops", item)}
            onAddCustom={(customName) =>
              setDraft((p) => ({
                ...p,
                hops: [
                  ...p.hops,
                  {
                    key: newLineKey("hop"),
                    name: customName || "Custom Hop",
                    amountText: unitSystem === "us" ? "1.0" : "28",
                    alphaAcidText: "6.0",
                    use: "boil",
                    timeMinText: "60",
                    daysText: "",
                  },
                ],
              }))
            }
            testIDPrefix="hop"
            {...(customFetch ? { customFetch } : {})}
          />

          {draft.hops.map((h, idx) => (
            <View key={h.key} style={styles.lineCard} testID={`hop-row-${idx}`}>
              <View style={styles.itemHeader}>
                <Text style={styles.lineLabel}>
                  {h.catalogId ? "Catalog" : "Custom"} #{idx + 1}
                </Text>
                <Button
                  label="Remove"
                  variant="ghost"
                  onPress={() =>
                    setDraft((p) => ({ ...p, hops: p.hops.filter((x) => x.key !== h.key) }))
                  }
                  accessibilityLabel={`Remove hop ${h.name || idx + 1}`}
                />
              </View>
              <TextField
                label="Name"
                value={h.name}
                onChangeText={(name) =>
                  setDraft((p) => ({
                    ...p,
                    hops: p.hops.map((x) => (x.key === h.key ? { ...x, name } : x)),
                  }))
                }
                testID={`hop-${idx}-name`}
              />
              <SegmentedControl
                options={HOP_USE_OPTIONS}
                value={h.use}
                onChange={(use) =>
                  setDraft((p) => ({
                    ...p,
                    hops: p.hops.map((x) => (x.key === h.key ? { ...x, use } : x)),
                  }))
                }
                accessibilityLabel={`Hop ${idx + 1} use`}
                compact
              />
              <View style={styles.rowWrap}>
                <View style={styles.flexField}>
                  <TextField
                    label="Weight"
                    value={h.amountText}
                    onChangeText={(amountText) =>
                      setDraft((p) => ({
                        ...p,
                        hops: p.hops.map((x) => (x.key === h.key ? { ...x, amountText } : x)),
                      }))
                    }
                    unit={smallUnit}
                    keyboardType="decimal-pad"
                    testID={`hop-${idx}-amount`}
                  />
                </View>
                <View style={styles.flexField}>
                  <TextField
                    label="Alpha Acid"
                    value={h.alphaAcidText}
                    onChangeText={(alphaAcidText) =>
                      setDraft((p) => ({
                        ...p,
                        hops: p.hops.map((x) => (x.key === h.key ? { ...x, alphaAcidText } : x)),
                      }))
                    }
                    unit="%"
                    keyboardType="decimal-pad"
                    testID={`hop-${idx}-aa`}
                  />
                </View>
                {h.use === "dry_hop" ? (
                  <View style={styles.flexField}>
                    <TextField
                      label="Days"
                      value={h.daysText}
                      onChangeText={(daysText) =>
                        setDraft((p) => ({
                          ...p,
                          hops: p.hops.map((x) => (x.key === h.key ? { ...x, daysText } : x)),
                        }))
                      }
                      unit="days"
                      keyboardType="decimal-pad"
                      testID={`hop-${idx}-days`}
                    />
                  </View>
                ) : (
                  <View style={styles.flexField}>
                    <TextField
                      label="Time"
                      value={h.timeMinText}
                      onChangeText={(timeMinText) =>
                        setDraft((p) => ({
                          ...p,
                          hops: p.hops.map((x) => (x.key === h.key ? { ...x, timeMinText } : x)),
                        }))
                      }
                      unit="min"
                      keyboardType="decimal-pad"
                      testID={`hop-${idx}-time`}
                    />
                  </View>
                )}
              </View>
            </View>
          ))}
        </Card>

        {/* Yeasts */}
        <Card>
          <Text style={styles.sectionTitle}>Yeast</Text>
          <CatalogPicker
            serverUrl={serverUrl}
            authToken={authToken}
            catalog="yeasts"
            label="Add Yeast"
            placeholder="Search US-05, EC-1118, 71B..."
            onSelect={(item) => handleCatalogAdd("yeasts", item)}
            onAddCustom={(customName) =>
              setDraft((p) => ({
                ...p,
                yeasts: [
                  ...p.yeasts,
                  {
                    key: newLineKey("yeast"),
                    name: customName || "Custom Yeast",
                    form: "dry",
                    packsText: "1",
                    attenuationText: "75",
                  },
                ],
              }))
            }
            testIDPrefix="yeast"
            {...(customFetch ? { customFetch } : {})}
          />

          {draft.yeasts.map((y, idx) => (
            <View key={y.key} style={styles.lineCard} testID={`yeast-row-${idx}`}>
              <View style={styles.itemHeader}>
                <Text style={styles.lineLabel}>
                  {y.catalogId ? "Catalog" : "Custom"} #{idx + 1}
                </Text>
                <Button
                  label="Remove"
                  variant="ghost"
                  onPress={() =>
                    setDraft((p) => ({ ...p, yeasts: p.yeasts.filter((x) => x.key !== y.key) }))
                  }
                  accessibilityLabel={`Remove yeast ${y.name || idx + 1}`}
                />
              </View>
              <TextField
                label="Name"
                value={y.name}
                onChangeText={(name) =>
                  setDraft((p) => ({
                    ...p,
                    yeasts: p.yeasts.map((x) => (x.key === y.key ? { ...x, name } : x)),
                  }))
                }
                testID={`yeast-${idx}-name`}
              />
              <SegmentedControl
                options={YEAST_FORM_OPTIONS}
                value={y.form}
                onChange={(form) =>
                  setDraft((p) => ({
                    ...p,
                    yeasts: p.yeasts.map((x) => (x.key === y.key ? { ...x, form } : x)),
                  }))
                }
                accessibilityLabel={`Yeast ${idx + 1} form`}
                compact
              />
              <View style={styles.rowWrap}>
                <View style={styles.flexField}>
                  <TextField
                    label="Packs"
                    value={y.packsText}
                    onChangeText={(packsText) =>
                      setDraft((p) => ({
                        ...p,
                        yeasts: p.yeasts.map((x) => (x.key === y.key ? { ...x, packsText } : x)),
                      }))
                    }
                    keyboardType="decimal-pad"
                    testID={`yeast-${idx}-packs`}
                  />
                </View>
                <View style={styles.flexField}>
                  <TextField
                    label="Attenuation"
                    value={y.attenuationText}
                    onChangeText={(attenuationText) =>
                      setDraft((p) => ({
                        ...p,
                        yeasts: p.yeasts.map((x) =>
                          x.key === y.key ? { ...x, attenuationText } : x,
                        ),
                      }))
                    }
                    unit="%"
                    keyboardType="decimal-pad"
                    testID={`yeast-${idx}-attenuation`}
                  />
                </View>
              </View>
            </View>
          ))}
        </Card>

        {/* Miscs & Mead/Wine/Cider Additions */}
        <Card>
          <Text style={styles.sectionTitle}>Additions, Nutrients, Sulfite & Miscs</Text>
          <Text style={styles.muted}>
            Add yeast nutrients, potassium metabisulfite, sorbate, acid, spices, finings, or oak.
          </Text>

          <CatalogPicker
            serverUrl={serverUrl}
            authToken={authToken}
            catalog="miscs"
            label="Add Misc / Addition"
            placeholder="Search Fermaid, Campden, Irish Moss, Tartaric Acid..."
            onSelect={(item) => handleCatalogAdd("miscs", item)}
            onAddCustom={(customName) =>
              setDraft((p) => ({
                ...p,
                miscs: [
                  ...p.miscs,
                  {
                    key: newLineKey("misc"),
                    name: customName || "Yeast Nutrient",
                    kind: p.beverage === "beer" ? "fining" : "nutrient",
                    amountMode: "mass",
                    amountText: unitSystem === "us" ? "0.2" : "5",
                    use: p.beverage === "beer" ? "boil" : "primary",
                    timeMinText: p.beverage === "beer" ? "15" : "",
                    dayOffsetText: p.beverage === "beer" ? "" : "1",
                  },
                ],
              }))
            }
            testIDPrefix="misc"
            {...(customFetch ? { customFetch } : {})}
          />

          {draft.miscs.map((m, idx) => (
            <View key={m.key} style={styles.lineCard} testID={`misc-row-${idx}`}>
              <View style={styles.itemHeader}>
                <Text style={styles.lineLabel}>Addition #{idx + 1}</Text>
                <Button
                  label="Remove"
                  variant="ghost"
                  onPress={() =>
                    setDraft((p) => ({ ...p, miscs: p.miscs.filter((x) => x.key !== m.key) }))
                  }
                  accessibilityLabel={`Remove addition ${m.name || idx + 1}`}
                />
              </View>
              <TextField
                label="Name"
                value={m.name}
                onChangeText={(name) =>
                  setDraft((p) => ({
                    ...p,
                    miscs: p.miscs.map((x) => (x.key === m.key ? { ...x, name } : x)),
                  }))
                }
                testID={`misc-${idx}-name`}
              />
              <SegmentedControl
                options={MISC_KIND_OPTIONS}
                value={m.kind}
                onChange={(kind) =>
                  setDraft((p) => ({
                    ...p,
                    miscs: p.miscs.map((x) => (x.key === m.key ? { ...x, kind } : x)),
                  }))
                }
                accessibilityLabel={`Addition ${idx + 1} kind`}
                compact
              />
              <SegmentedControl
                options={MISC_USE_OPTIONS}
                value={m.use}
                onChange={(use) =>
                  setDraft((p) => ({
                    ...p,
                    miscs: p.miscs.map((x) => (x.key === m.key ? { ...x, use } : x)),
                  }))
                }
                accessibilityLabel={`Addition ${idx + 1} stage`}
                compact
              />
              <View style={styles.rowWrap}>
                <View style={styles.flexField}>
                  <TextField
                    label="Amount"
                    value={m.amountText}
                    onChangeText={(amountText) =>
                      setDraft((p) => ({
                        ...p,
                        miscs: p.miscs.map((x) => (x.key === m.key ? { ...x, amountText } : x)),
                      }))
                    }
                    unit={
                      m.amountMode === "count"
                        ? "qty"
                        : m.amountMode === "volume"
                          ? volUnit
                          : smallUnit
                    }
                    keyboardType="decimal-pad"
                    testID={`misc-${idx}-amount`}
                  />
                </View>
                <View style={styles.flexField}>
                  <TextField
                    label="Day Offset"
                    value={m.dayOffsetText}
                    onChangeText={(dayOffsetText) =>
                      setDraft((p) => ({
                        ...p,
                        miscs: p.miscs.map((x) => (x.key === m.key ? { ...x, dayOffsetText } : x)),
                      }))
                    }
                    unit="day"
                    placeholder="Optional"
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
            </View>
          ))}
        </Card>

        {/* Mash & Fermentation Steps */}
        <Card>
          <View style={styles.itemHeader}>
            <Text style={styles.sectionTitle}>Mash Steps</Text>
            <Button
              label="Add mash step"
              variant="secondary"
              onPress={() =>
                setDraft((p) => ({
                  ...p,
                  mash: [
                    ...p.mash,
                    {
                      key: newLineKey("mash"),
                      name: "Saccharification",
                      type: "infusion",
                      tempText: unitSystem === "us" ? "152" : "66.7",
                      timeMinText: "60",
                      infuseText: "",
                    },
                  ],
                }))
              }
              testID="add-mash-step"
            />
          </View>

          {draft.mash.map((s, idx) => (
            <View key={s.key} style={styles.lineCard}>
              <View style={styles.itemHeader}>
                <Text style={styles.lineLabel}>Mash Step #{idx + 1}</Text>
                <Button
                  label="Remove"
                  variant="ghost"
                  onPress={() =>
                    setDraft((p) => ({ ...p, mash: p.mash.filter((x) => x.key !== s.key) }))
                  }
                  accessibilityLabel={`Remove mash step ${s.name || idx + 1}`}
                />
              </View>
              <TextField
                label="Step Name"
                value={s.name}
                onChangeText={(name) =>
                  setDraft((p) => ({
                    ...p,
                    mash: p.mash.map((x) => (x.key === s.key ? { ...x, name } : x)),
                  }))
                }
              />
              <SegmentedControl
                options={MASH_TYPE_OPTIONS}
                value={s.type}
                onChange={(type) =>
                  setDraft((p) => ({
                    ...p,
                    mash: p.mash.map((x) => (x.key === s.key ? { ...x, type } : x)),
                  }))
                }
                accessibilityLabel={`Mash step ${idx + 1} type`}
                compact
              />
              <View style={styles.rowWrap}>
                <View style={styles.flexField}>
                  <TextField
                    label="Temp"
                    value={s.tempText}
                    onChangeText={(tempText) =>
                      setDraft((p) => ({
                        ...p,
                        mash: p.mash.map((x) => (x.key === s.key ? { ...x, tempText } : x)),
                      }))
                    }
                    unit={tempUnit}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={styles.flexField}>
                  <TextField
                    label="Time"
                    value={s.timeMinText}
                    onChangeText={(timeMinText) =>
                      setDraft((p) => ({
                        ...p,
                        mash: p.mash.map((x) => (x.key === s.key ? { ...x, timeMinText } : x)),
                      }))
                    }
                    unit="min"
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
            </View>
          ))}

          <View style={styles.divider} />

          <View style={styles.itemHeader}>
            <Text style={styles.sectionTitle}>Fermentation & Aging</Text>
            <Button
              label="Add stage"
              variant="secondary"
              onPress={() =>
                setDraft((p) => ({
                  ...p,
                  fermentation: [
                    ...p.fermentation,
                    {
                      key: newLineKey("ferm-step"),
                      name: "Secondary / Conditioning",
                      stage: "secondary",
                      tempText: unitSystem === "us" ? "65" : "18.3",
                      daysText: "14",
                    },
                  ],
                }))
              }
              testID="add-fermentation-step"
            />
          </View>

          {draft.fermentation.map((s, idx) => (
            <View key={s.key} style={styles.lineCard}>
              <View style={styles.itemHeader}>
                <Text style={styles.lineLabel}>Stage #{idx + 1}</Text>
                <Button
                  label="Remove"
                  variant="ghost"
                  onPress={() =>
                    setDraft((p) => ({
                      ...p,
                      fermentation: p.fermentation.filter((x) => x.key !== s.key),
                    }))
                  }
                  accessibilityLabel={`Remove fermentation stage ${s.name || idx + 1}`}
                />
              </View>
              <TextField
                label="Stage Name"
                value={s.name}
                onChangeText={(name) =>
                  setDraft((p) => ({
                    ...p,
                    fermentation: p.fermentation.map((x) => (x.key === s.key ? { ...x, name } : x)),
                  }))
                }
              />
              <SegmentedControl
                options={FERM_STAGE_OPTIONS}
                value={s.stage}
                onChange={(stage) =>
                  setDraft((p) => ({
                    ...p,
                    fermentation: p.fermentation.map((x) =>
                      x.key === s.key ? { ...x, stage } : x,
                    ),
                  }))
                }
                accessibilityLabel={`Fermentation stage ${idx + 1}`}
                compact
              />
              <View style={styles.rowWrap}>
                <View style={styles.flexField}>
                  <TextField
                    label="Temp"
                    value={s.tempText}
                    onChangeText={(tempText) =>
                      setDraft((p) => ({
                        ...p,
                        fermentation: p.fermentation.map((x) =>
                          x.key === s.key ? { ...x, tempText } : x,
                        ),
                      }))
                    }
                    unit={tempUnit}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={styles.flexField}>
                  <TextField
                    label="Duration"
                    value={s.daysText}
                    onChangeText={(daysText) =>
                      setDraft((p) => ({
                        ...p,
                        fermentation: p.fermentation.map((x) =>
                          x.key === s.key ? { ...x, daysText } : x,
                        ),
                      }))
                    }
                    unit="days"
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
            </View>
          ))}
        </Card>

        {/* Notes & Save Actions */}
        <Card>
          <Text style={styles.sectionTitle}>Brew Notes & Save</Text>
          <TextField
            label="Notes"
            value={draft.notes}
            onChangeText={(notes) => setDraft((p) => ({ ...p, notes }))}
            placeholder="Mash notes, water adjustments, yeast pitch tips..."
            autoCapitalize="sentences"
            testID="recipe-notes-input"
          />

          {formError ? (
            <Banner tone="error" message={formError} testID="recipe-form-error" />
          ) : null}
          {saveMessage ? (
            <Banner tone="success" message={saveMessage} testID="recipe-save-success" />
          ) : null}

          <View style={styles.actionRow}>
            {canManage ? (
              <Button
                label={saving ? "Saving..." : recipe ? "Save new version" : "Create recipe"}
                disabled={saving}
                onPress={() => void handleSave()}
                testID="recipe-save-button"
              />
            ) : null}

            {recipe && onFork ? (
              <Button
                label="Fork recipe"
                variant="secondary"
                disabled={saving}
                onPress={() => void onFork()}
                testID="recipe-fork-button"
              />
            ) : null}

            {recipe && canManage && onDelete ? (
              confirmDelete ? (
                <Button
                  label="Confirm delete"
                  variant="secondary"
                  disabled={saving}
                  onPress={() => void onDelete()}
                  testID="recipe-confirm-delete-button"
                />
              ) : (
                <Button
                  label="Delete"
                  variant="ghost"
                  onPress={() => setConfirmDelete(true)}
                  testID="recipe-delete-button"
                />
              )
            ) : null}
          </View>
        </Card>
      </View>

      {isDesktop ? sidebarCards : null}
    </View>
  );
}

const styles = StyleSheet.create({
  workspace: { gap: spacing.lg },
  workspaceDesktop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg },
  mainColumn: { flex: 1, gap: spacing.lg },
  sideColumn: { width: 340, gap: spacing.lg },
  stack: { gap: spacing.lg },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  subTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  muted: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  flexField: { flex: 1, minWidth: 110 },
  flexOne: { flex: 1 },
  subSection: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  badgeRow: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceSubtle,
  },
  badgeText: { fontSize: 12, fontWeight: "700", color: colors.textMuted },
  selectedPillRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radii.md,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  selectedPillTitle: { fontSize: 14, fontWeight: "700", color: colors.accentPressed },
  profileRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  profileChipWrap: { flexDirection: "row", alignItems: "center", gap: 4 },
  profileChip: {
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
  },
  profileChipSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  profileChipText: { fontSize: 13, fontWeight: "600", color: colors.text },
  profileChipTextSelected: { color: colors.accentPressed },
  lineCard: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  itemHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  lineLabel: { fontSize: 13, fontWeight: "700", color: colors.textMuted },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  versionList: { gap: spacing.xs },
  versionRow: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
  },
  versionRowActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  versionTitle: { fontSize: 14, fontWeight: "600", color: colors.text },
  versionTitleActive: { color: colors.accentPressed },
  versionMeta: { fontSize: 12, color: colors.textMuted },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
