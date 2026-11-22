// SPDX-License-Identifier: AGPL-3.0-or-later
// Optional OIDC login (authorization code + PKCE) through openid-client.
import * as client from "openid-client";
import { ApiError } from "../errors.ts";

export interface OidcOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface OidcClaims {
  issuer: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | undefined;
}

export function createOidc(opts: OidcOptions) {
  let config: Promise<client.Configuration> | undefined;
  // Discovery runs on first use and is retried after a failure.
  const getConfig = () => {
    config ??= client
      .discovery(new URL(opts.issuer), opts.clientId, opts.clientSecret)
      .catch((err) => {
        config = undefined;
        throw err;
      });
    return config;
  };

  return {
    /** Returns the provider URL to redirect to, and a value to keep in a short-lived cookie. */
    async start(): Promise<{ url: URL; cookie: string }> {
      const verifier = client.randomPKCECodeVerifier();
      const state = client.randomState();
      const url = client.buildAuthorizationUrl(await getConfig(), {
        redirect_uri: opts.redirectUri,
        scope: "openid email profile",
        code_challenge: await client.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
        state,
      });
      return { url, cookie: `${state}.${verifier}` };
    },

    /** Completes the code exchange for the callback URL the provider sent the browser to. */
    async finish(callbackUrl: URL, cookie: string): Promise<OidcClaims> {
      const [state, verifier] = cookie.split(".");
      if (!state || !verifier) throw new ApiError(400, "oidc_state", "Sign-in expired; try again");
      const tokens = await client.authorizationCodeGrant(await getConfig(), callbackUrl, {
        pkceCodeVerifier: verifier,
        expectedState: state,
      });
      const claims = tokens.claims();
      if (!claims)
        throw new ApiError(502, "oidc_failed", "The sign-in provider returned no identity");
      if (typeof claims.email !== "string") {
        throw new ApiError(400, "oidc_email", "The sign-in provider didn't share an email address");
      }
      return {
        issuer: claims.iss,
        subject: claims.sub,
        email: claims.email,
        emailVerified: claims.email_verified === true,
        name: typeof claims.name === "string" ? claims.name : undefined,
      };
    },
  };
}

export type Oidc = ReturnType<typeof createOidc>;
