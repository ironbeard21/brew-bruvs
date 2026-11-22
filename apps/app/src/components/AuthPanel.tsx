// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import {
  type SignedInResponse,
  useAuthStatus,
  useCurrentUser,
  useLogin,
  useLogout,
  useSetupAdmin,
  useSignup,
} from "../api/auth";
import { colors, radii, spacing } from "../theme";
import { Banner, Button, Card, SegmentedControl, TextField } from "./ui";

type AuthMode = "login" | "signup";

const AUTH_MODE_OPTIONS = [
  { value: "login", label: "Sign In", accessibilityLabel: "Sign in to existing account" },
  { value: "signup", label: "Create Account", accessibilityLabel: "Create a new account" },
] as const;

export interface AuthPanelProps {
  serverUrl: string;
  authToken: string | null;
  onTokenChange: (token: string | null) => Promise<void>;
  onOpenCalculators: () => void;
  customFetch?: typeof fetch;
}

export function AuthPanel({
  serverUrl,
  authToken,
  onTokenChange,
  onOpenCalculators,
  customFetch,
}: AuthPanelProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const authStatus = useAuthStatus(serverUrl, customFetch);
  const currentUser = useCurrentUser(serverUrl, authToken, customFetch);

  const handleSignedIn = async (res: SignedInResponse) => {
    if (res.token) {
      await onTokenChange(res.token);
    }
    setPassword("");
    setErrorMessage(null);
  };

  const handleSignedOut = async () => {
    await onTokenChange(null);
    setErrorMessage(null);
  };

  const setupMutation = useSetupAdmin(serverUrl, handleSignedIn, customFetch);
  const loginMutation = useLogin(serverUrl, handleSignedIn, customFetch);
  const signupMutation = useSignup(serverUrl, handleSignedIn, customFetch);
  const logoutMutation = useLogout(serverUrl, authToken, handleSignedOut, customFetch);

  const isBusy =
    setupMutation.isPending ||
    loginMutation.isPending ||
    signupMutation.isPending ||
    logoutMutation.isPending;

  const submitSetup = async () => {
    setErrorMessage(null);
    if (!displayName.trim() || !email.trim() || password.length < 8) {
      setErrorMessage("Enter a display name, email, and a password of at least 8 characters.");
      return;
    }
    try {
      await setupMutation.mutateAsync({ displayName, email, password });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Could not complete first-run setup.");
    }
  };

  const submitLogin = async () => {
    setErrorMessage(null);
    if (!email.trim() || !password) {
      setErrorMessage("Enter both your email and password.");
      return;
    }
    try {
      await loginMutation.mutateAsync({ email, password });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Sign-in failed.");
    }
  };

  const submitSignup = async () => {
    setErrorMessage(null);
    if (!displayName.trim() || !email.trim() || password.length < 8) {
      setErrorMessage("Enter a display name, email, and a password of at least 8 characters.");
      return;
    }
    try {
      await signupMutation.mutateAsync({
        displayName,
        email,
        password,
        ...(inviteCode.trim() ? { inviteCode: inviteCode.trim() } : {}),
      });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Could not create account.");
    }
  };

  const handleLogout = async () => {
    setErrorMessage(null);
    try {
      await logoutMutation.mutateAsync();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Could not sign out.");
    }
  };

  if (currentUser.isPending || authStatus.isPending) {
    return (
      <Card>
        <Text style={styles.sectionTitle}>Account</Text>
        <Banner tone="info" message="Checking server sign-in status..." testID="auth-loading" />
      </Card>
    );
  }

  if (currentUser.data) {
    const user = currentUser.data;
    return (
      <Card>
        <View style={styles.profileHeader}>
          <View style={styles.profileText}>
            <Text style={styles.sectionTitle} testID="signed-in-name">
              {user.displayName}
            </Text>
            <Text style={styles.mutedText} testID="signed-in-email">
              {user.email}
            </Text>
          </View>
          {user.isAdmin ? (
            <View style={styles.adminBadge} accessible accessibilityLabel="Administrator">
              <Text style={styles.adminBadgeText}>Admin</Text>
            </View>
          ) : null}
        </View>

        <Banner
          tone="success"
          message="You are signed in to this server."
          testID="signed-in-banner"
        />

        {errorMessage ? <Banner tone="error" message={errorMessage} testID="auth-error" /> : null}

        <View style={styles.actions}>
          <Button
            label="Open calculators"
            onPress={onOpenCalculators}
            testID="open-calculators-button"
          />
          <Button
            label={logoutMutation.isPending ? "Signing out..." : "Sign out"}
            variant="secondary"
            disabled={isBusy}
            onPress={() => {
              void handleLogout();
            }}
            testID="logout-button"
          />
        </View>
      </Card>
    );
  }

  if (authStatus.isError || !authStatus.data) {
    return (
      <Card>
        <Text style={styles.sectionTitle}>Sign In</Text>
        <Banner
          tone="error"
          message={
            authStatus.error instanceof Error
              ? authStatus.error.message
              : "Could not load sign-in options from this server."
          }
          testID="auth-error"
        />
        <Button
          label="Open offline calculators"
          variant="secondary"
          onPress={onOpenCalculators}
          testID="open-calculators-button"
        />
      </Card>
    );
  }

  const status = authStatus.data;

  if (status.setupNeeded) {
    return (
      <Card>
        <Text style={styles.sectionTitle}>First-Run Admin Setup</Text>
        <Text style={styles.mutedText}>
          This server has no accounts yet. Create the first administrator account to finish setup.
        </Text>

        <TextField
          label="Display Name"
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Head Brewer"
          autoCapitalize="words"
          testID="auth-display-name-input"
        />

        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="admin@example.com"
          keyboardType="email-address"
          testID="auth-email-input"
        />

        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="At least 8 characters"
          secureTextEntry
          testID="auth-password-input"
          onSubmitEditing={() => {
            void submitSetup();
          }}
        />

        {errorMessage ? <Banner tone="error" message={errorMessage} testID="auth-error" /> : null}

        <Button
          label={setupMutation.isPending ? "Creating admin..." : "Create admin account"}
          disabled={isBusy}
          onPress={() => {
            void submitSetup();
          }}
          testID="auth-setup-submit"
        />
      </Card>
    );
  }

  return (
    <Card>
      <Text style={styles.sectionTitle}>{mode === "login" ? "Sign In" : "Create Account"}</Text>

      <SegmentedControl
        options={AUTH_MODE_OPTIONS}
        value={mode}
        onChange={(next) => {
          setMode(next);
          setErrorMessage(null);
        }}
        accessibilityLabel="Account action"
      />

      {mode === "signup" ? (
        <TextField
          label="Display Name"
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Your brewer name"
          autoCapitalize="words"
          testID="auth-display-name-input"
        />
      ) : null}

      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="brewer@example.com"
        keyboardType="email-address"
        testID="auth-email-input"
      />

      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
        secureTextEntry
        testID="auth-password-input"
        onSubmitEditing={() => {
          void (mode === "login" ? submitLogin() : submitSignup());
        }}
      />

      {mode === "signup" && status.signupMode === "invite" ? (
        <TextField
          label="Invite Code"
          value={inviteCode}
          onChangeText={setInviteCode}
          placeholder="Paste your invite code"
          helper="This server requires an invite code to create a new account."
          testID="auth-invite-code-input"
        />
      ) : null}

      {errorMessage ? <Banner tone="error" message={errorMessage} testID="auth-error" /> : null}

      <View style={styles.actions}>
        <Button
          label={
            mode === "login"
              ? loginMutation.isPending
                ? "Signing in..."
                : "Sign in"
              : signupMutation.isPending
                ? "Creating account..."
                : "Create account"
          }
          disabled={isBusy}
          onPress={() => {
            void (mode === "login" ? submitLogin() : submitSignup());
          }}
          testID={mode === "login" ? "auth-login-submit" : "auth-signup-submit"}
        />

        {status.oidcEnabled ? (
          <Button
            label="Sign in with SSO"
            variant="secondary"
            disabled={isBusy}
            onPress={() => {
              void Linking.openURL(`${serverUrl}/api/auth/oidc/login`);
            }}
            testID="auth-oidc-button"
          />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
  },
  mutedText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  profileText: {
    flex: 1,
    gap: 2,
  },
  adminBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  adminBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.accentPressed,
  },
  actions: {
    gap: spacing.sm,
  },
});
