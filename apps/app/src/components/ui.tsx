// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from "react-native";
import { colors, radii, spacing } from "../theme";

export interface CardProps {
  children: ReactNode;
  style?: ViewStyle | undefined;
  testID?: string;
}

export function Card({ children, style, testID }: CardProps) {
  return (
    <View style={[styles.card, style]} testID={testID}>
      {children}
    </View>
  );
}

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  accessibilityLabel,
  testID,
}: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      testID={testID}
      style={({ pressed }) => [
        styles.buttonBase,
        variant === "primary" && styles.buttonPrimary,
        variant === "secondary" && styles.buttonSecondary,
        variant === "ghost" && styles.buttonGhost,
        pressed && !disabled && variant === "primary" && styles.buttonPrimaryPressed,
        pressed && !disabled && variant !== "primary" && styles.buttonSubtlePressed,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          variant === "primary" && styles.buttonTextPrimary,
          variant === "secondary" && styles.buttonTextSecondary,
          variant === "ghost" && styles.buttonTextGhost,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  unit?: string;
  helper?: string;
  error?: string | null;
  keyboardType?: TextInputProps["keyboardType"];
  autoCapitalize?: TextInputProps["autoCapitalize"];
  autoCorrect?: boolean;
  secureTextEntry?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  onSubmitEditing?: () => void;
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  unit,
  helper,
  error,
  keyboardType,
  autoCapitalize = "none",
  autoCorrect = false,
  secureTextEntry = false,
  accessibilityLabel,
  testID,
  onSubmitEditing,
}: TextFieldProps) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.inputWrapper, error ? styles.inputWrapperError : null]}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          secureTextEntry={secureTextEntry}
          accessibilityLabel={accessibilityLabel ?? (unit ? `${label} (${unit})` : label)}
          testID={testID}
          onSubmitEditing={onSubmitEditing}
          style={styles.input}
        />
        {unit ? (
          <View style={styles.unitBadge} accessible={false}>
            <Text style={styles.unitBadgeText}>{unit}</Text>
          </View>
        ) : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {error}
        </Text>
      ) : helper ? (
        <Text style={styles.helperText}>{helper}</Text>
      ) : null}
    </View>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  accessibilityLabel?: string;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
  compact?: boolean;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  compact = false,
}: SegmentedControlProps<T>) {
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={[styles.segmentedTrack, compact && styles.segmentedTrackCompact]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityState={{ selected }}
            style={[
              styles.segmentedItem,
              compact && styles.segmentedItemCompact,
              selected && styles.segmentedItemSelected,
            ]}
          >
            <Text style={[styles.segmentedText, selected && styles.segmentedTextSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export interface ResultRowProps {
  label: string;
  value: string;
  subtitle?: string;
  highlight?: boolean;
  testID?: string;
}

export function ResultRow({ label, value, subtitle, highlight = false, testID }: ResultRowProps) {
  return (
    <View
      style={[styles.resultRow, highlight && styles.resultRowHighlight]}
      accessible
      accessibilityLabel={`${label}: ${value}${subtitle ? `, ${subtitle}` : ""}`}
    >
      <View style={styles.resultLabelColumn}>
        <Text style={[styles.resultLabel, highlight && styles.resultLabelHighlight]}>{label}</Text>
        {subtitle ? <Text style={styles.resultSubtitle}>{subtitle}</Text> : null}
      </View>
      <Text testID={testID} style={[styles.resultValue, highlight && styles.resultValueHighlight]}>
        {value}
      </Text>
    </View>
  );
}

export interface BannerProps {
  tone: "info" | "success" | "error";
  message: string;
  testID?: string;
}

export function Banner({ tone, message, testID }: BannerProps) {
  return (
    <View
      testID={testID}
      accessibilityRole={tone === "error" ? "alert" : "text"}
      style={[
        styles.banner,
        tone === "info" && styles.bannerInfo,
        tone === "success" && styles.bannerSuccess,
        tone === "error" && styles.bannerError,
      ]}
    >
      <Text
        style={[
          styles.bannerText,
          tone === "info" && styles.bannerTextInfo,
          tone === "success" && styles.bannerTextSuccess,
          tone === "error" && styles.bannerTextError,
        ]}
      >
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  buttonBase: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    paddingVertical: 11,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
  },
  buttonPrimaryPressed: {
    backgroundColor: colors.accentPressed,
  },
  buttonSecondary: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  buttonGhost: {
    backgroundColor: "transparent",
  },
  buttonSubtlePressed: {
    opacity: 0.78,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  buttonTextPrimary: {
    color: colors.accentText,
  },
  buttonTextSecondary: {
    color: colors.text,
  },
  buttonTextGhost: {
    color: colors.accent,
  },
  fieldGroup: {
    gap: spacing.xs,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    overflow: "hidden",
  },
  inputWrapperError: {
    borderColor: colors.error,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  unitBadge: {
    flexShrink: 0,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: colors.surfaceSubtle,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    justifyContent: "center",
    minHeight: 44,
  },
  unitBadgeText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textMuted,
  },
  helperText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  errorText: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.error,
  },
  segmentedTrack: {
    flexDirection: "row",
    flexWrap: "wrap",
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.md,
    padding: 3,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentedTrackCompact: {
    flexWrap: "nowrap",
  },
  segmentedItem: {
    flexGrow: 1,
    minHeight: 38,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radii.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentedItemCompact: {
    minHeight: 34,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  segmentedItemSelected: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  segmentedText: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.textMuted,
  },
  segmentedTextSelected: {
    color: colors.text,
    fontWeight: "700",
  },
  resultRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSubtle,
    gap: spacing.md,
  },
  resultRowHighlight: {
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  resultLabelColumn: {
    flex: 1,
    gap: 2,
  },
  resultLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  resultLabelHighlight: {
    color: colors.accentPressed,
  },
  resultSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
  },
  resultValue: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    fontVariant: ["tabular-nums"],
  },
  resultValueHighlight: {
    fontSize: 22,
    color: colors.accentPressed,
  },
  banner: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  bannerInfo: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  bannerSuccess: {
    backgroundColor: colors.successSoft,
    borderColor: colors.success,
  },
  bannerError: {
    backgroundColor: colors.errorSoft,
    borderColor: colors.error,
  },
  bannerText: {
    fontSize: 14,
    lineHeight: 20,
  },
  bannerTextInfo: {
    color: colors.accentPressed,
  },
  bannerTextSuccess: {
    color: colors.success,
  },
  bannerTextError: {
    color: colors.error,
    fontWeight: "500",
  },
});
