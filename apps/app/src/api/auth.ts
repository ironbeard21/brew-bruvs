// SPDX-License-Identifier: AGPL-3.0-or-later
import type { components } from "@brew-bruvs/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Platform } from "react-native";
import { formatApiError, getApiClient } from "./client";

export type AuthUser = components["schemas"]["User"];
export type AuthStatus = components["schemas"]["AuthStatus"];
export type SignedInResponse = components["schemas"]["SignedIn"];
export type UserToken = components["schemas"]["Token"];
export type NewUserToken = components["schemas"]["NewToken"];
export type Invite = components["schemas"]["Invite"];
export type AdminUser = components["schemas"]["AdminUser"];
export type PasswordResetLink = components["schemas"]["PasswordResetLink"];
export type TokenScope = "read" | "write";

export interface UpdateMeInput {
  displayName?: string;
  units?: "us" | "metric";
}

export function getAuthClientKind(): "web" | "app" {
  return Platform.OS === "web" ? "web" : "app";
}

function defaultDeviceName(): string | undefined {
  if (Platform.OS === "web") return undefined;
  return `Brew-Bruvs (${Platform.OS})`;
}

export async function fetchAuthStatus(
  serverUrl: string,
  customFetch?: typeof fetch,
): Promise<AuthStatus> {
  const client = getApiClient(serverUrl, customFetch ? { customFetch } : undefined);
  const { data, error } = await client.GET("/api/auth/status", { credentials: "include" });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load server sign-in options."));
  }
  return data;
}

export async function fetchCurrentUser(
  serverUrl: string,
  token: string | null,
  customFetch?: typeof fetch,
): Promise<AuthUser | null> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error, response } = await client.GET("/api/me", { credentials: "include" });
  if (response.status === 401) {
    return null;
  }
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not verify your session."));
  }
  return data;
}

export interface SetupInput {
  email: string;
  password: string;
  displayName: string;
}

export async function setupAdminAccount(
  serverUrl: string,
  input: SetupInput,
  customFetch?: typeof fetch,
): Promise<SignedInResponse> {
  const client = getApiClient(serverUrl, customFetch ? { customFetch } : undefined);
  const deviceName = defaultDeviceName();
  const { data, error } = await client.POST("/api/setup", {
    credentials: "include",
    body: {
      email: input.email.trim(),
      password: input.password,
      displayName: input.displayName.trim(),
      client: getAuthClientKind(),
      ...(deviceName ? { deviceName } : {}),
    },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not complete first-run setup."));
  }
  return data;
}

export interface LoginInput {
  email: string;
  password: string;
}

export async function loginWithPassword(
  serverUrl: string,
  input: LoginInput,
  customFetch?: typeof fetch,
): Promise<SignedInResponse> {
  const client = getApiClient(serverUrl, customFetch ? { customFetch } : undefined);
  const deviceName = defaultDeviceName();
  const { data, error } = await client.POST("/api/auth/login", {
    credentials: "include",
    body: {
      email: input.email.trim(),
      password: input.password,
      client: getAuthClientKind(),
      ...(deviceName ? { deviceName } : {}),
    },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Sign-in failed. Check your email and password."));
  }
  return data;
}

export interface SignupInput {
  email: string;
  password: string;
  displayName: string;
  inviteCode?: string;
}

export async function signupWithPassword(
  serverUrl: string,
  input: SignupInput,
  customFetch?: typeof fetch,
): Promise<SignedInResponse> {
  const client = getApiClient(serverUrl, customFetch ? { customFetch } : undefined);
  const deviceName = defaultDeviceName();
  const inviteCode = input.inviteCode?.trim();
  const { data, error } = await client.POST("/api/auth/signup", {
    credentials: "include",
    body: {
      email: input.email.trim(),
      password: input.password,
      displayName: input.displayName.trim(),
      client: getAuthClientKind(),
      ...(deviceName ? { deviceName } : {}),
      ...(inviteCode ? { inviteCode } : {}),
    },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not create account."));
  }
  return data;
}

export async function logoutSession(
  serverUrl: string,
  token: string | null,
  customFetch?: typeof fetch,
): Promise<void> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { error, response } = await client.POST("/api/auth/logout", { credentials: "include" });
  if (response.status === 401 || response.status === 204) {
    return;
  }
  if (error) {
    throw new Error(formatApiError(error, "Could not sign out."));
  }
}

export function useAuthStatus(serverUrl: string | null, customFetch?: typeof fetch) {
  return useQuery({
    queryKey: ["auth-status", serverUrl],
    enabled: Boolean(serverUrl),
    retry: false,
    queryFn: () => {
      if (!serverUrl) throw new Error("No server configured");
      return fetchAuthStatus(serverUrl, customFetch);
    },
  });
}

export function useCurrentUser(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["auth-me", serverUrl],
    enabled: Boolean(serverUrl),
    retry: false,
    queryFn: () => {
      if (!serverUrl) throw new Error("No server configured");
      return fetchCurrentUser(serverUrl, token, customFetch);
    },
  });
}

