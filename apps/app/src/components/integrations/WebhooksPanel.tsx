// SPDX-License-Identifier: AGPL-3.0-or-later
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { type Batch, useBatches } from "../../api/batches";
import type { Brewery } from "../../api/breweries";
import {
  type IssuedWebhook,
  useCreateWebhook,
  useDeleteWebhook,
  useTestWebhook,
  useWebhooks,
  type Webhook,
} from "../../api/integrations";
import { canWriteBrewery, ROLE_LABELS } from "../../state/permissions";
import { useThemedStyles } from "../../state/theme";
import { DESKTOP_BREAKPOINT, radii, spacing, type ThemeColors } from "../../theme";
import { formatBatchStatus, formatDateTime } from "../batches/batchFlows";
import { Banner, Button, Card, TextField } from "../ui";
import { copyOrShareSecret } from "./clipboard";

export interface WebhooksPanelProps {
  serverUrl: string;
  authToken: string | null;
  currentUserId: string;
  activeBrewery: Brewery | null;
  onSwitchToPersonal?: () => void;
  customFetch?: typeof fetch;
}

function isOwnedByScope(batch: Batch, currentUserId: string, breweryId: string | null): boolean {
  if (breweryId) {
    return batch.owner.type === "brewery" && batch.owner.id === breweryId;
  }
  return batch.owner.type === "user" && batch.owner.id === currentUserId;
}

