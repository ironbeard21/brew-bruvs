// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import type { Note, NoteInput, TastingScores } from "../../api/batches";
import { colors, DESKTOP_BREAKPOINT, radii, spacing } from "../../theme";
import { Banner, Button, Card, SegmentedControl, TextField } from "../ui";
import { formatDateTime } from "./batchFlows";

export interface BatchNotesSectionProps {
  batchId: string;
  notes: readonly Note[];
  loading?: boolean;
  canEdit: boolean;
  canContribute?: boolean;
  canDeleteNote?: (note: Note) => boolean;
  onCreateNote: (input: NoteInput) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  saving?: boolean;
}

type NoteKind = "general" | "tasting";

const KIND_OPTIONS: readonly { value: NoteKind; label: string }[] = [
  { value: "general", label: "General Note" },
  { value: "tasting", label: "Tasting Note (BJCP /50)" },
];

const BJCP_FIELDS = [
  { key: "aroma", label: "Aroma", max: 12 },
  { key: "appearance", label: "Appearance", max: 3 },
  { key: "flavor", label: "Flavor", max: 20 },
  { key: "mouthfeel", label: "Mouthfeel", max: 5 },
  { key: "overall", label: "Overall", max: 10 },
] as const;

type ScoreKey = (typeof BJCP_FIELDS)[number]["key"];

function parseIntScore(raw: string, max: number): { value: number | undefined; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: undefined };
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0 || n > max) {
    return { value: undefined, error: `Score must be an integer between 0 and ${max}.` };
  }
  return { value: n };
}

