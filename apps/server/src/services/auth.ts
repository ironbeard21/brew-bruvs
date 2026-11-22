// SPDX-License-Identifier: AGPL-3.0-or-later
// Accounts, sign-in tokens, invites, password resets. The only auth code that touches the database.
import { type Db, schema } from "@brew-bruvs/db";
import { and, count, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import {
  burnPasswordCheck,
  hashPassword,
  hashSecret,
  newSecret,
  verifyPassword,
} from "../auth/secrets.ts";
import { ApiError } from "../errors.ts";
import type { User as PermissionUser } from "../permissions.ts";

const { users, memberships, authTokens, invites, passwordResets } = schema;

const SESSION_DAYS = 30;
const INVITE_DAYS = 7;
const RESET_HOURS = 24;
const days = (n: number) => new Date(Date.now() + n * 86_400_000);

export type TokenKind = "session" | "app" | "personal";
export type Scope = "read" | "write";
export type Units = "us" | "metric";

export interface PublicUser {
  id: string;
  uri: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  units: Units;
}

/** What admins see in the user list. */
export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  disabled: boolean;
  createdAt: Date;
}

const disabledError = () =>
  new ApiError(403, "account_disabled", "This account is disabled; ask an admin");

export interface Session {
  user: PublicUser & PermissionUser;
  tokenId: string;
  kind: TokenKind;
  scopes: string[];
}

export interface NewAccount {
  email: string;
  password: string;
  displayName: string;
}

const publicColumns = {
  id: users.id,
  uri: users.uri,
  email: users.email,
  displayName: users.displayName,
  isAdmin: users.isAdmin,
  units: users.units,
};

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code ?? e.cause?.code;
}

