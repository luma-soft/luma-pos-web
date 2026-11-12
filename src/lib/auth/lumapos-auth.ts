import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  authCredentials,
  authSessionTokens,
  authSessions,
  profiles,
  stores,
} from "@/db/schema";
import { normalizePhone } from "@/lib/auth/phone";
import { createDummyBcryptHash, hashPassword, verifyPassword } from "@/lib/auth/password";

const WEB_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const MOBILE_ACCESS_TTL_MS = 15 * 60 * 1_000;
const MOBILE_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MOBILE_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1_000;
const LOGIN_LOCK_THRESHOLD = 10;
const LOGIN_LOCK_MS = 15 * 60 * 1_000;
const dummyBcryptHash = createDummyBcryptHash();

export type LumaAuthenticatedUser = {
  id: string;
  email: string | null;
};

export type LumaTokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export function hashAuthToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

async function credentialCandidates(input: {
  email?: string | null;
  phone?: string | null;
}) {
  const email = input.email?.trim().toLowerCase();
  if (email) {
    return db.select({
      profileId: profiles.id,
      storeId: profiles.storeId,
      isActive: profiles.isActive,
      storeStatus: stores.status,
      email: authCredentials.email,
      emailVerifiedAt: authCredentials.emailVerifiedAt,
      passwordHash: authCredentials.passwordHash,
      passwordHashType: authCredentials.passwordHashType,
      mustResetPassword: authCredentials.mustResetPassword,
      failedLoginAttempts: authCredentials.failedLoginAttempts,
      lockedUntil: authCredentials.lockedUntil,
    })
      .from(authCredentials)
      .innerJoin(profiles, eq(profiles.id, authCredentials.profileId))
      .innerJoin(stores, eq(stores.id, profiles.storeId))
      .where(eq(authCredentials.emailNormalized, email))
      .limit(2);
  }

  const phone = input.phone ? normalizePhone(input.phone) : null;
  if (!phone) return [];
  return db.select({
    profileId: profiles.id,
    storeId: profiles.storeId,
    isActive: profiles.isActive,
    storeStatus: stores.status,
    email: authCredentials.email,
    emailVerifiedAt: authCredentials.emailVerifiedAt,
    passwordHash: authCredentials.passwordHash,
    passwordHashType: authCredentials.passwordHashType,
    mustResetPassword: authCredentials.mustResetPassword,
    failedLoginAttempts: authCredentials.failedLoginAttempts,
    lockedUntil: authCredentials.lockedUntil,
  })
    .from(profiles)
    .innerJoin(authCredentials, eq(authCredentials.profileId, profiles.id))
    .innerJoin(stores, eq(stores.id, profiles.storeId))
    .where(eq(profiles.phoneNormalized, phone))
    .limit(2);
}

export async function authenticatePassword(input: {
  email?: string | null;
  phone?: string | null;
  password: string;
}): Promise<LumaAuthenticatedUser | null> {
  if (!input.password) return null;
  const rows = await credentialCandidates(input);
  const candidate = rows.length === 1 ? rows[0] : null;
  const selectedHash = candidate?.passwordHash ?? await dummyBcryptHash;
  const selectedHashType = candidate?.passwordHash ? candidate.passwordHashType : "bcrypt";
  const passwordMatches = await verifyPassword(input.password, selectedHash, selectedHashType);
  const now = new Date();
  const emailLogin = Boolean(input.email?.trim());

  if (
    !candidate ||
    !passwordMatches ||
    !candidate.isActive ||
    candidate.storeStatus !== "active" ||
    candidate.mustResetPassword ||
    (emailLogin && !candidate.emailVerifiedAt) ||
    (candidate.lockedUntil && candidate.lockedUntil > now)
  ) {
    if (candidate && !passwordMatches && !(candidate.lockedUntil && candidate.lockedUntil > now)) {
      await db.transaction(async (tx) => {
        const [current] = await tx.select({
          failedLoginAttempts: authCredentials.failedLoginAttempts,
          lockedUntil: authCredentials.lockedUntil,
        }).from(authCredentials)
          .where(eq(authCredentials.profileId, candidate.profileId))
          .limit(1)
          .for("update");
        if (!current) return;
        const attempts = current.failedLoginAttempts + 1;
        await tx.update(authCredentials).set({
          failedLoginAttempts: attempts,
          lockedUntil: attempts >= LOGIN_LOCK_THRESHOLD
            ? new Date(now.getTime() + LOGIN_LOCK_MS)
            : current.lockedUntil,
          updatedAt: now,
        }).where(eq(authCredentials.profileId, candidate.profileId));
      });
    }
    return null;
  }

  await db.update(authCredentials).set({
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: now,
    updatedAt: now,
  }).where(eq(authCredentials.profileId, candidate.profileId));

  return { id: candidate.profileId, email: candidate.email };
}

