// SPDX-License-Identifier: AGPL-3.0-or-later
import { units } from "@brew-bruvs/brew-math";
import { type ChangeEvent, useState } from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";
import {
  type CreateRecipeInput,
  type ImportedRecipeDraft,
  type RecipeFileFormat,
  useImportRecipeFile,
  useImportRecipeUrl,
} from "../../api/recipes";
import { useTheme, useThemedStyles } from "../../state/theme";
import { useUnits } from "../../state/units";
import { radii, spacing, type ThemeColors } from "../../theme";
import { parseNumber } from "../calculators/parseNumber";
import { Banner, Button, Card, SegmentedControl, TextField } from "../ui";
import { detectRecipeFormat, type PickedRecipeFile, pickNativeRecipeFile } from "./fileIO";
import { RecipeBuilder } from "./RecipeBuilder";

export interface RecipeImportFlowProps {
  serverUrl: string;
  authToken: string | null;
  onSaveImported: (input: CreateRecipeInput) => Promise<void>;
  saving?: boolean;
  onPickNativeFile?: () => Promise<PickedRecipeFile | null>;
  customFetch?: typeof fetch;
}

type ImportMode = "file" | "url";

const MODE_OPTIONS: readonly { value: ImportMode; label: string; accessibilityLabel: string }[] = [
  { value: "file", label: "File (BeerXML / BeerJSON)", accessibilityLabel: "Import from file" },
  { value: "url", label: "From URL", accessibilityLabel: "Import from recipe URL" },
];

const FORMAT_OPTIONS: readonly { value: RecipeFileFormat; label: string }[] = [
  { value: "beerxml", label: "BeerXML 1.0" },
  { value: "beerjson", label: "BeerJSON 1.0" },
];

