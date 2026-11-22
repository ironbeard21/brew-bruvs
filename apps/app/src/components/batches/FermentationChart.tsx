// SPDX-License-Identifier: AGPL-3.0-or-later
import { abvStandard } from "@brew-bruvs/brew-math";
import { Platform, StyleSheet, Text, View } from "react-native";
import type { Reading } from "../../api/batches";
import { useUnits } from "../../state/units";
import { colors, radii, spacing } from "../../theme";
import { buildChartSeries, formatShortDate } from "./batchFlows";

export interface FermentationChartProps {
  readings: readonly Reading[];
}

const CHART_WIDTH = 640;
const CHART_HEIGHT = 230;
const PAD_LEFT = 54;
const PAD_RIGHT = 52;
const PAD_TOP = 18;
const PAD_BOTTOM = 34;
const PLOT_W = CHART_WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_H = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;

const GRAVITY_COLOR = colors.accent;
const TEMP_COLOR = "#0F766E";

export function FermentationChart({ readings }: FermentationChartProps) {
  const { unitSystem } = useUnits();
  const series = buildChartSeries(readings, unitSystem);
  const { gravityPoints, tempPoints } = series;

  const hasGravity = gravityPoints.length > 0;
  const hasTemp = tempPoints.length > 0;

  if (!hasGravity && !hasTemp) {
    return (
      <View style={styles.emptyBox} testID="fermentation-chart-empty">
        <Text style={styles.emptyTitle}>No fermentation curve yet</Text>
        <Text style={styles.emptyText}>
          Log gravity and temperature readings below to track fermentation over time.
        </Text>
      </View>
    );
  }

  const firstSg = gravityPoints[0]?.sg ?? null;
  const latestSg = gravityPoints[gravityPoints.length - 1]?.sg ?? null;
  const latestTemp = tempPoints[tempPoints.length - 1] ?? null;

  let estimatedAbvText: string | null = null;
  if (firstSg != null && latestSg != null && firstSg > latestSg) {
    const res = abvStandard(firstSg, latestSg);
    if (res.ok) {
      estimatedAbvText = `${res.value.toFixed(2)}%`;
    }
  }

  const sgTicks = [0, 0.5, 1].map((t) => ({
    y: PAD_TOP + (1 - t) * PLOT_H,
    label: (series.sgMin + t * (series.sgMax - series.sgMin)).toFixed(3),
  }));

  const tempTicks = [0, 0.5, 1].map((t) => ({
    y: PAD_TOP + (1 - t) * PLOT_H,
    label: `${Math.round(series.tempMin + t * (series.tempMax - series.tempMin))}${series.tempUnit}`,
  }));

  const toX = (xNorm: number) => PAD_LEFT + xNorm * PLOT_W;
  const toY = (yNorm: number) => PAD_TOP + (1 - yNorm) * PLOT_H;

  const gravityPath = gravityPoints
    .map((p) => `${toX(p.xNorm).toFixed(1)},${toY(p.yNorm).toFixed(1)}`)
    .join(" ");
  const tempPath = tempPoints
    .map((p) => `${toX(p.xNorm).toFixed(1)},${toY(p.yNorm).toFixed(1)}`)
    .join(" ");

  const xLabels: { id: "start" | "end"; x: number; text: string }[] = [];
  if (series.minMs > 0) {
    xLabels.push({
      id: "start",
      x: PAD_LEFT,
      text: formatShortDate(new Date(series.minMs).toISOString()),
    });
    if (series.maxMs > series.minMs) {
      xLabels.push({
        id: "end",
        x: PAD_LEFT + PLOT_W,
        text: formatShortDate(new Date(series.maxMs).toISOString()),
      });
    }
  }

  return (
    <View style={styles.container} testID="fermentation-chart">
      <View style={styles.summaryRow}>
        {latestSg != null ? (
          <View style={styles.statChip}>
            <Text style={styles.statLabel}>Latest SG</Text>
            <Text style={styles.statValue} testID="chart-latest-sg">
              {latestSg.toFixed(3)}
            </Text>
          </View>
        ) : null}
        {estimatedAbvText ? (
          <View style={styles.statChip}>
            <Text style={styles.statLabel}>Est. ABV</Text>
            <Text style={styles.statValue} testID="chart-est-abv">
              {estimatedAbvText}
            </Text>
          </View>
        ) : null}
        {latestTemp ? (
          <View style={styles.statChip}>
            <Text style={styles.statLabel}>Latest Temp</Text>
            <Text style={[styles.statValue, { color: TEMP_COLOR }]} testID="chart-latest-temp">
              {latestTemp.tempDisplay.toFixed(1)} {series.tempUnit}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.legendRow}>
        {hasGravity ? (
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: GRAVITY_COLOR }]} />
            <Text style={styles.legendText}>Gravity (SG) · {gravityPoints.length} pts</Text>
          </View>
        ) : null}
        {hasTemp ? (
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: TEMP_COLOR }]} />
            <Text style={styles.legendText}>
              Temperature ({series.tempUnit}) · {tempPoints.length} pts
            </Text>
          </View>
        ) : null}
      </View>

      {Platform.OS === "web" ? (
        <View style={styles.svgWrapper}>
          <svg
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            role="img"
            aria-label={`Fermentation chart with ${gravityPoints.length} gravity points and ${tempPoints.length} temperature points`}
            style={{
              width: "100%",
              maxHeight: 280,
              height: "auto",
              display: "block",
              fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
            }}
          >
            {/* Horizontal grid lines */}
            {sgTicks.map((tick) => (
              <line
                key={`grid-${tick.label}`}
                x1={PAD_LEFT}
                x2={PAD_LEFT + PLOT_W}
                y1={tick.y}
                y2={tick.y}
                stroke={colors.border}
                strokeDasharray="4 4"
                strokeWidth={1}
              />
            ))}

            {/* Plot frame */}
            <rect
              x={PAD_LEFT}
              y={PAD_TOP}
              width={PLOT_W}
              height={PLOT_H}
              fill="none"
              stroke={colors.borderStrong}
              strokeWidth={1}
            />

            {/* Left Y-axis labels (Gravity SG) */}
            {hasGravity
              ? sgTicks.map((tick) => (
                  <text
                    key={`sg-${tick.label}`}
                    x={PAD_LEFT - 8}
                    y={tick.y + 4}
                    textAnchor="end"
                    fontSize={11}
                    fontWeight={600}
                    fill={GRAVITY_COLOR}
                  >
                    {tick.label}
                  </text>
                ))
              : null}

            {/* Right Y-axis labels (Temperature) */}
            {hasTemp
              ? tempTicks.map((tick) => (
                  <text
                    key={`temp-${tick.label}`}
                    x={PAD_LEFT + PLOT_W + 8}
                    y={tick.y + 4}
                    textAnchor="start"
                    fontSize={11}
                    fontWeight={600}
                    fill={TEMP_COLOR}
                  >
                    {tick.label}
                  </text>
                ))
              : null}

            {/* X-axis date labels */}
            {xLabels.map((lbl) => (
              <text
                key={`x-${lbl.id}`}
                x={lbl.x}
                y={CHART_HEIGHT - 10}
                textAnchor={lbl.id === "start" ? "start" : "end"}
                fontSize={11}
                fill={colors.textMuted}
              >
                {lbl.text}
              </text>
            ))}

            {/* Temperature line & points */}
            {tempPoints.length >= 2 ? (
              <polyline
                fill="none"
                stroke={TEMP_COLOR}
                strokeWidth={2.5}
                strokeDasharray="6 3"
                points={tempPath}
              />
            ) : null}
            {tempPoints.map((pt, idx) => (
              <circle
                key={`temp-pt-${pt.id}`}
                cx={toX(pt.xNorm)}
                cy={toY(pt.yNorm)}
                r={5}
                fill={colors.surface}
                stroke={TEMP_COLOR}
                strokeWidth={2.5}
                data-testid={`chart-temp-point-${idx}`}
                aria-label={`Temperature reading ${pt.tempDisplay.toFixed(1)} ${series.tempUnit} on ${pt.label}`}
              />
            ))}

            {/* Gravity line & points */}
            {gravityPoints.length >= 2 ? (
              <polyline
                fill="none"
                stroke={GRAVITY_COLOR}
                strokeWidth={3}
                strokeLinejoin="round"
                strokeLinecap="round"
                points={gravityPath}
              />
            ) : null}
            {gravityPoints.map((pt, idx) => {
              const cx = toX(pt.xNorm);
              const cy = toY(pt.yNorm);
              return (
                <g key={`grav-pt-${pt.id}`}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={5.5}
                    fill={GRAVITY_COLOR}
                    stroke={colors.surface}
                    strokeWidth={2}
                    data-testid={`chart-gravity-point-${idx}`}
                    aria-label={`Gravity reading ${pt.sg.toFixed(3)} on ${pt.label}`}
                  />
                  <text
                    x={cx}
                    y={Math.max(PAD_TOP + 12, cy - 10)}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={700}
                    fill={colors.text}
                  >
                    {pt.sg.toFixed(3)}
                  </text>
                </g>
              );
            })}
          </svg>
        </View>
      ) : (
        <View style={styles.nativePlot}>
          <View style={styles.nativeAxisCol}>
            <Text style={styles.nativeAxisText}>{series.sgMax.toFixed(3)}</Text>
            <Text style={styles.nativeAxisText}>
              {((series.sgMax + series.sgMin) / 2).toFixed(3)}
            </Text>
            <Text style={styles.nativeAxisText}>{series.sgMin.toFixed(3)}</Text>
          </View>
          <View style={styles.nativeCanvas}>
            {tempPoints.map((pt, idx) => (
              <View
                key={`ntemp-${pt.id}`}
                testID={`chart-temp-point-${idx}`}
                accessibilityLabel={`Temperature reading ${pt.tempDisplay.toFixed(1)} ${series.tempUnit}`}
                style={[
                  styles.nativePointTemp,
                  {
                    left: `${Math.round(pt.xNorm * 88 + 6)}%`,
                    bottom: `${Math.round(pt.yNorm * 82 + 9)}%`,
                  },
                ]}
              />
            ))}
            {gravityPoints.map((pt, idx) => (
              <View
                key={`ngrav-${pt.id}`}
                testID={`chart-gravity-point-${idx}`}
                accessibilityLabel={`Gravity reading ${pt.sg.toFixed(3)}`}
                style={[
                  styles.nativePointGravity,
                  {
                    left: `${Math.round(pt.xNorm * 88 + 6)}%`,
                    bottom: `${Math.round(pt.yNorm * 82 + 9)}%`,
                  },
                ]}
              />
            ))}
          </View>
          <View style={styles.nativeAxisCol}>
            <Text style={[styles.nativeAxisText, { color: TEMP_COLOR }]}>
              {Math.round(series.tempMax)}
              {series.tempUnit}
            </Text>
            <Text style={[styles.nativeAxisText, { color: TEMP_COLOR }]}>
              {Math.round((series.tempMax + series.tempMin) / 2)}
              {series.tempUnit}
            </Text>
            <Text style={[styles.nativeAxisText, { color: TEMP_COLOR }]}>
              {Math.round(series.tempMin)}
              {series.tempUnit}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  emptyBox: {
    padding: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    gap: spacing.xs,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  emptyText: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: "center",
  },
  summaryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  statChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 100,
    gap: 2,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.textMuted,
    textTransform: "uppercase",
  },
  statValue: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.accentPressed,
    fontVariant: ["tabular-nums"],
  },
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 99,
  },
  legendText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  svgWrapper: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xs,
    overflow: "hidden",
  },
  nativePlot: {
    flexDirection: "row",
    alignItems: "stretch",
    height: 180,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  nativeAxisCol: {
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  nativeAxisText: {
    fontSize: 11,
    fontWeight: "600",
    color: GRAVITY_COLOR,
    fontVariant: ["tabular-nums"],
  },
  nativeCanvas: {
    flex: 1,
    position: "relative",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  nativePointGravity: {
    position: "absolute",
    width: 12,
    height: 12,
    marginLeft: -6,
    marginBottom: -6,
    borderRadius: 6,
    backgroundColor: GRAVITY_COLOR,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  nativePointTemp: {
    position: "absolute",
    width: 10,
    height: 10,
    marginLeft: -5,
    marginBottom: -5,
    borderRadius: 5,
    backgroundColor: colors.surface,
    borderWidth: 2.5,
    borderColor: TEMP_COLOR,
  },
});