export async function provisionAuthCredential(input: {
  profileId: string;
  email: string;
  password: string;
}) {
  const email = input.email.trim();
  const emailNormalized = email.toLowerCase();
  if (!emailNormalized || !emailNormalized.includes("@")) {
    throw new Error("INVALID_AUTH_EMAIL");
  }
  const encoded = await hashPassword(input.password);
  const now = new Date();
  await db.insert(authCredentials).values({
    profileId: input.profileId,
    email,
    emailNormalized,
    passwordHash: encoded.hash,
    passwordHashType: encoded.type,
    emailVerifiedAt: now,
    mustResetPassword: false,
    passwordChangedAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: authCredentials.profileId,
    set: {
      email,
      emailNormalized,
      passwordHash: encoded.hash,
      passwordHashType: encoded.type,
      emailVerifiedAt: now,
      mustResetPassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      passwordChangedAt: now,
      updatedAt: now,
    },
  });
}

export async function changeAuthPassword(input: {
  profileId: string;
  currentPassword?: string | null;
  newPassword: string;
}): Promise<boolean> {
  const encoded = await hashPassword(input.newPassword);
  const now = new Date();
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(authCredentials)
      .where(eq(authCredentials.profileId, input.profileId))
      .limit(1)
      .for("update");
    if (!current) return false;
    const currentPasswordValid = current.passwordHash
      ? await verifyPassword(input.currentPassword ?? "", current.passwordHash, current.passwordHashType)
      : current.mustResetPassword && !input.currentPassword;
    if (!currentPasswordValid) return false;

    await tx.update(authCredentials).set({
      passwordHash: encoded.hash,
      passwordHashType: encoded.type,
      mustResetPassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      passwordChangedAt: now,
      updatedAt: now,
    }).where(eq(authCredentials.profileId, input.profileId));
    await tx.update(authSessions).set({ revokedAt: now })
      .where(and(
        eq(authSessions.profileId, input.profileId),
        isNull(authSessions.revokedAt),
      ));
    return true;
  });
}

