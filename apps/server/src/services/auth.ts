// SPDX-License-Identifier: AGPL-3.0-or-later
// Accounts, sign-in tokens and invites. The only auth code that touches the database.
import { type Db, schema } from "@brew-bruvs/db";
import { and, count, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import {
  burnPasswordCheck,
  hashPassword,
  hashSecret,
  newSecret,
  verifyPassword,
} from "../auth/secrets.ts";
import { ApiError } from "../errors.ts";
import type { User as PermissionUser } from "../permissions.ts";

const { users, memberships, authTokens, invites } = schema;

const SESSION_DAYS = 30;
const INVITE_DAYS = 7;
const days = (n: number) => new Date(Date.now() + n * 86_400_000);

export type TokenKind = "session" | "app" | "personal";
export type Scope = "read" | "write";

export interface PublicUser {
  id: string;
  uri: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
}

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
        .select({ ...publicColumns, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(sql`lower(${users.email})`, email.toLowerCase()));
      const ok = row?.passwordHash
        ? await verifyPassword(password, row.passwordHash)
        : await burnPasswordCheck(password);
      if (!row || !ok) throw new ApiError(401, "invalid_credentials", "Wrong email or password");
      const { passwordHash: _, ...user } = row;
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

    /** Looks up a live token. Returns null for unknown, revoked or expired tokens. */
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
      const [user] = await db.select(publicColumns).from(users).where(eq(users.id, row.userId));
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
          .select(publicColumns)
          .from(users)
          .where(and(eq(users.oidcIssuer, claims.issuer), eq(users.oidcSubject, claims.subject)));
        if (linked) return linked;

        if ((await userCount(tx)) === 0)
          throw new ApiError(409, "setup_required", "Finish first-run setup first");

        const [sameEmail] = await tx
          .select({ ...publicColumns, oidcSubject: users.oidcSubject })
          .from(users)
          .where(eq(sql`lower(${users.email})`, claims.email.toLowerCase()));
        if (sameEmail) {
          if (!claims.emailVerified || sameEmail.oidcSubject) {
            throw new ApiError(409, "email_taken", "That email already has an account");
          }
          await tx
            .update(users)
            .set({ oidcIssuer: claims.issuer, oidcSubject: claims.subject })
            .where(eq(users.id, sameEmail.id));
          const { oidcSubject: _, ...user } = sameEmail;
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
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
