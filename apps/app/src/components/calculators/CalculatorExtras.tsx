// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useCurrentUser } from "../../api/auth";
import { useCreateBatchNote, useMyBatches } from "../../api/batches";
import { useOptionalServer } from "../../state/server";
import { useThemedStyles } from "../../state/theme";
import { radii, spacing, type ThemeColors } from "../../theme";
import { Banner, Button } from "../ui";

export interface FormulaDisclosureProps {
  title?: string;
  formula: string;
  notes?: string;
}

export function FormulaDisclosure({ title = "Formula", formula, notes }: FormulaDisclosureProps) {
  const styles = useThemedStyles(createStyles);
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.formulaContainer}>
      <Pressable
        onPress={() => setExpanded((open) => !open)}
        accessibilityRole="button"
        accessibilityLabel={expanded ? `Hide ${title}` : `Show ${title}`}
        accessibilityState={{ expanded }}
        testID="formula-toggle"
        style={styles.formulaHeader}
      >
        <Text style={styles.formulaHeaderText}>{expanded ? `Hide ${title}` : `Show ${title}`}</Text>
        <Text style={styles.formulaChevron} accessible={false}>
          {expanded ? "▲" : "▼"}
        </Text>
      </Pressable>
      {expanded ? (
        <View style={styles.formulaBody} testID="formula-content">
          <Text style={styles.formulaText}>{formula}</Text>
          {notes ? <Text style={styles.formulaNotes}>{notes}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

export interface SaveToBatchNoteProps {
  calculatorName: string;
  noteBody: string | null;
  customFetch?: typeof fetch;
}

export function SaveToBatchNote({ calculatorName, noteBody, customFetch }: SaveToBatchNoteProps) {
  const server = useOptionalServer();
  if (!server?.serverUrl || !noteBody) {
    return null;
  }
  return (
    <SaveToBatchNoteConnected
      serverUrl={server.serverUrl}
      authToken={server.authToken}
      calculatorName={calculatorName}
      noteBody={noteBody}
      {...(customFetch ? { customFetch } : {})}
    />
  );
}

interface SaveToBatchNoteConnectedProps {
  serverUrl: string;
  authToken: string | null;
  calculatorName: string;
  noteBody: string;
  customFetch?: typeof fetch;
}

function SaveToBatchNoteConnected({
  serverUrl,
  authToken,
  calculatorName,
  noteBody,
  customFetch,
}: SaveToBatchNoteConnectedProps) {
  const styles = useThemedStyles(createStyles);
  const currentUser = useCurrentUser(serverUrl, authToken, customFetch);
  const signedIn = Boolean(currentUser.data);

  const [open, setOpen] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [savedBatchName, setSavedBatchName] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const batches = useMyBatches(serverUrl, authToken, signedIn && open, customFetch);
  const createNote = useCreateBatchNote(serverUrl, authToken, customFetch);

  if (!signedIn) {
    return null;
  }

  const batchList = batches.data ?? [];
  const effectiveBatchId = selectedBatchId ?? batchList[0]?.id ?? null;

  const handleSave = async () => {
    if (!effectiveBatchId) return;
    setSaveError(null);
    setSavedBatchName(null);
    try {
      await createNote.mutateAsync({
        batchId: effectiveBatchId,
        body: `${calculatorName}: ${noteBody}`,
      });
      const chosen = batchList.find((b) => b.id === effectiveBatchId);
      setSavedBatchName(chosen?.name ?? "batch");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save note to batch.");
    }
  };

  return (
    <View style={styles.saveContainer}>
      <Button
        label={open ? "Hide save to batch" : "Save result to a batch"}
        variant="secondary"
        onPress={() => {
          setOpen((v) => !v);
          setSavedBatchName(null);
          setSaveError(null);
        }}
        accessibilityLabel={`Save ${calculatorName} result to a batch as a note`}
        testID="save-to-batch-toggle"
      />

      {open ? (
        <View style={styles.savePanel} testID="save-to-batch-panel">
          <Text style={styles.savePreviewLabel}>Note preview</Text>
          <Text style={styles.savePreviewText} testID="save-to-batch-preview">
            {calculatorName}: {noteBody}
          </Text>

          {batches.isPending ? (
            <Banner tone="info" message="Loading your batches..." testID="save-to-batch-loading" />
          ) : batches.isError ? (
            <Banner
              tone="error"
              message={
                batches.error instanceof Error ? batches.error.message : "Could not load batches."
              }
              testID="save-to-batch-error"
            />
          ) : batchList.length === 0 ? (
            <Banner
              tone="info"
              message="No batches found yet. Start a batch first to save calculator notes to it."
              testID="save-to-batch-empty"
            />
          ) : (
            <View
              style={styles.batchPicker}
              accessibilityRole="radiogroup"
              accessibilityLabel="Select a batch"
            >
              {batchList.map((batch) => {
                const selected = batch.id === effectiveBatchId;
                return (
                  <Pressable
                    key={batch.id}
                    onPress={() => {
                      setSelectedBatchId(batch.id);
                      setSavedBatchName(null);
                    }}
                    accessibilityRole="radio"
                    accessibilityLabel={`${batch.name} (${batch.beverage}, ${batch.status})`}
                    accessibilityState={{ checked: selected }}
                    testID={`batch-option-${batch.id}`}
                    style={[styles.batchOption, selected && styles.batchOptionSelected]}
                  >
                    <Text style={[styles.batchName, selected && styles.batchNameSelected]}>
                      {batch.name}
                    </Text>
                    <Text style={styles.batchMeta}>
                      {batch.beverage} · {batch.status.replace(/_/g, " ")}
                    </Text>
                  </Pressable>
                );
              })}

              <Button
                label={createNote.isPending ? "Saving..." : "Save note to batch"}
                disabled={createNote.isPending || !effectiveBatchId}
                onPress={() => {
                  void handleSave();
                }}
                testID="save-to-batch-submit"
              />
            </View>
          )}

          {savedBatchName ? (
            <Banner
              tone="success"
              message={`Saved calculation note to ${savedBatchName}.`}
              testID="save-to-batch-success"
            />
          ) : null}
          {saveError ? (
            <Banner tone="error" message={saveError} testID="save-to-batch-error" />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    formulaContainer: {
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceSubtle,
      overflow: "hidden",
    },
    formulaHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: 40,
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
    },
    formulaHeaderText: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.accentPressed,
    },
    formulaChevron: {
      fontSize: 11,
      color: colors.accentPressed,
    },
    formulaBody: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.md,
      paddingTop: spacing.xs,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      gap: spacing.xs,
    },
    formulaText: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.text,
      fontWeight: "500",
    },
    formulaNotes: {
      fontSize: 12,
      lineHeight: 18,
      color: colors.textMuted,
    },
    saveContainer: {
      gap: spacing.sm,
      paddingTop: spacing.xs,
    },
    savePanel: {
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.surfaceSubtle,
      borderWidth: 1,
      borderColor: colors.border,
    },
    savePreviewLabel: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    savePreviewText: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.text,
    },
    batchPicker: {
      gap: spacing.xs,
    },
    batchOption: {
      minHeight: 44,
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: radii.sm,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      justifyContent: "center",
    },
    batchOptionSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    batchName: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.text,
    },
    batchNameSelected: {
      color: colors.accentPressed,
    },
    batchMeta: {
      fontSize: 12,
      color: colors.textMuted,
    },
  });