async function createSession(input: {
  profileId: string;
  kind: "web" | "mobile";
  deviceId?: string | null;
  deviceName?: string | null;
}) {
  return db.transaction(async (tx) => {
    const [profile] = await tx.select({
      storeId: profiles.storeId,
    }).from(profiles)
      .innerJoin(stores, eq(stores.id, profiles.storeId))
      .where(and(
        eq(profiles.id, input.profileId),
        eq(profiles.isActive, true),
        eq(stores.status, "active"),
      ))
      .limit(1)
      .for("update");
    if (!profile) return null;

    const now = new Date();
    const sessionExpiresAt = new Date(now.getTime() + (
      input.kind === "web" ? WEB_SESSION_TTL_MS : MOBILE_SESSION_TTL_MS
    ));
    const [session] = await tx.insert(authSessions).values({
      storeId: profile.storeId,
      profileId: input.profileId,
      kind: input.kind,
      deviceId: input.deviceId?.trim().slice(0, 160) || null,
      deviceName: input.deviceName?.trim().slice(0, 160) || null,
      expiresAt: sessionExpiresAt,
    }).returning({ id: authSessions.id });

    if (input.kind === "web") {
      const token = createOpaqueToken();
      const expiresAt = new Date(Math.min(now.getTime() + WEB_SESSION_TTL_MS, sessionExpiresAt.getTime()));
      await tx.insert(authSessionTokens).values({
        sessionId: session.id,
        tokenHash: hashAuthToken(token),
        kind: "web_session",
        expiresAt,
      });
      return { sessionId: session.id, token, expiresAt: expiresAt.getTime() };
    }

    const accessToken = createOpaqueToken();
    const refreshToken = createOpaqueToken();
    const accessExpiresAt = new Date(now.getTime() + MOBILE_ACCESS_TTL_MS);
    const refreshExpiresAt = new Date(Math.min(
      now.getTime() + MOBILE_REFRESH_TTL_MS,
      sessionExpiresAt.getTime(),
    ));
    await tx.insert(authSessionTokens).values([
      {
        sessionId: session.id,
        tokenHash: hashAuthToken(accessToken),
        kind: "mobile_access",
        expiresAt: accessExpiresAt,
      },
      {
        sessionId: session.id,
        tokenHash: hashAuthToken(refreshToken),
        kind: "mobile_refresh",
        expiresAt: refreshExpiresAt,
      },
    ]);

    return {
      sessionId: session.id,
      accessToken,
      refreshToken,
      expiresAt: accessExpiresAt.getTime(),
    };
  });
}

export function createWebAuthSession(profileId: string) {
  return createSession({ profileId, kind: "web" });
}

export function createMobileAuthSession(input: {
  profileId: string;
  deviceId?: string | null;
  deviceName?: string | null;
}) {
  return createSession({ ...input, kind: "mobile" }) as Promise<
    | (LumaTokenSet & { sessionId: string })
    | null
  >;
}

export async function getLumaAuthenticatedUser(
  token: string,
  kind: "web_session" | "mobile_access",
): Promise<LumaAuthenticatedUser | null> {
  if (!token) return null;
  const now = new Date();
  const [row] = await db.select({
    id: profiles.id,
    email: authCredentials.email,
  }).from(authSessionTokens)
    .innerJoin(authSessions, eq(authSessions.id, authSessionTokens.sessionId))
    .innerJoin(profiles, eq(profiles.id, authSessions.profileId))
    .innerJoin(stores, eq(stores.id, authSessions.storeId))
    .leftJoin(authCredentials, eq(authCredentials.profileId, profiles.id))
    .where(and(
      eq(authSessionTokens.tokenHash, hashAuthToken(token)),
      eq(authSessionTokens.kind, kind),
      gt(authSessionTokens.expiresAt, now),
      gt(authSessions.expiresAt, now),
      isNull(authSessions.revokedAt),
      eq(profiles.isActive, true),
      eq(stores.status, "active"),
    ))
    .limit(1);
  return row ? { id: row.id, email: row.email } : null;
}

export async function validateMobileTokenPair(
  accessToken: string,
  refreshToken: string,
) {
  const now = new Date();
  const [access] = await db.select({
    sessionId: authSessionTokens.sessionId,
    profileId: authSessions.profileId,
  }).from(authSessionTokens)
    .innerJoin(authSessions, eq(authSessions.id, authSessionTokens.sessionId))
    .innerJoin(profiles, eq(profiles.id, authSessions.profileId))
    .innerJoin(stores, eq(stores.id, authSessions.storeId))
    .where(and(
      eq(authSessionTokens.tokenHash, hashAuthToken(accessToken)),
      eq(authSessionTokens.kind, "mobile_access"),
      gt(authSessionTokens.expiresAt, now),
      gt(authSessions.expiresAt, now),
      isNull(authSessions.revokedAt),
      eq(authSessions.kind, "mobile"),
      eq(profiles.isActive, true),
      eq(stores.status, "active"),
    ))
    .limit(1);
  if (!access) return null;

  const [refresh] = await db.select({ sessionId: authSessionTokens.sessionId })
    .from(authSessionTokens)
    .where(and(
      eq(authSessionTokens.tokenHash, hashAuthToken(refreshToken)),
      eq(authSessionTokens.kind, "mobile_refresh"),
      gt(authSessionTokens.expiresAt, now),
      isNull(authSessionTokens.usedAt),
      eq(authSessionTokens.sessionId, access.sessionId),
    ))
    .limit(1);
  return refresh ? access : null;
}