export function RecipeImportFlow({
  serverUrl,
  authToken,
  onSaveImported,
  saving = false,
  onPickNativeFile = pickNativeRecipeFile,
  customFetch,
}: RecipeImportFlowProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { unitSystem } = useUnits();

  const [mode, setMode] = useState<ImportMode>("file");
  const [format, setFormat] = useState<RecipeFileFormat>("beerxml");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileContents, setFileContents] = useState("");
  const [pickingFile, setPickingFile] = useState(false);

  const [urlText, setUrlText] = useState("");
  const [urlBatchSizeText, setUrlBatchSizeText] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [reviewDraft, setReviewDraft] = useState<ImportedRecipeDraft | null>(null);
  const [reviewExcerpt, setReviewExcerpt] = useState<string | null>(null);
  const [reviewKey, setReviewKey] = useState(0);

  const importFileMutation = useImportRecipeFile(serverUrl, authToken, customFetch);
  const importUrlMutation = useImportRecipeUrl(serverUrl, authToken, customFetch);

  const handleWebFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setFileName(file.name);
      setFileContents(text);
      const detected = detectRecipeFormat(file.name, text);
      if (detected) {
        setFormat(detected);
      }
    } catch {
      setError("Could not read the selected file.");
    }
  };

  const handleNativeFilePick = async () => {
    setError(null);
    setPickingFile(true);
    try {
      const picked = await onPickNativeFile();
      if (!picked) return;
      setFileName(picked.name);
      setFileContents(picked.contents);
      const detected = detectRecipeFormat(picked.name, picked.contents);
      if (detected) {
        setFormat(detected);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the selected file.");
    } finally {
      setPickingFile(false);
    }
  };

  const handleParseFile = async () => {
    setError(null);
    const trimmed = fileContents.trim();
    if (!trimmed) {
      setError("Choose a BeerXML or BeerJSON file, or paste its contents below.");
      return;
    }
    const inferred = detectRecipeFormat(fileName, trimmed) ?? format;
    try {
      const draft = await importFileMutation.mutateAsync({
        format: inferred,
        contents: trimmed,
      });
      setFormat(inferred);
      setReviewDraft(draft);
      setReviewExcerpt(null);
      setReviewKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not parse recipe file.");
    }
  };

  const handleFetchUrl = async () => {
    setError(null);
    const trimmedUrl = urlText.trim();
    if (!trimmedUrl) {
      setError("Enter a public http:// or https:// recipe URL.");
      return;
    }
    const volVal = parseNumber(urlBatchSizeText);
    const batchSizeL =
      volVal !== null && volVal > 0
        ? unitSystem === "us"
          ? units.gallonsToLiters(volVal)
          : volVal
        : undefined;
    try {
      const res = await importUrlMutation.mutateAsync({
        url: trimmedUrl,
        ...(batchSizeL !== undefined ? { batchSizeL } : {}),
      });
      setReviewDraft(res.draft);
      setReviewExcerpt(res.excerpt || null);
      setReviewKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import recipe from URL.");
    }
  };

  if (reviewDraft) {
    return (
      <View style={styles.stack} testID="import-review-screen">
        <Card>
          <View style={styles.reviewHeader}>
            <View style={styles.reviewHeaderText}>
              <Text style={styles.sectionTitle}>Review Imported Recipe</Text>
              <Text style={styles.muted}>
                Nothing has been saved yet. Check and fix every amount, ingredient, and step below,
                then save when ready.
              </Text>
            </View>
            <Button
              label="Import another"
              variant="secondary"
              onPress={() => {
                setReviewDraft(null);
                setReviewExcerpt(null);
                setError(null);
              }}
              testID="import-reset-button"
            />
          </View>
        </Card>

        <RecipeBuilder
          key={`import-review-${reviewKey}`}
          serverUrl={serverUrl}
          authToken={authToken}
          initialImport={reviewDraft}
          importExcerpt={reviewExcerpt}
          onSaveNew={onSaveImported}
          saving={saving}
          {...(customFetch ? { customFetch } : {})}
        />
      </View>
    );
  }

  const volUnit = unitSystem === "us" ? "US gal" : "L";

  return (
    <View style={styles.stack} testID="recipe-import-flow">
      <Card>
        <Text style={styles.sectionTitle}>Choose Import Source</Text>
        <Text style={styles.muted}>
          Imported recipes open in a review draft before anything is saved. Every amount can be
          checked and edited, and permanent source credit is preserved.
        </Text>

        <SegmentedControl
          options={MODE_OPTIONS}
          value={mode}
          onChange={(next) => {
            setMode(next);
            setError(null);
          }}
          accessibilityLabel="Import source type"
        />

        {mode === "file" ? (
          <View style={styles.stack}>
            <SegmentedControl
              options={FORMAT_OPTIONS}
              value={format}
              onChange={setFormat}
              accessibilityLabel="Recipe file format"
              compact
            />

            {Platform.OS === "web" ? (
              <View style={styles.fileDropBox}>
                <Text style={styles.fieldLabel}>
                  Select BeerXML (.xml) or BeerJSON (.json) file
                </Text>
                <input
                  type="file"
                  accept=".xml,.json,.beerxml,.beerjson,application/xml,text/xml,application/json"
                  onChange={(e) => void handleWebFileChange(e)}
                  data-testid="import-file-input"
                  aria-label="Choose recipe file"
                  style={{ fontSize: 14 }}
                />
                {fileName ? (
                  <Text style={styles.fileSelectedText} testID="import-selected-filename">
                    Loaded: {fileName} ({format.toUpperCase()})
                  </Text>
                ) : null}
              </View>
            ) : (
              <View style={styles.fileDropBox}>
                <Text style={styles.fieldLabel}>
                  Select BeerXML (.xml) or BeerJSON (.json) file
                </Text>
                <Button
                  label={pickingFile ? "Opening files..." : "Choose recipe file"}
                  variant="secondary"
                  disabled={pickingFile}
                  onPress={() => void handleNativeFilePick()}
                  accessibilityLabel="Choose BeerXML or BeerJSON recipe file from device"
                  testID="import-native-file-button"
                />
                {fileName ? (
                  <Text style={styles.fileSelectedText} testID="import-selected-filename">
                    Loaded: {fileName} ({format.toUpperCase()})
                  </Text>
                ) : (
                  <Text style={styles.muted}>
                    Choose a file from your device, or paste BeerXML / BeerJSON text below.
                  </Text>
                )}
              </View>
            )}

            <View style={styles.textAreaGroup}>
              <Text style={styles.fieldLabel}>File Contents (editable or paste directly)</Text>
              <TextInput
                value={fileContents}
                onChangeText={(text) => {
                  setFileContents(text);
                  const detected = detectRecipeFormat(fileName, text);
                  if (detected) setFormat(detected);
                }}
                placeholder={
                  format === "beerxml"
                    ? '<?xml version="1.0"?><RECIPES><RECIPE>...</RECIPE></RECIPES>'
                    : '{"beerjson":{"version":1,"recipes":[...]}}'
                }
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={6}
                accessibilityLabel="Recipe file contents"
                testID="import-file-contents-input"
                style={styles.textArea}
              />
            </View>

            {error ? <Banner tone="error" message={error} testID="import-error" /> : null}

            <Button
              label={importFileMutation.isPending ? "Parsing file..." : "Parse & review recipe"}
              disabled={importFileMutation.isPending}
              onPress={() => void handleParseFile()}
              testID="import-file-submit-button"
            />
          </View>
        ) : (
          <View style={styles.stack}>
            <TextField
              label="Recipe Page URL"
              value={urlText}
              onChangeText={setUrlText}
              placeholder="https://example.com/recipes/american-pale-ale"
              keyboardType="url"
              helper="Obeys robots.txt, reads linked BeerXML/BeerJSON or schema.org Recipe data, and keeps permanent attribution."
              testID="import-url-input"
            />

            <TextField
              label="Batch Size Override (optional)"
              value={urlBatchSizeText}
              onChangeText={setUrlBatchSizeText}
              placeholder={unitSystem === "us" ? "5.0" : "18.9"}
              unit={volUnit}
              keyboardType="decimal-pad"
              helper="Used only if the source page does not specify a usable batch yield."
              testID="import-url-batch-size-input"
            />

            {error ? <Banner tone="error" message={error} testID="import-error" /> : null}

            <Button
              label={importUrlMutation.isPending ? "Fetching recipe..." : "Fetch & review recipe"}
              disabled={importUrlMutation.isPending}
              onPress={() => void handleFetchUrl()}
              testID="import-url-submit-button"
            />
          </View>
        )}
      </Card>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    stack: { gap: spacing.md },
    sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
    muted: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
    reviewHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    reviewHeaderText: { flex: 1, minWidth: 200, gap: 4 },
    fileDropBox: {
      padding: spacing.md,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surfaceSubtle,
      gap: spacing.sm,
    },
    fieldLabel: { fontSize: 14, fontWeight: "600", color: colors.text },
    fileSelectedText: { fontSize: 13, fontWeight: "600", color: colors.success },
    textAreaGroup: { gap: spacing.xs },
    textArea: {
      minHeight: 130,
      padding: spacing.md,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surface,
      color: colors.text,
      fontSize: 13,
      textAlignVertical: "top",
    },
  });