export function WebhooksPanel({
  serverUrl,
  authToken,
  currentUserId,
  activeBrewery,
  onSwitchToPersonal,
  customFetch,
}: WebhooksPanelProps) {
  const styles = useThemedStyles(createStyles);
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const canManageScope = !activeBrewery || canWriteBrewery(activeBrewery.role);
  const scopeBreweryId = activeBrewery && canManageScope ? activeBrewery.id : null;
  const scopeLabel = activeBrewery ? activeBrewery.name : "Me (personal)";

  const webhooksQuery = useWebhooks(
    serverUrl,
    authToken,
    { breweryId: scopeBreweryId, enabled: canManageScope },
    customFetch,
  );
  const batchesQuery = useBatches(
    serverUrl,
    authToken,
    {
      mine: !scopeBreweryId,
      breweryId: scopeBreweryId,
      enabled: canManageScope,
    },
    customFetch,
  );
  const createWebhook = useCreateWebhook(serverUrl, authToken, customFetch);
  const testWebhook = useTestWebhook(serverUrl, authToken, customFetch);
  const deleteWebhook = useDeleteWebhook(serverUrl, authToken, customFetch);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [issuedWebhook, setIssuedWebhook] = useState<IssuedWebhook | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ownerBatches = useMemo(() => {
    const items = batchesQuery.data ?? [];
    return items.filter((b) => isOwnedByScope(b, currentUserId, scopeBreweryId));
  }, [batchesQuery.data, currentUserId, scopeBreweryId]);

  const effectiveSelectedBatchId =
    selectedBatchId && ownerBatches.some((b) => b.id === selectedBatchId) ? selectedBatchId : null;

  const batchById = useMemo(() => {
    const map = new Map<string, Batch>();
    for (const b of ownerBatches) {
      map.set(b.id, b);
    }
    return map;
  }, [ownerBatches]);

  if (!canManageScope && activeBrewery) {
    return (
      <Card testID="webhooks-readonly-card">
        <Text style={styles.sectionTitle}>Outgoing Webhooks</Text>
        <Banner
          tone="info"
          message={`Viewing ${activeBrewery.name} as ${ROLE_LABELS[activeBrewery.role]}. Only Owners and Brewers can view or manage brewery webhooks.`}
          testID="webhooks-readonly-banner"
        />
        {onSwitchToPersonal ? (
          <View style={styles.inlineActions}>
            <Button
              label="Switch to personal webhooks"
              variant="secondary"
              onPress={onSwitchToPersonal}
              testID="webhooks-switch-personal-button"
            />
          </View>
        ) : null}
      </Card>
    );
  }

  const handleCreate = async () => {
    setError(null);
    setNotice(null);
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName) {
      setError("Enter a name for this webhook (e.g. Discord Relay or Home Automation).");
      return;
    }
    if (!/^https?:\/\/.+/i.test(trimmedUrl)) {
      setError("Enter a valid public http:// or https:// destination URL.");
      return;
    }
    try {
      const created = await createWebhook.mutateAsync({
        name: trimmedName,
        url: trimmedUrl,
        ...(scopeBreweryId ? { breweryId: scopeBreweryId } : {}),
        ...(effectiveSelectedBatchId ? { batchId: effectiveSelectedBatchId } : {}),
      });
      setIssuedWebhook(created);
      setName("");
      setUrl("");
      setSelectedBatchId(null);
      setNotice("Webhook created. Copy the signing key now — it is shown only once.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create webhook.");
    }
  };

  const handleTest = async (webhook: Webhook) => {
    setError(null);
    setNotice(null);
    try {
      await testWebhook.mutateAsync(webhook.id);
      setNotice(
        `Test event queued for "${webhook.name}". Tap Refresh status in a moment to confirm delivery.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not queue webhook test.");
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    setNotice(null);
    try {
      await deleteWebhook.mutateAsync(id);
      if (issuedWebhook?.id === id) {
        setIssuedWebhook(null);
      }
      setConfirmDeleteId(null);
      setNotice("Webhook deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete webhook.");
    }
  };

  const webhooks = webhooksQuery.data ?? [];
  const failingCount = webhooks.filter((w) => w.failing).length;

  return (
    <View style={styles.root} testID="webhooks-panel">
      <View style={[styles.layout, isDesktop && styles.layoutDesktop]}>
        {/* Add Webhook */}
        <Card style={isDesktop ? styles.formColumn : undefined}>
          <Text style={styles.sectionTitle}>Add Outgoing Webhook</Text>
          <Text style={styles.muted}>
            Send signed JSON events (<Text style={styles.mono}>batch.status_changed</Text>,{" "}
            <Text style={styles.mono}>reading.logged</Text>,{" "}
            <Text style={styles.mono}>reminder.due</Text>) for{" "}
            <Text style={styles.strong}>{scopeLabel}</Text> to your own receiver.
          </Text>

          <TextField
            label="Webhook Name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Brew House Alerts"
            testID="webhook-name-input"
          />

          <TextField
            label="Destination URL"
            value={url}
            onChangeText={setUrl}
            placeholder="https://hooks.example.com/brew-bruvs"
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            helper="Public http:// or https:// URL only (private and local network addresses are blocked). Payloads are signed with HMAC-SHA256 in the Brew-Bruvs-Signature header."
            testID="webhook-url-input"
          />

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Event Scope</Text>
            <View style={styles.scopeList} testID="webhook-batch-picker">
              <Pressable
                onPress={() => setSelectedBatchId(null)}
                accessibilityRole="radio"
                accessibilityLabel={`All batches in ${scopeLabel}`}
                accessibilityState={{ checked: effectiveSelectedBatchId === null }}
                testID="webhook-batch-all"
                style={[
                  styles.scopeOption,
                  effectiveSelectedBatchId === null && styles.scopeOptionActive,
                ]}
              >
                <Text
                  style={[
                    styles.scopeOptionTitle,
                    effectiveSelectedBatchId === null && styles.scopeOptionTitleActive,
                  ]}
                >
                  All batches ({scopeLabel})
                </Text>
                <Text style={styles.mutedSmall}>
                  Receive events for every batch owned by {scopeLabel}.
                </Text>
              </Pressable>

              {ownerBatches.map((batch) => {
                const selected = effectiveSelectedBatchId === batch.id;
                return (
                  <Pressable
                    key={batch.id}
                    onPress={() => setSelectedBatchId(batch.id)}
                    accessibilityRole="radio"
                    accessibilityLabel={`Only batch ${batch.name}`}
                    accessibilityState={{ checked: selected }}
                    testID={`webhook-batch-option-${batch.id}`}
                    style={[styles.scopeOption, selected && styles.scopeOptionActive]}
                  >
                    <Text
                      style={[styles.scopeOptionTitle, selected && styles.scopeOptionTitleActive]}
                    >
                      Only: {batch.name}
                    </Text>
                    <Text style={styles.mutedSmall}>{formatBatchStatus(batch.status)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {error ? <Banner tone="error" message={error} testID="webhook-error" /> : null}
          {notice ? <Banner tone="success" message={notice} testID="webhook-notice" /> : null}

          <Button
            label={createWebhook.isPending ? "Adding webhook..." : "Add webhook"}
            disabled={createWebhook.isPending}
            onPress={() => void handleCreate()}
            testID="webhook-create-button"
          />
        </Card>

        {/* Signing Key Reveal + Webhooks List */}
        <View style={isDesktop ? styles.listColumn : styles.stack}>
          {issuedWebhook ? (
            <Card style={styles.secretCard} testID="issued-webhook-secret">
              <Text style={styles.secretTitle}>
                Webhook Signing Key — {issuedWebhook.name} (shown once)
              </Text>
              <Text style={styles.mutedSmall}>
                Verify incoming requests with HMAC-SHA256 using this key against the raw request
                body and the <Text style={styles.mono}>Brew-Bruvs-Signature</Text> header (
                <Text style={styles.mono}>sha256=&lt;hex&gt;</Text>).
              </Text>
              <Text selectable style={styles.secretValue} testID="issued-webhook-key">
                {issuedWebhook.signingKey}
              </Text>
              <View style={styles.secretActions}>
                <Button
                  label="Copy signing key"
                  variant="secondary"
                  onPress={() => {
                    void copyOrShareSecret("Webhook signing key", issuedWebhook.signingKey).then(
                      setNotice,
                    );
                  }}
                  testID="copy-webhook-key-button"
                />
                <Button
                  label="Dismiss"
                  variant="ghost"
                  onPress={() => setIssuedWebhook(null)}
                  testID="dismiss-webhook-secret-button"
                />
              </View>
            </Card>
          ) : null}

          <Card>
            <View style={styles.listHeader}>
              <View style={styles.listHeaderText}>
                <Text style={styles.sectionTitle}>Configured Webhooks ({webhooks.length})</Text>
                <Text style={styles.mutedSmall}>Scope: {scopeLabel}</Text>
              </View>
              <Button
                label={webhooksQuery.isFetching ? "Refreshing..." : "Refresh status"}
                variant="secondary"
                disabled={webhooksQuery.isFetching}
                onPress={() => void webhooksQuery.refetch()}
                testID="webhooks-refresh-button"
              />
            </View>

            {failingCount > 0 ? (
              <Banner
                tone="error"
                message={
                  failingCount === 1
                    ? "1 webhook is currently failing after retries. Check the endpoint URL or send a test delivery after fixing your receiver."
                    : `${failingCount} webhooks are currently failing after retries. Check the endpoint URLs or send test deliveries after fixing your receivers.`
                }
                testID="webhooks-failing-summary"
              />
            ) : null}

            {webhooksQuery.isPending ? (
              <Banner tone="info" message="Loading webhooks..." />
            ) : webhooksQuery.isError ? (
              <Banner
                tone="error"
                message={
                  webhooksQuery.error instanceof Error
                    ? webhooksQuery.error.message
                    : "Could not load webhooks."
                }
              />
            ) : webhooks.length === 0 ? (
              <Text style={styles.muted} testID="webhooks-empty">
                No outgoing webhooks configured for {scopeLabel} yet.
              </Text>
            ) : (
              <View style={styles.list} testID="webhooks-list">
                {webhooks.map((webhook) => {
                  const batch = webhook.batchId ? (batchById.get(webhook.batchId) ?? null) : null;
                  const isConfirming = confirmDeleteId === webhook.id;
                  const isTesting = testWebhook.isPending && testWebhook.variables === webhook.id;
                  const isDeleting =
                    deleteWebhook.isPending && deleteWebhook.variables === webhook.id;

                  return (
                    <View
                      key={webhook.id}
                      style={[styles.webhookCard, webhook.failing && styles.webhookCardFailing]}
                      testID={`webhook-card-${webhook.id}`}
                    >
                      <View style={styles.webhookHeader}>
                        <View style={styles.webhookTitleCol}>
                          <Text style={styles.webhookName}>{webhook.name}</Text>
                          <Text selectable style={styles.webhookUrl}>
                            {webhook.url}
                          </Text>
                          <Text style={styles.mutedSmall}>
                            Scope:{" "}
                            {webhook.batchId
                              ? `Batch: ${batch ? batch.name : webhook.batchId}`
                              : `All ${scopeLabel} batches`}
                          </Text>
                        </View>

                        <View
                          style={[
                            styles.statusBadge,
                            webhook.failing
                              ? styles.statusFailing
                              : webhook.lastDeliveredAt
                                ? styles.statusHealthy
                                : styles.statusIdle,
                          ]}
                          testID={`webhook-status-${webhook.id}`}
                        >
                          <Text
                            style={[
                              styles.statusBadgeText,
                              webhook.failing
                                ? styles.statusTextFailing
                                : webhook.lastDeliveredAt
                                  ? styles.statusTextHealthy
                                  : styles.statusTextIdle,
                            ]}
                          >
                            {webhook.failing
                              ? "Failing"
                              : webhook.lastDeliveredAt
                                ? "Healthy"
                                : "Pending first delivery"}
                          </Text>
                        </View>
                      </View>

                      <Text style={styles.mutedSmall}>
                        {webhook.lastDeliveredAt
                          ? `Last delivered: ${formatDateTime(webhook.lastDeliveredAt)}`
                          : "No successful deliveries recorded yet."}
                      </Text>

                      {webhook.failing ? (
                        <Banner
                          tone="error"
                          message="Delivery failed after automatic retries with backoff. Make sure this URL responds with a 2xx status (no redirects) and tap Send test."
                          testID={`webhook-failure-banner-${webhook.id}`}
                        />
                      ) : null}

                      <View style={styles.inlineActions}>
                        <Button
                          label={isTesting ? "Queueing test..." : "Send test"}
                          variant="secondary"
                          disabled={isTesting || isDeleting}
                          onPress={() => void handleTest(webhook)}
                          accessibilityLabel={`Send test event to ${webhook.name}`}
                          testID={`webhook-test-${webhook.id}`}
                        />
                        {isConfirming ? (
                          <>
                            <Button
                              label={isDeleting ? "Deleting..." : "Confirm delete"}
                              variant="secondary"
                              disabled={isDeleting}
                              onPress={() => void handleDelete(webhook.id)}
                              accessibilityLabel={`Confirm delete webhook ${webhook.name}`}
                              testID={`webhook-confirm-delete-${webhook.id}`}
                            />
                            <Button
                              label="Cancel"
                              variant="ghost"
                              onPress={() => setConfirmDeleteId(null)}
                            />
                          </>
                        ) : (
                          <Button
                            label="Delete"
                            variant="ghost"
                            disabled={isTesting || isDeleting}
                            onPress={() => setConfirmDeleteId(webhook.id)}
                            accessibilityLabel={`Delete webhook ${webhook.name}`}
                            testID={`webhook-delete-${webhook.id}`}
                          />
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </Card>
        </View>
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: { gap: spacing.lg },
    stack: { gap: spacing.lg },
    layout: { gap: spacing.lg },
    layoutDesktop: { flexDirection: "row", alignItems: "flex-start" },
    formColumn: { flex: 1 },
    listColumn: { flex: 1.25, gap: spacing.lg },
    sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
    muted: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
    mutedSmall: { fontSize: 12, lineHeight: 17, color: colors.textMuted },
    strong: { fontWeight: "700", color: colors.text },
    mono: { fontWeight: "600", color: colors.text },
    fieldGroup: { gap: spacing.xs },
    fieldLabel: { fontSize: 14, fontWeight: "600", color: colors.text },
    scopeList: { gap: spacing.xs },
    scopeOption: {
      padding: spacing.sm,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceSubtle,
      gap: 2,
    },
    scopeOptionActive: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    scopeOptionTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
    scopeOptionTitleActive: { color: colors.accentPressed },
    secretCard: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.accent,
    },
    secretTitle: { fontSize: 15, fontWeight: "700", color: colors.accentPressed },
    secretValue: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.text,
      padding: spacing.sm,
      borderRadius: radii.sm,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    secretActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
    listHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    listHeaderText: { flex: 1, minWidth: 180, gap: 2 },
    list: { gap: spacing.md },
    webhookCard: {
      padding: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.surfaceSubtle,
      borderWidth: 1,
      borderColor: colors.border,
      gap: spacing.sm,
    },
    webhookCardFailing: {
      borderColor: colors.error,
    },
    webhookHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    webhookTitleCol: { flex: 1, minWidth: 180, gap: 4 },
    webhookName: { fontSize: 16, fontWeight: "700", color: colors.text },
    webhookUrl: { fontSize: 12, fontWeight: "600", color: colors.accentPressed },
    statusBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radii.pill,
    },
    statusHealthy: { backgroundColor: colors.successSoft },
    statusFailing: { backgroundColor: colors.errorSoft },
    statusIdle: { backgroundColor: colors.surface },
    statusBadgeText: { fontSize: 12, fontWeight: "700" },
    statusTextHealthy: { color: colors.success },
    statusTextFailing: { color: colors.error },
    statusTextIdle: { color: colors.textMuted },
    inlineActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  });