export function BatchNotesSection({
  batchId,
  notes,
  loading = false,
  canEdit,
  canContribute: canContributeProp,
  canDeleteNote,
  onCreateNote,
  onDeleteNote,
  saving = false,
}: BatchNotesSectionProps) {
  const canContribute = canContributeProp ?? canEdit;
  const allowDeleteNote = canDeleteNote ?? (() => canEdit);
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [kind, setKind] = useState<NoteKind>("general");
  const [body, setBody] = useState("");
  const [scoresText, setScoresText] = useState<Record<ScoreKey, string>>({
    aroma: "",
    appearance: "",
    flavor: "",
    mouthfeel: "",
    overall: "",
  });
  const [error, setError] = useState<string | null>(null);

  const liveTotal = BJCP_FIELDS.reduce((sum, f) => {
    const parsed = parseIntScore(scoresText[f.key], f.max);
    return parsed.value != null ? sum + parsed.value : sum;
  }, 0);

  const hasAnyScore = BJCP_FIELDS.some((f) => scoresText[f.key].trim().length > 0);

  const handleSubmit = async () => {
    setError(null);
    const trimmedBody = body.trim();
    if (!trimmedBody) {
      setError("Enter note text before saving.");
      return;
    }

    let scores: TastingScores | undefined;
    if (kind === "tasting" && hasAnyScore) {
      const nextScores: TastingScores = {};
      for (const field of BJCP_FIELDS) {
        const parsed = parseIntScore(scoresText[field.key], field.max);
        if (parsed.error) {
          setError(`${field.label}: ${parsed.error}`);
          return;
        }
        if (parsed.value !== undefined) {
          nextScores[field.key] = parsed.value;
        }
      }
      scores = nextScores;
    }

    try {
      await onCreateNote({
        kind,
        batchId,
        body: trimmedBody,
        ...(scores ? { scores } : {}),
      });
      setBody("");
      setScoresText({
        aroma: "",
        appearance: "",
        flavor: "",
        mouthfeel: "",
        overall: "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save note.");
    }
  };

  return (
    <View style={[styles.layout, isDesktop && styles.layoutDesktop]} testID="batch-notes-section">
      {/* Note Composer */}
      {canContribute ? (
        <Card style={isDesktop ? styles.column : undefined}>
          <Text style={styles.sectionTitle}>Add Note</Text>
          <SegmentedControl
            options={KIND_OPTIONS}
            value={kind}
            onChange={setKind}
            accessibilityLabel="Note type"
          />

          {kind === "tasting" ? (
            <View style={styles.bjcpBox}>
              <View style={styles.bjcpHeader}>
                <Text style={styles.bjcpTitle}>BJCP Score Sheet</Text>
                <Text style={styles.bjcpTotal} testID="tasting-score-total">
                  {hasAnyScore ? `${liveTotal} / 50` : "Optional"}
                </Text>
              </View>
              <View style={styles.scoreGrid}>
                {BJCP_FIELDS.map((field) => (
                  <View key={field.key} style={styles.scoreCell}>
                    <TextField
                      label={field.label}
                      value={scoresText[field.key]}
                      onChangeText={(val) =>
                        setScoresText((prev) => ({ ...prev, [field.key]: val }))
                      }
                      unit={`/${field.max}`}
                      keyboardType="number-pad"
                      placeholder={String(field.max)}
                      testID={`tasting-score-${field.key}`}
                    />
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          <TextField
            label={kind === "tasting" ? "Tasting Impressions" : "Batch Note"}
            value={body}
            onChangeText={setBody}
            placeholder={
              kind === "tasting"
                ? "Bright citrus aroma, crisp bitter finish, clean dry attenuation..."
                : "Brew-day observations, water adjustments, or fermentation notes..."
            }
            testID="note-body-input"
          />

          {error ? <Banner tone="error" message={error} testID="note-error" /> : null}

          <Button
            label={saving ? "Saving..." : kind === "tasting" ? "Save tasting note" : "Save note"}
            disabled={saving}
            onPress={() => void handleSubmit()}
            testID="note-submit-button"
          />
        </Card>
      ) : null}

      {/* Notes Feed */}
      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Notes & Tastings ({notes.length})</Text>
        {loading ? <Banner tone="info" message="Loading notes..." /> : null}
        {!loading && notes.length === 0 ? (
          <Text style={styles.muted}>No notes logged for this batch yet.</Text>
        ) : (
          <View style={styles.list}>
            {notes.map((n, idx) => (
              <View key={n.id} style={styles.noteCard} testID={`note-item-${idx}`}>
                <View style={styles.noteHeader}>
                  <View style={styles.noteBadges}>
                    <View style={[styles.kindPill, n.kind === "tasting" && styles.kindPillTasting]}>
                      <Text
                        style={[
                          styles.kindPillText,
                          n.kind === "tasting" && styles.kindPillTextTasting,
                        ]}
                      >
                        {n.kind === "tasting" ? "Tasting" : "Note"}
                      </Text>
                    </View>
                    {n.kind === "tasting" && n.scores?.total != null ? (
                      <View style={styles.totalPill}>
                        <Text style={styles.totalPillText}>{n.scores.total}/50 BJCP</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.noteDate}>{formatDateTime(n.createdAt)}</Text>
                </View>

                <Text style={styles.noteBody}>{n.body}</Text>

                {n.kind === "tasting" && n.scores ? (
                  <View style={styles.scoresBreakdown}>
                    {BJCP_FIELDS.map((field) => {
                      const val = n.scores?.[field.key];
                      if (val == null) return null;
                      return (
                        <Text key={field.key} style={styles.scoreChip}>
                          {field.label} {val}/{field.max}
                        </Text>
                      );
                    })}
                  </View>
                ) : null}

                {allowDeleteNote(n) ? (
                  <View style={styles.noteActions}>
                    <Button
                      label="Delete"
                      variant="ghost"
                      onPress={() => void onDeleteNote(n.id)}
                      testID={`note-delete-${idx}`}
                    />
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  layout: { gap: spacing.lg },
  layoutDesktop: { flexDirection: "row", alignItems: "flex-start" },
  column: { flex: 1 },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  muted: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
  bjcpBox: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  bjcpHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  bjcpTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
  bjcpTotal: {
    fontSize: 15,
    fontWeight: "800",
    color: colors.accentPressed,
    fontVariant: ["tabular-nums"],
  },
  scoreGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  scoreCell: {
    flex: 1,
    minWidth: 115,
  },
  list: { gap: spacing.sm },
  noteCard: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  noteHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  noteBadges: { flexDirection: "row", alignItems: "center", gap: 6 },
  kindPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  kindPillTasting: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  kindPillText: { fontSize: 12, fontWeight: "700", color: colors.textMuted },
  kindPillTextTasting: { color: colors.accentPressed },
  totalPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.successSoft,
  },
  totalPillText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.success,
    fontVariant: ["tabular-nums"],
  },
  noteDate: { fontSize: 12, color: colors.textMuted },
  noteBody: { fontSize: 14, lineHeight: 20, color: colors.text },
  scoresBreakdown: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingTop: 4,
  },
  scoreChip: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
    fontVariant: ["tabular-nums"],
  },
  noteActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
});
