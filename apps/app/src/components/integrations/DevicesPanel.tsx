// SPDX-License-Identifier: AGPL-3.0-or-later
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { type Batch, useBatches, useBatchReadings } from "../../api/batches";
import type { Brewery } from "../../api/breweries";
import {
  type Device,
  type DeviceKind,
  extractDeviceToken,
  type IssuedDevice,
  type TiltColor,
  useCreateDevice,
  useDevices,
  useRevokeDevice,
  useRotateDeviceToken,
} from "../../api/integrations";
import { canPerformOnOwner, formatOwnerLabel } from "../../state/permissions";
import { useThemedStyles } from "../../state/theme";
import { useUnits } from "../../state/units";
import { DESKTOP_BREAKPOINT, radii, spacing, type ThemeColors } from "../../theme";
import { formatBatchStatus, formatDateTime, formatTemperature } from "../batches/batchFlows";
import { Banner, Button, Card, SegmentedControl, TextField } from "../ui";
import { copyOrShareSecret } from "./clipboard";

export interface DevicesPanelProps {
  serverUrl: string;
  authToken: string | null;
  currentUserId: string;
  breweries: readonly Brewery[];
  initialBatchId?: string | null;
  onOpenBatch?: (batchId: string) => void;
  onCreateBatch?: () => void;
  customFetch?: typeof fetch;
}

const DEVICE_KIND_OPTIONS: readonly {
  value: DeviceKind;
  label: string;
  accessibilityLabel: string;
}[] = [
  { value: "ispindel", label: "iSpindel", accessibilityLabel: "iSpindel hydrometer" },
  { value: "gravitymon", label: "GravityMon", accessibilityLabel: "GravityMon hydrometer" },
  { value: "tilt", label: "Tilt", accessibilityLabel: "Tilt via TiltBridge or TiltPi" },
  { value: "rapt", label: "RAPT", accessibilityLabel: "RAPT Pill hydrometer" },
];

const DEVICE_KIND_LABELS: Record<DeviceKind, string> = {
  ispindel: "iSpindel",
  gravitymon: "GravityMon",
  tilt: "Tilt (TiltBridge / TiltPi)",
  rapt: "RAPT Pill",
};

const DEVICE_KIND_HINTS: Record<DeviceKind, string> = {
  ispindel:
    "Paste the upload URL as an HTTP Generic endpoint in iSpindel configuration (POST JSON).",
  gravitymon:
    "Paste the upload URL into GravityMon HTTP Post settings. Temperature-corrected gravity is read automatically.",
  tilt: "Paste the upload URL into TiltBridge or TiltPi Custom Cloud URL. Optionally pick a Tilt color if one bridge forwards multiple Tilts.",
  rapt: "Paste the upload URL into your RAPT Portal webhook / custom telemetry destination (POST JSON).",
};

const TILT_COLORS: readonly TiltColor[] = [
  "red",
  "green",
  "black",
  "purple",
  "orange",
  "blue",
  "yellow",
  "pink",
];

function isFinishedBatch(status: Batch["status"]): boolean {
  return status === "finished" || status === "packaged" || status === "bottled";
}

