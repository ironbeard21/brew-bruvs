// SPDX-License-Identifier: AGPL-3.0-or-later
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radii, spacing } from "../../theme";
import { Card } from "../ui";

export const PRIVACY_POLICY_URL =
  "https://github.com/ironbeard21/brew-bruvs/blob/main/docs/privacy-policy.md";

const POLICY_SECTIONS: readonly { heading: string; bullets: readonly string[] }[] = [
  {
    heading: "1. No tracking, analytics, or ads",
    bullets: [
      "Brew-Bruvs contains no analytics SDKs, no ad networks, no crash-reporting trackers, and no cross-app tracking.",
      "There is no central push notification server. All brew-day timers, batch reminders, and low-stock alerts are scheduled locally on your device.",
    ],
  },
  {
    heading: "2. Your data stays on your own server",
    bullets: [
      "Brew-Bruvs is self-hosted software. Your account, recipes, batches, readings, notes, inventory, equipment, and brewery memberships are sent only to the server address you enter.",
      "The Brew-Bruvs maintainers do not run a central cloud server and never receive your server address, credentials, or brewing data.",
      "When you use the built-in calculators in Offline Mode, the app makes zero network requests.",
    ],
  },
  {
    heading: "3. Local device storage",
    bullets: [
      "Saved server addresses and your session token are stored locally (in iOS Keychain / Android Keystore via Expo SecureStore on mobile) so you stay signed in.",
      "Your unit preference (US or Metric), active workspace selection, and local notification schedule IDs stay on your device.",
      "Signing out clears your session token; disconnecting removes saved server credentials from the device.",
    ],
  },
  {
    heading: "4. Minimal, optional permissions",
    bullets: [
      "Notifications (optional): used solely for local on-device brew-day timers, batch reminders, and low-stock alerts.",
      "Files / Document Picker (on demand): used only when you choose a BeerXML or BeerJSON file to import a recipe.",
      "Brew-Bruvs does not access your location, contacts, camera, microphone, or photo library.",
    ],
  },
];

export function PrivacyPolicyPanel() {
  return (
    <View style={styles.root} testID="privacy-policy-panel">
      <Card>
        <View style={styles.summaryBox} testID="privacy-summary-box">
          <Text style={styles.summaryHeading}>Short version</Text>
          <Text style={styles.body}>
            No tracking, no telemetry, no ads, and no central cloud. Your brewing data stays on the
            self-hosted server you choose — or completely offline on your device when using the
            calculators.
          </Text>
        </View>

        {POLICY_SECTIONS.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.heading}</Text>
            {section.bullets.map((line) => (
              <Text key={line} style={styles.body}>
                • {line}
              </Text>
            ))}
          </View>
        ))}

        <View style={styles.footer}>
          <Text style={styles.muted}>
            Brew-Bruvs is free, open-source software (GNU AGPL-3.0-or-later). Read the published
            policy or inspect the source code anytime:
          </Text>
          <Pressable
            onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
            accessibilityRole="link"
            accessibilityLabel="Open published Brew-Bruvs Privacy Policy"
            testID="privacy-policy-external-link"
          >
            <Text style={styles.link}>{PRIVACY_POLICY_URL}</Text>
          </Pressable>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.lg },
  summaryBox: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.successSoft,
    borderWidth: 1,
    borderColor: colors.success,
    gap: spacing.xs,
  },
  summaryHeading: { fontSize: 15, fontWeight: "800", color: colors.success },
  section: { gap: spacing.xs },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  body: { fontSize: 14, lineHeight: 21, color: colors.text },
  muted: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
  footer: {
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.xs,
  },
  link: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.accent,
    textDecorationLine: "underline",
  },
});