export async function refreshMobileAuthSession(refreshToken: string): Promise<LumaTokenSet | null> {
  if (!refreshToken) return null;
  const tokenHash = hashAuthToken(refreshToken);
  return db.transaction(async (tx) => {
    const [token] = await tx.select().from(authSessionTokens)
      .where(and(
        eq(authSessionTokens.tokenHash, tokenHash),
        eq(authSessionTokens.kind, "mobile_refresh"),
      ))
      .limit(1)
      .for("update");
    if (!token) return null;

    const [session] = await tx.select().from(authSessions)
      .where(eq(authSessions.id, token.sessionId))
      .limit(1)
      .for("update");
    if (!session) return null;
    const now = new Date();

    if (token.usedAt) {
      if (!session.revokedAt) {
        await tx.update(authSessions).set({ revokedAt: now })
          .where(and(eq(authSessions.id, session.id), isNull(authSessions.revokedAt)));
      }
      return null;
    }
    if (
      token.expiresAt <= now ||
      session.expiresAt <= now ||
      session.revokedAt ||
      session.kind !== "mobile"
    ) {
      return null;
    }

    const [profile] = await tx.select({ id: profiles.id })
      .from(profiles)
      .innerJoin(stores, eq(stores.id, profiles.storeId))
      .where(and(
        eq(profiles.id, session.profileId),
        eq(profiles.storeId, session.storeId),
        eq(profiles.isActive, true),
        eq(stores.status, "active"),
      ))
      .limit(1);
    if (!profile) {
      await tx.update(authSessions).set({ revokedAt: now })
        .where(and(eq(authSessions.id, session.id), isNull(authSessions.revokedAt)));
      return null;
    }

    await tx.update(authSessionTokens).set({ usedAt: now })
      .where(and(eq(authSessionTokens.id, token.id), isNull(authSessionTokens.usedAt)));

    const accessToken = createOpaqueToken();
    const nextRefreshToken = createOpaqueToken();
    const accessExpiresAt = new Date(now.getTime() + MOBILE_ACCESS_TTL_MS);
    const refreshExpiresAt = new Date(Math.min(
      now.getTime() + MOBILE_REFRESH_TTL_MS,
      session.expiresAt.getTime(),
    ));
    await tx.insert(authSessionTokens).values([
      {
        sessionId: session.id,
        tokenHash: hashAuthToken(accessToken),
        kind: "mobile_access",
        expiresAt: accessExpiresAt,
      },
      {
        sessionId: session.id,
        tokenHash: hashAuthToken(nextRefreshToken),
        kind: "mobile_refresh",
        expiresAt: refreshExpiresAt,
      },
    ]);
    await tx.update(authSessions).set({ lastUsedAt: now })
      .where(eq(authSessions.id, session.id));

    return {
      accessToken,
      refreshToken: nextRefreshToken,
      expiresAt: accessExpiresAt.getTime(),
    };
  });
}

export async function revokeAuthSessionForTokens(tokens: readonly string[]): Promise<boolean> {
  const hashes = [...new Set(tokens.filter(Boolean).map(hashAuthToken))];
  if (hashes.length === 0) return false;
  const [token] = await db.select({ sessionId: authSessionTokens.sessionId })
    .from(authSessionTokens)
    .where(or(...hashes.map((hash) => eq(authSessionTokens.tokenHash, hash))))
    .limit(1);
  if (!token) return false;
  const [revoked] = await db.update(authSessions).set({ revokedAt: new Date() })
    .where(and(eq(authSessions.id, token.sessionId), isNull(authSessions.revokedAt)))
    .returning({ id: authSessions.id });
  return Boolean(revoked);
}