function DeviceRow({
  device,
  batch,
  canManage,
  serverUrl,
  authToken,
  onRotate,
  onRevoke,
  onOpenBatch,
  rotating,
  revoking,
  customFetch,
}: {
  device: Device;
  batch: Batch | null;
  canManage: boolean;
  serverUrl: string;
  authToken: string | null;
  onRotate: (id: string) => void;
  onRevoke: (id: string) => void;
  onOpenBatch?: (batchId: string) => void;
  rotating: boolean;
  revoking: boolean;
  customFetch?: typeof fetch;
}) {
  const styles = useThemedStyles(createStyles);
  const { unitSystem } = useUnits();
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const readingsQuery = useBatchReadings(serverUrl, authToken, device.batchId, customFetch);

  const latestDeviceReading = useMemo(() => {
    const list = readingsQuery.data ?? [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const entry = list[i];
      if (entry && entry.source === "device") {
        return entry;
      }
    }
    return null;
  }, [readingsQuery.data]);

  const hasSeen = Boolean(device.lastSeenAt || latestDeviceReading);

  return (
    <View style={styles.deviceCard} testID={`device-card-${device.id}`}>
      <View style={styles.deviceHeader}>
        <View style={styles.deviceTitleCol}>
          <View style={styles.badgeRow}>
            <Text style={styles.deviceName}>{device.name}</Text>
            <View style={styles.kindBadge}>
              <Text style={styles.kindBadgeText}>{DEVICE_KIND_LABELS[device.kind]}</Text>
            </View>
            {device.tiltColor ? (
              <View style={styles.colorBadge}>
                <Text style={styles.colorBadgeText}>Tilt: {device.tiltColor}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.mutedSmall}>
            Linked batch:{" "}
            {batch
              ? `${batch.name} (${formatBatchStatus(batch.status)})`
              : device.batchId
                ? device.batchId
                : "None"}
          </Text>
        </View>

        <View
          style={[styles.statusBadge, hasSeen ? styles.statusBadgeSeen : styles.statusBadgeWaiting]}
          testID={`device-status-${device.id}`}
        >
          <Text
            style={[
              styles.statusBadgeText,
              hasSeen ? styles.statusBadgeTextSeen : styles.statusBadgeTextWaiting,
            ]}
          >
            {device.lastSeenAt
              ? `Last seen ${formatDateTime(device.lastSeenAt)}`
              : latestDeviceReading
                ? `Reading received ${formatDateTime(latestDeviceReading.takenAt)}`
                : "Waiting for reading"}
          </Text>
        </View>
      </View>

      <View style={styles.readingBox} testID={`device-last-reading-${device.id}`}>
        {latestDeviceReading ? (
          <View style={styles.readingSummary}>
            <Text style={styles.readingLabel}>Latest device reading</Text>
            <View style={styles.metricsRow}>
              {latestDeviceReading.gravitySg != null ? (
                <View style={styles.metricPill}>
                  <Text style={styles.metricText}>
                    {latestDeviceReading.gravitySg.toFixed(3)} SG
                  </Text>
                </View>
              ) : null}
              {latestDeviceReading.temperatureC != null ? (
                <View style={styles.metricPill}>
                  <Text style={styles.metricText}>
                    {formatTemperature(latestDeviceReading.temperatureC, unitSystem)}
                  </Text>
                </View>
              ) : null}
              <Text style={styles.mutedSmall}>{formatDateTime(latestDeviceReading.takenAt)}</Text>
            </View>
          </View>
        ) : readingsQuery.isPending && device.batchId ? (
          <Text style={styles.mutedSmall}>Checking batch readings...</Text>
        ) : (
          <Text style={styles.mutedSmall}>
            No device reading recorded on this batch yet. Post a payload to the device URL and tap
            Refresh readings.
          </Text>
        )}
      </View>

      <View style={styles.deviceActions}>
        {device.batchId && onOpenBatch ? (
          <Button
            label="View batch chart"
            variant="secondary"
            onPress={() => onOpenBatch(device.batchId as string)}
            accessibilityLabel={`View fermentation chart for ${batch?.name ?? "linked batch"}`}
            testID={`device-open-batch-${device.id}`}
          />
        ) : null}

        {canManage ? (
          <>
            <Button
              label={rotating ? "Rotating..." : "Rotate token"}
              variant="secondary"
              disabled={rotating || revoking}
              onPress={() => onRotate(device.id)}
              accessibilityLabel={`Rotate secret token for ${device.name}`}
              testID={`device-rotate-${device.id}`}
            />
            {confirmRevoke ? (
              <>
                <Button
                  label={revoking ? "Revoking..." : "Confirm revoke"}
                  variant="secondary"
                  disabled={revoking}
                  onPress={() => {
                    setConfirmRevoke(false);
                    onRevoke(device.id);
                  }}
                  accessibilityLabel={`Confirm revoke ${device.name}`}
                  testID={`device-confirm-revoke-${device.id}`}
                />
                <Button label="Cancel" variant="ghost" onPress={() => setConfirmRevoke(false)} />
              </>
            ) : (
              <Button
                label="Revoke"
                variant="ghost"
                disabled={rotating || revoking}
                onPress={() => setConfirmRevoke(true)}
                accessibilityLabel={`Revoke ${device.name}`}
                testID={`device-revoke-${device.id}`}
              />
            )}
          </>
        ) : null}
      </View>
    </View>
  );
}

export function DevicesPanel({
  serverUrl,
  authToken,
  currentUserId,
  breweries,
  initialBatchId = null,
  onOpenBatch,
  onCreateBatch,
  customFetch,
}: DevicesPanelProps) {
  const styles = useThemedStyles(createStyles);
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;
  const queryClient = useQueryClient();

  const devicesQuery = useDevices(serverUrl, authToken, true, customFetch);
  const batchesQuery = useBatches(serverUrl, authToken, { enabled: true }, customFetch);
  const createDevice = useCreateDevice(serverUrl, authToken, customFetch);
  const rotateDevice = useRotateDeviceToken(serverUrl, authToken, customFetch);
  const revokeDevice = useRevokeDevice(serverUrl, authToken, customFetch);

  const allBatches = batchesQuery.data ?? [];
  const batchById = useMemo(() => {
    const map = new Map<string, Batch>();
    for (const b of allBatches) {
      map.set(b.id, b);
    }
    return map;
  }, [allBatches]);

  const editableBatches = useMemo(() => {
    const allowed = allBatches.filter((b) =>
      canPerformOnOwner(currentUserId, breweries, b.owner, "edit"),
    );
    return [...allowed].sort((a, b) => {
      const aDone = isFinishedBatch(a.status) ? 1 : 0;
      const bDone = isFinishedBatch(b.status) ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [allBatches, breweries, currentUserId]);

  const [name, setName] = useState("");
  const [kind, setKind] = useState<DeviceKind>("ispindel");
  const [tiltColor, setTiltColor] = useState<TiltColor | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string>(initialBatchId ?? "");
  const appliedInitialBatchRef = useRef<string | null>(initialBatchId);
  const [issuedDevice, setIssuedDevice] = useState<IssuedDevice | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (initialBatchId && initialBatchId !== appliedInitialBatchRef.current) {
      appliedInitialBatchRef.current = initialBatchId;
      setSelectedBatchId(initialBatchId);
      return;
    }
    if (editableBatches.length === 0) return;
    if (!selectedBatchId || !editableBatches.some((b) => b.id === selectedBatchId)) {
      setSelectedBatchId(editableBatches[0]?.id ?? "");
    }
  }, [editableBatches, initialBatchId, selectedBatchId]);

  const handleCreate = async () => {
    setError(null);
    setNotice(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter a name for this device (e.g. Fermenter 1 iSpindel).");
      return;
    }
    if (!selectedBatchId) {
      setError("Select a batch to link this device to.");
      return;
    }
    try {
      const issued = await createDevice.mutateAsync({
        name: trimmedName,
        kind,
        batchId: selectedBatchId,
        ...(kind === "tilt" && tiltColor ? { tiltColor } : {}),
      });
      setIssuedDevice(issued);
      setName("");
      setTiltColor(null);
      setNotice("Device created. Copy the upload URL and token now — they are shown only once.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add device.");
    }
  };

  const handleRotate = async (id: string) => {
    setError(null);
    setNotice(null);
    try {
      const rotated = await rotateDevice.mutateAsync(id);
      setIssuedDevice(rotated);
      setNotice(
        "Device token rotated. Update your device firmware with the new URL/token — the previous token is now revoked.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rotate device token.");
    }
  };

  const handleRevoke = async (id: string) => {
    setError(null);
    setNotice(null);
    try {
      await revokeDevice.mutateAsync(id);
      if (issuedDevice?.id === id) {
        setIssuedDevice(null);
      }
      setNotice("Device revoked. Future uploads with its old token will be rejected.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke device.");
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["integrations-devices", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["batch-readings", serverUrl] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const devices = devicesQuery.data ?? [];
  const issuedToken = issuedDevice ? extractDeviceToken(issuedDevice.url) : null;

  return (
    <View style={styles.root} testID="devices-panel">
      <View style={[styles.layout, isDesktop && styles.layoutDesktop]}>
        {/* Add a Device */}
        <Card style={isDesktop ? styles.formColumn : undefined}>
          <Text style={styles.sectionTitle}>Add a Hydrometer Device</Text>
          <Text style={styles.muted}>
            Generate a secret upload URL for a wireless hydrometer. Readings arrive directly on the
            linked batch without needing your account password.
          </Text>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Device Type</Text>
            <SegmentedControl
              options={DEVICE_KIND_OPTIONS}
              value={kind}
              onChange={(next) => {
                setKind(next);
                if (next !== "tilt") setTiltColor(null);
              }}
              accessibilityLabel="Hydrometer device kind"
              compact
            />
            <Text style={styles.mutedSmall}>{DEVICE_KIND_HINTS[kind]}</Text>
          </View>

          <TextField
            label="Device Name"
            value={name}
            onChangeText={setName}
            placeholder={
              kind === "tilt"
                ? "e.g. Pink Tilt #1"
                : kind === "rapt"
                  ? "e.g. RAPT Pill Yellow"
                  : "e.g. Fermenter 1 iSpindel"
            }
            testID="device-name-input"
          />

          {kind === "tilt" ? (
            <View style={styles.fieldGroup} testID="tilt-color-picker">
              <Text style={styles.fieldLabel}>Tilt Color Filter (optional)</Text>
              <Text style={styles.mutedSmall}>
                Select a color if your TiltBridge or TiltPi forwards multiple Tilts to this URL.
              </Text>
              <View style={styles.pillWrap}>
                <Pressable
                  onPress={() => setTiltColor(null)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: tiltColor === null }}
                  testID="tilt-color-any"
                  style={[styles.choicePill, tiltColor === null && styles.choicePillActive]}
                >
                  <Text
                    style={[
                      styles.choicePillText,
                      tiltColor === null && styles.choicePillTextActive,
                    ]}
                  >
                    Any color
                  </Text>
                </Pressable>
                {TILT_COLORS.map((color) => {
                  const selected = tiltColor === color;
                  return (
                    <Pressable
                      key={color}
                      onPress={() => setTiltColor(color)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      testID={`tilt-color-${color}`}
                      style={[styles.choicePill, selected && styles.choicePillActive]}
                    >
                      <Text
                        style={[styles.choicePillText, selected && styles.choicePillTextActive]}
                      >
                        {color.charAt(0).toUpperCase() + color.slice(1)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Linked Batch</Text>
            {batchesQuery.isPending ? (
              <Banner tone="info" message="Loading batches..." />
            ) : editableBatches.length === 0 ? (
              <View style={styles.emptyBatchBox}>
                <Text style={styles.mutedSmall}>
                  You need at least one personal or editable brewery batch before linking a device.
                </Text>
                {onCreateBatch ? (
                  <Button
                    label="Start a batch"
                    variant="secondary"
                    onPress={onCreateBatch}
                    testID="devices-start-batch-button"
                  />
                ) : null}
              </View>
            ) : (
              <View style={styles.batchList} testID="device-batch-picker">
                {editableBatches.map((batch) => {
                  const selected = selectedBatchId === batch.id;
                  const ownerInfo = formatOwnerLabel(batch.owner, currentUserId, breweries);
                  return (
                    <Pressable
                      key={batch.id}
                      onPress={() => setSelectedBatchId(batch.id)}
                      accessibilityRole="radio"
                      accessibilityLabel={`Link batch ${batch.name}`}
                      accessibilityState={{ checked: selected }}
                      aria-checked={selected}
                      testID={`device-batch-option-${batch.id}`}
                      style={[styles.batchOption, selected && styles.batchOptionActive]}
                    >
                      <Text
                        style={[styles.batchOptionTitle, selected && styles.batchOptionTitleActive]}
                      >
                        {batch.name}
                      </Text>
                      <Text style={styles.mutedSmall}>
                        {formatBatchStatus(batch.status)} · {ownerInfo.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          {error ? <Banner tone="error" message={error} testID="device-error" /> : null}
          {notice ? <Banner tone="success" message={notice} testID="device-notice" /> : null}

          <Button
            label={createDevice.isPending ? "Creating device..." : "Create device & get URL"}
            disabled={createDevice.isPending || editableBatches.length === 0}
            onPress={() => void handleCreate()}
            testID="device-create-button"
          />
        </Card>

        {/* Issued Credentials + Connected Devices */}
        <View style={isDesktop ? styles.listColumn : styles.stack}>
          {issuedDevice ? (
            <Card style={styles.secretCard} testID="issued-device-secret">
              <Text style={styles.secretTitle}>
                Device Upload URL & Token — {issuedDevice.name} (shown once)
              </Text>
              <Text style={styles.mutedSmall}>
                Keep this URL and token private. Anyone with it can post readings to the linked
                batch.
              </Text>

              <View style={styles.fieldGroup}>
                <Text style={styles.secretLabel}>Upload URL</Text>
                <Text selectable style={styles.secretValue} testID="issued-device-url">
                  {issuedDevice.url}
                </Text>
              </View>

              {issuedToken ? (
                <View style={styles.fieldGroup}>
                  <Text style={styles.secretLabel}>Device Token</Text>
                  <Text selectable style={styles.secretValue} testID="issued-device-token">
                    {issuedToken}
                  </Text>
                </View>
              ) : null}

              <View style={styles.secretActions}>
                <Button
                  label="Copy URL"
                  variant="secondary"
                  onPress={() => {
                    void copyOrShareSecret("Device upload URL", issuedDevice.url).then(setNotice);
                  }}
                  testID="copy-device-url-button"
                />
                {issuedToken ? (
                  <Button
                    label="Copy token"
                    variant="secondary"
                    onPress={() => {
                      void copyOrShareSecret("Device token", issuedToken).then(setNotice);
                    }}
                    testID="copy-device-token-button"
                  />
                ) : null}
                <Button
                  label="Dismiss"
                  variant="ghost"
                  onPress={() => setIssuedDevice(null)}
                  testID="dismiss-device-secret-button"
                />
              </View>
            </Card>
          ) : null}

          <Card>
            <View style={styles.listHeader}>
              <View style={styles.listHeaderText}>
                <Text style={styles.sectionTitle}>Connected Devices ({devices.length})</Text>
                <Text style={styles.mutedSmall}>
                  Readings posted to a device URL appear on the linked batch chart automatically.
                </Text>
              </View>
              <Button
                label={refreshing ? "Refreshing..." : "Refresh readings"}
                variant="secondary"
                disabled={refreshing}
                onPress={() => void handleRefresh()}
                testID="devices-refresh-button"
              />
            </View>

            {devicesQuery.isPending ? (
              <Banner tone="info" message="Loading devices..." />
            ) : devicesQuery.isError ? (
              <Banner
                tone="error"
                message={
                  devicesQuery.error instanceof Error
                    ? devicesQuery.error.message
                    : "Could not load device integrations."
                }
              />
            ) : devices.length === 0 ? (
              <Text style={styles.muted} testID="devices-empty">
                No hydrometer devices connected yet. Add one to generate an upload URL.
              </Text>
            ) : (
              <View style={styles.deviceList} testID="devices-list">
                {devices.map((device) => {
                  const linkedBatch = device.batchId
                    ? (batchById.get(device.batchId) ?? null)
                    : null;
                  const canManage = linkedBatch
                    ? canPerformOnOwner(currentUserId, breweries, linkedBatch.owner, "edit")
                    : true;
                  return (
                    <DeviceRow
                      key={device.id}
                      device={device}
                      batch={linkedBatch}
                      canManage={canManage}
                      serverUrl={serverUrl}
                      authToken={authToken}
                      onRotate={(id) => void handleRotate(id)}
                      onRevoke={(id) => void handleRevoke(id)}
                      {...(onOpenBatch ? { onOpenBatch } : {})}
                      rotating={rotateDevice.isPending && rotateDevice.variables === device.id}
                      revoking={revokeDevice.isPending && revokeDevice.variables === device.id}
                      {...(customFetch ? { customFetch } : {})}
                    />
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
    fieldGroup: { gap: spacing.xs },
    fieldLabel: { fontSize: 14, fontWeight: "600", color: colors.text },
    pillWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
    choicePill: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surface,
    },
    choicePillActive: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.accent,
    },
    choicePillText: { fontSize: 12, fontWeight: "600", color: colors.textMuted },
    choicePillTextActive: { color: colors.accentPressed },
    emptyBatchBox: {
      padding: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.surfaceSubtle,
      borderWidth: 1,
      borderColor: colors.border,
      gap: spacing.sm,
    },
    batchList: { gap: spacing.xs },
    batchOption: {
      padding: spacing.sm,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceSubtle,
      gap: 2,
    },
    batchOptionActive: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    batchOptionTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
    batchOptionTitleActive: { color: colors.accentPressed },
    secretCard: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.accent,
    },
    secretTitle: { fontSize: 15, fontWeight: "700", color: colors.accentPressed },
    secretLabel: { fontSize: 12, fontWeight: "700", color: colors.accentPressed },
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
    deviceList: { gap: spacing.md },
    deviceCard: {
      padding: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.surfaceSubtle,
      borderWidth: 1,
      borderColor: colors.border,
      gap: spacing.sm,
    },
    deviceHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    deviceTitleCol: { flex: 1, minWidth: 180, gap: 4 },
    badgeRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
    deviceName: { fontSize: 16, fontWeight: "700", color: colors.text },
    kindBadge: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radii.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    kindBadgeText: { fontSize: 11, fontWeight: "700", color: colors.textMuted },
    colorBadge: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radii.pill,
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: colors.accent,
    },
    colorBadgeText: { fontSize: 11, fontWeight: "700", color: colors.accentPressed },
    statusBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radii.pill,
    },
    statusBadgeSeen: { backgroundColor: colors.successSoft },
    statusBadgeWaiting: { backgroundColor: colors.surface },
    statusBadgeText: { fontSize: 12, fontWeight: "700" },
    statusBadgeTextSeen: { color: colors.success },
    statusBadgeTextWaiting: { color: colors.textMuted },
    readingBox: {
      padding: spacing.sm,
      borderRadius: radii.sm,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    readingSummary: { gap: 6 },
    readingLabel: { fontSize: 12, fontWeight: "700", color: colors.textMuted },
    metricsRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.xs },
    metricPill: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radii.pill,
      backgroundColor: colors.accentSoft,
    },
    metricText: { fontSize: 13, fontWeight: "700", color: colors.accentPressed },
    deviceActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  });