export function useSetupAdmin(
  serverUrl: string,
  onSignedIn: (res: SignedInResponse) => Promise<void>,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SetupInput) => setupAdminAccount(serverUrl, input, customFetch),
    onSuccess: async (res) => {
      await onSignedIn(res);
      queryClient.setQueryData(["auth-me", serverUrl], res.user);
      await queryClient.invalidateQueries({ queryKey: ["auth-status", serverUrl] });
    },
  });
}

export function useLogin(
  serverUrl: string,
  onSignedIn: (res: SignedInResponse) => Promise<void>,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => loginWithPassword(serverUrl, input, customFetch),
    onSuccess: async (res) => {
      await onSignedIn(res);
      queryClient.setQueryData(["auth-me", serverUrl], res.user);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["breweries", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["my-brewery-invites", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["recipes", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["batches", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["inventory", serverUrl] }),
      ]);
    },
  });
}

export function useSignup(
  serverUrl: string,
  onSignedIn: (res: SignedInResponse) => Promise<void>,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SignupInput) => signupWithPassword(serverUrl, input, customFetch),
    onSuccess: async (res) => {
      await onSignedIn(res);
      queryClient.setQueryData(["auth-me", serverUrl], res.user);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["breweries", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["my-brewery-invites", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["recipes", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["batches", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["inventory", serverUrl] }),
      ]);
    },
  });
}

export function useLogout(
  serverUrl: string,
  token: string | null,
  onSignedOut: () => Promise<void>,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => logoutSession(serverUrl, token, customFetch),
    onSuccess: async () => {
      await onSignedOut();
      queryClient.setQueryData(["auth-me", serverUrl], null);
      queryClient.removeQueries({ queryKey: ["breweries", serverUrl] });
      queryClient.removeQueries({ queryKey: ["brewery-detail", serverUrl] });
      queryClient.removeQueries({ queryKey: ["brewery-invites", serverUrl] });
      queryClient.removeQueries({ queryKey: ["my-brewery-invites", serverUrl] });
      queryClient.removeQueries({ queryKey: ["inventory", serverUrl] });
    },
  });
}

// ── Profile, Password, Personal API Tokens ───────────────────────────

export async function updateMyProfile(
  serverUrl: string,
  token: string | null,
  input: UpdateMeInput,
  customFetch?: typeof fetch,
): Promise<AuthUser> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.PATCH("/api/me", {
    credentials: "include",
    body: {
      ...(input.displayName !== undefined ? { displayName: input.displayName.trim() } : {}),
      ...(input.units !== undefined ? { units: input.units } : {}),
    },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not update profile settings."));
  }
  return data;
}

export async function changeMyPassword(
  serverUrl: string,
  token: string | null,
  input: { currentPassword: string; newPassword: string },
  customFetch?: typeof fetch,
): Promise<void> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { error, response } = await client.POST("/api/me/password", {
    credentials: "include",
    body: input,
  });
  if (response.status === 204) return;
  if (error) {
    throw new Error(formatApiError(error, "Could not change password."));
  }
}

export async function redeemPasswordReset(
  serverUrl: string,
  input: { token: string; password: string },
  customFetch?: typeof fetch,
): Promise<void> {
  const client = getApiClient(serverUrl, customFetch ? { customFetch } : undefined);
  const { error, response } = await client.POST("/api/auth/password-reset", {
    credentials: "include",
    body: input,
  });
  if (response.status === 204) return;
  if (error) {
    throw new Error(formatApiError(error, "Could not reset password."));
  }
}

export async function fetchAuthTokens(
  serverUrl: string,
  token: string | null,
  customFetch?: typeof fetch,
): Promise<UserToken[]> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/auth/tokens", { credentials: "include" });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load API tokens."));
  }
  return data;
}

export async function createPersonalToken(
  serverUrl: string,
  token: string | null,
  input: { name: string; scopes: TokenScope[] },
  customFetch?: typeof fetch,
): Promise<NewUserToken> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.POST("/api/auth/tokens", {
    credentials: "include",
    body: {
      name: input.name.trim(),
      scopes: input.scopes,
    },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not create personal API token."));
  }
  return data;
}