export function createAuthService(
  db: Db,
  opts: { baseUrl: string; signupMode: "open" | "invite" },
) {
  type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

  async function insertUser(
    tx: Tx,
    input: {
      email: string;
      displayName: string;
      passwordHash: string | null;
      isAdmin?: boolean;
      oidc?: { issuer: string; subject: string };
    },
  ): Promise<PublicUser> {
    const { rows } = await tx.execute<{ id: string }>(sql`SELECT uuidv7() AS id`);
    const id = rows[0]?.id as string;
    try {
      const [user] = await tx
        .insert(users)
        .values({
          id,
          uri: `${opts.baseUrl}/users/${id}`,
          email: input.email,
          displayName: input.displayName,
          passwordHash: input.passwordHash,
          isAdmin: input.isAdmin ?? false,
          oidcIssuer: input.oidc?.issuer,
          oidcSubject: input.oidc?.subject,
        })
        .returning(publicColumns);
      return user as PublicUser;
    } catch (err) {
      if (pgCode(err) === "23505")
        throw new ApiError(409, "email_taken", "That email already has an account");
      throw err;
    }
  }

  // Serialises account creation so "is this the first user?" can't race.
  const lockUsers = (tx: Tx) => tx.execute(sql`LOCK TABLE ${users} IN SHARE ROW EXCLUSIVE MODE`);
  const userCount = async (tx: Tx | Db) => (await tx.select({ n: count() }).from(users))[0]?.n ?? 0;
  // Signs a user out everywhere, optionally keeping the token making the request.
  const revokeAll = (tx: Tx, userId: string, exceptTokenId?: string) =>
    tx
      .update(authTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(authTokens.userId, userId),
          isNull(authTokens.revokedAt),
          exceptTokenId ? ne(authTokens.id, exceptTokenId) : undefined,
        ),
      );

  return {
    async setupNeeded(): Promise<boolean> {
      return (await userCount(db)) === 0;
    },

    /** First-run setup: creates the admin. Closed once any account exists. */
    async setup(input: NewAccount): Promise<PublicUser> {
      const passwordHash = await hashPassword(input.password);
      return db.transaction(async (tx) => {
        await lockUsers(tx);
        if ((await userCount(tx)) > 0)
          throw new ApiError(409, "setup_closed", "Setup has already been completed");
        return insertUser(tx, { ...input, passwordHash, isAdmin: true });
      });
    },

    async signup(input: NewAccount & { inviteCode?: string | undefined }): Promise<PublicUser> {
      const passwordHash = await hashPassword(input.password);
      return db.transaction(async (tx) => {
        await lockUsers(tx);
        if ((await userCount(tx)) === 0)
          throw new ApiError(409, "setup_required", "Finish first-run setup first");

        let inviteId: string | undefined;
        if (opts.signupMode === "invite") {
          const [invite] = input.inviteCode
            ? await tx
                .select({ id: invites.id })
                .from(invites)
                .where(
                  and(
                    eq(invites.codeHash, hashSecret(input.inviteCode)),
                    isNull(invites.usedAt),
                    gt(invites.expiresAt, new Date()),
                  ),
                )
                .for("update")
            : [];
          if (!invite)
            throw new ApiError(403, "invite_required", "Sign-up needs a valid invite code");
          inviteId = invite.id;
        }

        const user = await insertUser(tx, { ...input, passwordHash });
        if (inviteId) {
          await tx
            .update(invites)
            .set({ usedAt: new Date(), usedByUserId: user.id })
            .where(eq(invites.id, inviteId));
        }
        return user;
      });
    },

    async login(email: string, password: string): Promise<PublicUser> {
      const [row] = await db
        .select({
          ...publicColumns,
          passwordHash: users.passwordHash,
          disabledAt: users.disabledAt,
        })
        .from(users)
        .where(eq(sql`lower(${users.email})`, email.toLowerCase()));
      const ok = row?.passwordHash
        ? await verifyPassword(password, row.passwordHash)
        : await burnPasswordCheck(password);
      if (!row || !ok) throw new ApiError(401, "invalid_credentials", "Wrong email or password");
      // Only after the password matched, so this doesn't reveal which emails have accounts.
      if (row.disabledAt) throw disabledError();
      const { passwordHash: _, disabledAt: __, ...user } = row;
      return user;
    },

    /** Creates a sign-in or API token. The returned secret is never stored and can't be shown again. */
    async issueToken(userId: string, kind: TokenKind, name?: string, scopes: Scope[] = []) {
      const secret = newSecret();
      const [row] = await db
        .insert(authTokens)
        .values({
          userId,
          kind,
          tokenHash: hashSecret(secret),
          name,
          scopes,
          expiresAt: kind === "session" ? days(SESSION_DAYS) : null,
        })
        .returning({ id: authTokens.id, createdAt: authTokens.createdAt });
      return { secret, id: row?.id as string, createdAt: row?.createdAt as Date };
    },

    /** Looks up a live token. Returns null for unknown, revoked or expired tokens and disabled users. */
    async resolve(secret: string): Promise<Session | null> {
      const [row] = await db
        .update(authTokens)
        .set({ lastUsedAt: new Date() })
        .where(
          and(
            eq(authTokens.tokenHash, hashSecret(secret)),
            isNull(authTokens.revokedAt),
            or(isNull(authTokens.expiresAt), gt(authTokens.expiresAt, new Date())),
          ),
        )
        .returning({
          id: authTokens.id,
          userId: authTokens.userId,
          kind: authTokens.kind,
          scopes: authTokens.scopes,
        });
      if (!row) return null;
      const [user] = await db
        .select(publicColumns)
        .from(users)
        .where(and(eq(users.id, row.userId), isNull(users.disabledAt)));
      if (!user) return null;
      const roles = await db
        .select({ breweryId: memberships.breweryId, role: memberships.role })
        .from(memberships)
        .where(eq(memberships.userId, user.id));
      return {
        user: { ...user, memberships: roles },
        tokenId: row.id,
        kind: row.kind,
        scopes: row.scopes,
      };
    },

    /** Revokes one of the user's own tokens. */
    async revoke(userId: string, tokenId: string): Promise<void> {
      const done = await db
        .update(authTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(authTokens.id, tokenId),
            eq(authTokens.userId, userId),
            isNull(authTokens.revokedAt),
          ),
        )
        .returning({ id: authTokens.id });
      if (done.length === 0) throw new ApiError(404, "not_found", "Token not found");
    },

    /** The user's live app and personal tokens (never the secrets). */
    async listTokens(userId: string) {
      return db
        .select({
          id: authTokens.id,
          kind: authTokens.kind,
          name: authTokens.name,
          scopes: authTokens.scopes,
          createdAt: authTokens.createdAt,
          lastUsedAt: authTokens.lastUsedAt,
        })
        .from(authTokens)
        .where(
          and(
            eq(authTokens.userId, userId),
            isNull(authTokens.revokedAt),
            inArray(authTokens.kind, ["app", "personal"]),
          ),
        )
        .orderBy(authTokens.createdAt);
    },

    async createInvite(createdByUserId: string) {
      const code = newSecret();
      const expiresAt = days(INVITE_DAYS);
      await db.insert(invites).values({ codeHash: hashSecret(code), createdByUserId, expiresAt });
      return { code, expiresAt };
    },

    /**
     * Signs in an OIDC identity: an already-linked account, else the account with the same
     * verified email (linked now), else a new account. The admin chose to trust this provider.
     */
    async oidcUser(claims: {
      issuer: string;
      subject: string;
      email: string;
      emailVerified: boolean;
      name?: string | undefined;
    }): Promise<PublicUser> {
      return db.transaction(async (tx) => {
        await lockUsers(tx);
        const [linked] = await tx
          .select({ ...publicColumns, disabledAt: users.disabledAt })
          .from(users)
          .where(and(eq(users.oidcIssuer, claims.issuer), eq(users.oidcSubject, claims.subject)));
        if (linked) {
          if (linked.disabledAt) throw disabledError();
          const { disabledAt: _, ...user } = linked;
          return user;
        }

        if ((await userCount(tx)) === 0)
          throw new ApiError(409, "setup_required", "Finish first-run setup first");

        const [sameEmail] = await tx
          .select({
            ...publicColumns,
            oidcSubject: users.oidcSubject,
            disabledAt: users.disabledAt,
          })
          .from(users)
          .where(eq(sql`lower(${users.email})`, claims.email.toLowerCase()));
        if (sameEmail) {
          if (!claims.emailVerified || sameEmail.oidcSubject) {
            throw new ApiError(409, "email_taken", "That email already has an account");
          }
          if (sameEmail.disabledAt) throw disabledError();
          await tx
            .update(users)
            .set({ oidcIssuer: claims.issuer, oidcSubject: claims.subject })
            .where(eq(users.id, sameEmail.id));
          const { oidcSubject: _, disabledAt: __, ...user } = sameEmail;
          return user;
        }

        return insertUser(tx, {
          email: claims.email,
          displayName: claims.name || claims.email.split("@")[0] || claims.email,
          passwordHash: null,
          oidc: { issuer: claims.issuer, subject: claims.subject },
        });
      });
    },

    // ── Settings ─────────────────────────────────────────────────────────

    async updateProfile(
      userId: string,
      changes: { displayName?: string | undefined; units?: Units | undefined },
    ): Promise<PublicUser> {
      const [user] = await db
        .update(users)
        .set(changes)
        .where(eq(users.id, userId))
        .returning(publicColumns);
      if (!user) throw new ApiError(404, "not_found", "User not found");
      return user;
    },

    /** Changes the password and signs out every other session and app. */
    async changePassword(
      userId: string,
      current: string,
      next: string,
      keepTokenId: string,
    ): Promise<void> {
      const [row] = await db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, userId));
      if (!row?.passwordHash) {
        throw new ApiError(
          409,
          "no_password",
          "This account signs in with single sign-on; ask an admin for a reset link to add a password",
        );
      }
      if (!(await verifyPassword(current, row.passwordHash))) {
        throw new ApiError(403, "wrong_password", "Current password is wrong");
      }
      const passwordHash = await hashPassword(next);
      await db.transaction(async (tx) => {
        await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
        await revokeAll(tx, userId, keepTokenId);
      });
    },

    // ── Password reset links (admins create them; there is no email) ────

    async createPasswordReset(createdByUserId: string, userId: string) {
      const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
      if (!user) throw new ApiError(404, "not_found", "User not found");
      const token = newSecret();
      const expiresAt = new Date(Date.now() + RESET_HOURS * 3_600_000);
      await db
        .insert(passwordResets)
        .values({ userId, tokenHash: hashSecret(token), createdByUserId, expiresAt });
      return { token, expiresAt };
    },

    /** Sets a new password from a reset link, then signs the user out everywhere. */
    async redeemPasswordReset(token: string, password: string): Promise<void> {
      const passwordHash = await hashPassword(password);
      await db.transaction(async (tx) => {
        const [reset] = await tx
          .select({ id: passwordResets.id, userId: passwordResets.userId })
          .from(passwordResets)
          .where(
            and(
              eq(passwordResets.tokenHash, hashSecret(token)),
              isNull(passwordResets.usedAt),
              gt(passwordResets.expiresAt, new Date()),
            ),
          )
          .for("update");
        if (!reset) {
          throw new ApiError(400, "invalid_reset", "This reset link is invalid or has expired");
        }
        await tx
          .update(passwordResets)
          .set({ usedAt: new Date() })
          .where(eq(passwordResets.id, reset.id));
        await tx.update(users).set({ passwordHash }).where(eq(users.id, reset.userId));
        await revokeAll(tx, reset.userId);
      });
    },

    // ── Admin ────────────────────────────────────────────────────────────

    async listUsers(): Promise<AdminUser[]> {
      const rows = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          isAdmin: users.isAdmin,
          disabledAt: users.disabledAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .orderBy(users.createdAt);
      return rows.map(({ disabledAt, ...u }) => ({ ...u, disabled: disabledAt !== null }));
    },

    /** Disables or re-enables an account. Disabling revokes all its tokens. */
    async setDisabled(adminId: string, userId: string, disabled: boolean): Promise<AdminUser> {
      if (adminId === userId) {
        throw new ApiError(409, "cannot_disable_self", "You can't disable your own account");
      }
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(users)
          .set({ disabledAt: disabled ? new Date() : null })
          .where(eq(users.id, userId))
          .returning({
            id: users.id,
            email: users.email,
            displayName: users.displayName,
            isAdmin: users.isAdmin,
            createdAt: users.createdAt,
          });
        if (!row) throw new ApiError(404, "not_found", "User not found");
        if (disabled) await revokeAll(tx, userId);
        return { ...row, disabled };
      });
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
