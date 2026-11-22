// SPDX-License-Identifier: AGPL-3.0-or-later
import type { components } from "@brew-bruvs/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Platform } from "react-native";
import { formatApiError, getApiClient } from "./client";

export type AuthUser = components["schemas"]["User"];
export type AuthStatus = components["schemas"]["AuthStatus"];
export type SignedInResponse = components["schemas"]["SignedIn"];

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
    },
  });
}