export async function revokeAuthToken(
  serverUrl: string,
  token: string | null,
  tokenId: string,
  customFetch?: typeof fetch,
): Promise<void> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { error, response } = await client.DELETE("/api/auth/tokens/{id}", {
    credentials: "include",
    params: { path: { id: tokenId } },
  });
  if (response.status === 204) return;
  if (error) {
    throw new Error(formatApiError(error, "Could not revoke token."));
  }
}

// ── Admin (Invites, Users, Reset Links) ──────────────────────────────

export async function createInvite(
  serverUrl: string,
  token: string | null,
  customFetch?: typeof fetch,
): Promise<Invite> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.POST("/api/invites", { credentials: "include" });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not create invite code."));
  }
  return data;
}

export async function fetchAdminUsers(
  serverUrl: string,
  token: string | null,
  customFetch?: typeof fetch,
): Promise<AdminUser[]> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/admin/users", { credentials: "include" });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load server users."));
  }
  return data;
}

export async function setAdminUserDisabled(
  serverUrl: string,
  token: string | null,
  userId: string,
  disabled: boolean,
  customFetch?: typeof fetch,
): Promise<AdminUser> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = disabled
    ? await client.POST("/api/admin/users/{id}/disable", {
        credentials: "include",
        params: { path: { id: userId } },
      })
    : await client.POST("/api/admin/users/{id}/enable", {
        credentials: "include",
        params: { path: { id: userId } },
      });
  if (error || !data) {
    throw new Error(
      formatApiError(
        error,
        disabled ? "Could not disable account." : "Could not re-enable account.",
      ),
    );
  }
  return data;
}

export async function createAdminPasswordReset(
  serverUrl: string,
  token: string | null,
  userId: string,
  customFetch?: typeof fetch,
): Promise<PasswordResetLink> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.POST("/api/admin/users/{id}/password-reset", {
    credentials: "include",
    params: { path: { id: userId } },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not create password reset link."));
  }
  return data;
}

// ── React Query Hooks ────────────────────────────────────────────────

export function useUpdateMe(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateMeInput): Promise<AuthUser> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      return updateMyProfile(serverUrl, token, input, customFetch);
    },
    onSuccess: (user) => {
      if (!serverUrl) return;
      queryClient.setQueryData(["auth-me", serverUrl], user);
    },
  });
}

export function useChangePassword(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  return useMutation({
    mutationFn: async (input: { currentPassword: string; newPassword: string }): Promise<void> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      return changeMyPassword(serverUrl, token, input, customFetch);
    },
  });
}

export function useRedeemPasswordReset(serverUrl: string | null, customFetch?: typeof fetch) {
  return useMutation({
    mutationFn: async (input: { token: string; password: string }): Promise<void> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      return redeemPasswordReset(serverUrl, input, customFetch);
    },
  });
}

export function useAuthTokens(
  serverUrl: string | null,
  token: string | null,
  enabled: boolean,
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["auth-tokens", serverUrl],
    enabled: Boolean(serverUrl) && enabled,
    retry: false,
    queryFn: () => {
      if (!serverUrl) throw new Error("No server configured");
      return fetchAuthTokens(serverUrl, token, customFetch);
    },
  });
}

export function useCreateApiToken(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; scopes: TokenScope[] }): Promise<NewUserToken> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      return createPersonalToken(serverUrl, token, input, customFetch);
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({ queryKey: ["auth-tokens", serverUrl] });
    },
  });
}

export function useRevokeApiToken(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tokenId: string): Promise<void> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      return revokeAuthToken(serverUrl, token, tokenId, customFetch);
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({ queryKey: ["auth-tokens", serverUrl] });
    },
  });
}

export function useCreateInvite(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  return useMutation({
    mutationFn: async (): Promise<Invite> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      return createInvite(serverUrl, token, customFetch);
    },
  });
}

export function useAdminUsers(
  serverUrl: string | null,
  token: string | null,
  enabled: boolean,
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["admin-users", serverUrl],
    enabled: Boolean(serverUrl) && enabled,
    retry: false,
    queryFn: () => {
      if (!serverUrl) throw new Error("No server configured");
      return fetchAdminUsers(serverUrl, token, customFetch);
    },
  });
}

export function useSetUserDisabled(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; disabled: boolean }): Promise<AdminUser> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      return setAdminUserDisabled(serverUrl, token, input.userId, input.disabled, customFetch);
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({ queryKey: ["admin-users", serverUrl] });
    },
  });
}

export function useCreatePasswordResetLink(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  return useMutation({
    mutationFn: async (userId: string): Promise<PasswordResetLink> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      return createAdminPasswordReset(serverUrl, token, userId, customFetch);
    },
  });
}
