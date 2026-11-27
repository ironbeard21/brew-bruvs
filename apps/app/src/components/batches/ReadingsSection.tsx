// SPDX-License-Identifier: AGPL-3.0-or-later
import { units } from "@brew-bruvs/brew-math";
import { useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import type { Reading, ReadingInput, ReadingPatch } from "../../api/batches";
import type { Beverage } from "../../api/recipes";
import { useThemedStyles } from "../../state/theme";
import { useUnits } from "../../state/units";
import { DESKTOP_BREAKPOINT, radii, spacing, type ThemeColors } from "../../theme";
import { parseNumber, useOnUnitSystemChange } from "../calculators/parseNumber";
import { Banner, Button, Card, TextField } from "../ui";
import { formatDateTime, formatTemperature } from "./batchFlows";
import { FermentationChart } from "./FermentationChart";

export interface ReadingsSectionProps {
  beverage: Beverage;
  readings: readonly Reading[];
  loading?: boolean;
  canEdit: boolean;
  canContribute?: boolean;
  onAddReading: (input: ReadingInput) => Promise<void>;
  onUpdateReading: (readingId: string, patch: ReadingPatch) => Promise<void>;
  onDeleteReading: (readingId: string) => Promise<void>;
  saving?: boolean;
}

export function ReadingsSection({
  beverage,
  readings,
  loading = false,
  canEdit,
  canContribute: canContributeProp,
  onAddReading,
  onUpdateReading,
  onDeleteReading,
  saving = false,
}: ReadingsSectionProps) {
  const styles = useThemedStyles(createStyles);
  const canContribute = canContributeProp ?? canEdit;
  const { unitSystem } = useUnits();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const isNonBeer = beverage !== "beer";
  const [showExtended, setShowExtended] = useState(isNonBeer);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [gravityText, setGravityText] = useState("");
  const [tempText, setTempText] = useState("");
  const [phText, setPhText] = useState("");
  const [brixText, setBrixText] = useState("");
  const [taText, setTaText] = useState("");
  const [so2Text, setSo2Text] = useState("");
  const [noteText, setNoteText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useOnUnitSystemChange(unitSystem, (next) => {
    const val = parseNumber(tempText);
    if (val === null) return;
    const converted = next === "us" ? units.cToF(val) : units.fToC(val);
    setTempText(converted.toFixed(1));
  });

  const tempUnit = unitSystem === "us" ? "°F" : "°C";

  const resetForm = () => {
    setEditingId(null);
    setGravityText("");
    setTempText("");
    setPhText("");
    setBrixText("");
    setTaText("");
    setSo2Text("");
    setNoteText("");
    setError(null);
  };

  const startEditing = (r: Reading) => {
    setEditingId(r.id);
    setGravityText(r.gravitySg != null ? r.gravitySg.toFixed(3) : "");
    setTempText(
      r.temperatureC != null
        ? (unitSystem === "us" ? units.cToF(r.temperatureC) : r.temperatureC).toFixed(1)
        : "",
    );
    setPhText(r.ph != null ? String(r.ph) : "");
    setBrixText(r.brix != null ? String(r.brix) : "");
    setTaText(r.titratableAcidityGPerL != null ? String(r.titratableAcidityGPerL) : "");
    setSo2Text(r.freeSo2MgPerL != null ? String(r.freeSo2MgPerL) : "");
    setNoteText(r.note ?? "");
    if (r.brix != null || r.titratableAcidityGPerL != null || r.freeSo2MgPerL != null) {
      setShowExtended(true);
    }
    setError(null);
  };

  const handleSubmit = async () => {
    setError(null);
    const gravitySg = parseNumber(gravityText);
    const tempDisplay = parseNumber(tempText);
    const temperatureC =
      tempDisplay !== null ? (unitSystem === "us" ? units.fToC(tempDisplay) : tempDisplay) : null;
    const ph = parseNumber(phText);
    const brix = parseNumber(brixText);
    const titratableAcidityGPerL = parseNumber(taText);
    const freeSo2MgPerL = parseNumber(so2Text);

    if (
      gravitySg === null &&
      temperatureC === null &&
      ph === null &&
      brix === null &&
      titratableAcidityGPerL === null &&
      freeSo2MgPerL === null
    ) {
      setError("Enter at least one measurement (gravity, temperature, pH, etc.).");
      return;
    }

    if (gravitySg !== null && (gravitySg < 0.98 || gravitySg > 1.3)) {
      setError("Gravity must be between 0.980 and 1.300 SG.");
      return;
    }
    if (temperatureC !== null && (temperatureC < -10 || temperatureC > 110)) {
      setError("Temperature is out of valid brewing range.");
      return;
    }
    if (ph !== null && (ph < 0 || ph > 14)) {
      setError("pH must be between 0 and 14.");
      return;
    }

    const trimmedNote = noteText.trim();

    try {
      if (editingId) {
        const patch: ReadingPatch = {
          gravitySg,
          temperatureC,
          ph,
          brix,
          titratableAcidityGPerL,
          freeSo2MgPerL,
          note: trimmedNote || null,
        };
        await onUpdateReading(editingId, patch);
      } else {
        const payload: ReadingInput = {
          takenAt: new Date().toISOString(),
          source: "manual",
          ...(gravitySg !== null ? { gravitySg } : {}),
          ...(temperatureC !== null ? { temperatureC } : {}),
          ...(ph !== null ? { ph } : {}),
          ...(brix !== null ? { brix } : {}),
          ...(titratableAcidityGPerL !== null ? { titratableAcidityGPerL } : {}),
          ...(freeSo2MgPerL !== null ? { freeSo2MgPerL } : {}),
          ...(trimmedNote ? { note: trimmedNote } : {}),
        };
        await onAddReading(payload);
      }
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save reading.");
    }
  };

  return (
    <View style={styles.root}>
      {/* Fermentation Chart Card */}
      <Card>
        <Text style={styles.sectionTitle}>Fermentation Progress</Text>
        <FermentationChart readings={readings} />
      </Card>

      <View style={[styles.layout, isDesktop && styles.layoutDesktop]}>
        {/* Log Reading Form */}
        {canContribute ? (
          <Card style={isDesktop ? styles.column : undefined}>
            <Text style={styles.sectionTitle}>{editingId ? "Edit Reading" : "Log a Reading"}</Text>
            <Text style={styles.muted}>
              {isNonBeer
                ? `Showing ${beverage} chemistry fields (gravity, temperature, pH, Brix, TA, free SO₂). Stored in SI.`
                : "Enter gravity, fermentation temperature, or pH. Values are converted and stored in SI."}
            </Text>

            <View style={styles.fieldRow}>
              <View style={styles.halfField}>
                <TextField
                  label="Gravity"
                  value={gravityText}
                  onChangeText={setGravityText}
                  placeholder="1.052"
                  unit="SG"
                  keyboardType="decimal-pad"
                  testID="reading-gravity-input"
                />
              </View>
              <View style={styles.halfField}>
                <TextField
                  label="Temperature"
                  value={tempText}
                  onChangeText={setTempText}
                  placeholder={unitSystem === "us" ? "68" : "20.0"}
                  unit={tempUnit}
                  keyboardType="decimal-pad"
                  testID="reading-temp-input"
                />
              </View>
            </View>

            <View style={styles.fieldRow}>
              <View style={styles.halfField}>
                <TextField
                  label="pH"
                  value={phText}
                  onChangeText={setPhText}
                  placeholder={isNonBeer ? "3.45" : "4.30"}
                  keyboardType="decimal-pad"
                  testID="reading-ph-input"
                />
              </View>
              {showExtended ? (
                <View style={styles.halfField}>
                  <TextField
                    label="Brix"
                    value={brixText}
                    onChangeText={setBrixText}
                    placeholder="22.0"
                    unit="°Bx"
                    keyboardType="decimal-pad"
                    testID="reading-brix-input"
                  />
                </View>
              ) : null}
            </View>

            {showExtended ? (
              <View style={styles.fieldRow}>
                <View style={styles.halfField}>
                  <TextField
                    label="Titratable Acidity"
                    value={taText}
                    onChangeText={setTaText}
                    placeholder="6.5"
                    unit="g/L"
                    keyboardType="decimal-pad"
                    testID="reading-ta-input"
                  />
                </View>
                <View style={styles.halfField}>
                  <TextField
                    label="Free SO₂"
                    value={so2Text}
                    onChangeText={setSo2Text}
                    placeholder="35"
                    unit="mg/L"
                    keyboardType="decimal-pad"
                    testID="reading-so2-input"
                  />
                </View>
              </View>
            ) : (
              <Button
                label="Show Brix, TA & Free SO₂ fields"
                variant="ghost"
                onPress={() => setShowExtended(true)}
                testID="reading-show-extended-button"
              />
            )}

            <TextField
              label="Note (optional)"
              value={noteText}
              onChangeText={setNoteText}
              placeholder="e.g. Krausen falling, active airlock"
              testID="reading-note-input"
            />

            {error ? <Banner tone="error" message={error} testID="reading-error" /> : null}

            <View style={styles.formActions}>
              <Button
                label={saving ? "Saving..." : editingId ? "Update reading" : "Log reading"}
                disabled={saving}
                onPress={() => void handleSubmit()}
                testID="reading-submit-button"
              />
              {editingId ? <Button label="Cancel" variant="secondary" onPress={resetForm} /> : null}
            </View>
          </Card>
        ) : null}

        {/* Readings History */}
        <Card style={isDesktop ? styles.column : undefined}>
          <Text style={styles.sectionTitle}>Reading Log ({readings.length})</Text>

          {loading ? <Banner tone="info" message="Loading readings..." /> : null}

          {!loading && readings.length === 0 ? (
            <Text style={styles.muted}>No readings recorded yet.</Text>
          ) : (
            <View style={styles.list}>
              {[...readings].reverse().map((r, idx) => (
                <View key={r.id} style={styles.readingRow} testID={`reading-item-${idx}`}>
                  <View style={styles.readingHeader}>
                    <Text style={styles.readingDate}>{formatDateTime(r.takenAt)}</Text>
                    <Text style={styles.readingSource}>{r.source}</Text>
                  </View>

                  <View style={styles.metricsWrap}>
                    {r.gravitySg != null ? (
                      <View style={styles.metricPill}>
                        <Text style={styles.metricText}>{r.gravitySg.toFixed(3)} SG</Text>
                      </View>
                    ) : null}
                    {r.temperatureC != null ? (
                      <View style={styles.metricPill}>
                        <Text style={styles.metricText}>
                          {formatTemperature(r.temperatureC, unitSystem)}
                        </Text>
                      </View>
                    ) : null}
                    {r.ph != null ? (
                      <View style={styles.metricPill}>
                        <Text style={styles.metricText}>pH {r.ph.toFixed(2)}</Text>
                      </View>
                    ) : null}
                    {r.brix != null ? (
                      <View style={styles.metricPill}>
                        <Text style={styles.metricText}>{r.brix.toFixed(1)} °Bx</Text>
                      </View>
                    ) : null}
                    {r.titratableAcidityGPerL != null ? (
                      <View style={styles.metricPill}>
                        <Text style={styles.metricText}>
                          TA {r.titratableAcidityGPerL.toFixed(1)} g/L
                        </Text>
                      </View>
                    ) : null}
                    {r.freeSo2MgPerL != null ? (
                      <View style={styles.metricPill}>
                        <Text style={styles.metricText}>SO₂ {r.freeSo2MgPerL.toFixed(0)} mg/L</Text>
                      </View>
                    ) : null}
                  </View>

                  {r.note ? <Text style={styles.readingNote}>{r.note}</Text> : null}

                  {canEdit ? (
                    <View style={styles.rowActions}>
                      <Button
                        label="Edit"
                        variant="ghost"
                        onPress={() => startEditing(r)}
                        testID={`reading-edit-${idx}`}
                      />
                      <Button
                        label="Delete"
                        variant="ghost"
                        onPress={() => void onDeleteReading(r.id)}
                        testID={`reading-delete-${idx}`}
                      />
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </Card>
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: { gap: spacing.lg },
    layout: { gap: spacing.lg },
    layoutDesktop: { flexDirection: "row", alignItems: "flex-start" },
    column: { flex: 1 },
    sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
    muted: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
    fieldRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
    halfField: { flex: 1, minWidth: 130 },
    formActions: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
    list: { gap: spacing.sm },
    readingRow: {
      padding: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.surfaceSubtle,
      borderWidth: 1,
      borderColor: colors.border,
      gap: spacing.xs,
    },
    readingHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    readingDate: { fontSize: 13, fontWeight: "700", color: colors.text },
    readingSource: {
      fontSize: 11,
      fontWeight: "600",
      color: colors.textMuted,
      textTransform: "uppercase",
    },
    metricsWrap: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      marginTop: 2,
    },
    metricPill: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radii.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    metricText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.text,
      fontVariant: ["tabular-nums"],
    },
    readingNote: {
      fontSize: 13,
      color: colors.textMuted,
      marginTop: 2,
    },
    rowActions: {
      flexDirection: "row",
      gap: spacing.xs,
      marginTop: 2,
    },
  });
