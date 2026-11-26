// SPDX-License-Identifier: AGPL-3.0-or-later
import { useRouter } from "expo-router";
import { View } from "react-native";
import { AppShell } from "../src/components/AppShell";
import { PrivacyPolicyPanel } from "../src/components/settings/PrivacyPolicyPanel";
import { Button } from "../src/components/ui";

export default function PrivacyPolicyScreen() {
  const router = useRouter();
  return (
    <AppShell
      title="Privacy Policy"
      subtitle="No tracking, no telemetry — your brewing data stays on the server you choose."
    >
      <View style={{ alignSelf: "flex-start" }}>
        <Button
          label="← Back"
          variant="ghost"
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace("/about");
            }
          }}
          testID="privacy-back-button"
        />
      </View>
      <PrivacyPolicyPanel />
    </AppShell>
  );
}
