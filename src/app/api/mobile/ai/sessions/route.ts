import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiChatMessages, aiChatSessions } from "@/db/schema";
import { requireAiProviderConfigured } from "@/lib/ai/config";
import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";

const MAX_MESSAGES = 120;
const MAX_SESSIONS = 30;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeSurface(value: unknown) {
  const surface = asString(value, "web");
  if (surface === "mobile") return "mobile";
  return surface === "pos" ? "pos" : "web";
}

function messageRows(storeId: string, sessionId: string, messages: unknown[]) {
  return messages.slice(-MAX_MESSAGES).map((item, index) => {
    const msg = asObject(item);
    const role = asString(msg.role) === "assistant" ? "assistant" : "user";
    return {
      storeId,
      sessionId,
      role,
      content: asString(msg.text ?? msg.content).slice(0, 8000),
      state: asString(msg.state) || null,
      attachments: Array.isArray(msg.attachments) ? msg.attachments.map(asObject) : null,
      preview: msg.preview && typeof msg.preview === "object" ? asObject(msg.preview) : null,
      result: asString(msg.result) || null,
      record: msg.record && typeof msg.record === "object" ? asObject(msg.record) : null,
      metadata: { order: index },
    };
  }).filter((item) => item.content);
}

async function getOwnedSession(storeId: string, sessionId: string, userId: string) {
  const [session] = await db
    .select()
    .from(aiChatSessions)
    .where(and(eq(aiChatSessions.storeId, storeId), eq(aiChatSessions.id, sessionId), eq(aiChatSessions.ownerId, userId), isNull(aiChatSessions.deletedAt)))
    .limit(1);
  return session ?? null;
}

export async function GET(request: Request) {
  const gate = await requireMobileUser();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileGate(gate)!;
  const aiBlocked = await requireAiProviderConfigured();
  if (aiBlocked) return aiBlocked;

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  const surface = normalizeSurface(url.searchParams.get("surface"));

  if (sessionId) {
    const session = await getOwnedSession(gate.storeId, sessionId, gate.userId);
    if (!session) return mobileError("ai.session.notFound", 404);
    const messages = await db
      .select()
      .from(aiChatMessages)
      .where(and(eq(aiChatMessages.storeId, gate.storeId), eq(aiChatMessages.sessionId, session.id)))
      .orderBy(asc(aiChatMessages.createdAt))
      .limit(MAX_MESSAGES);
    return mobileOk({ session, messages });
  }

  const sessions = await db
    .select({
      id: aiChatSessions.id,
      surface: aiChatSessions.surface,
      title: aiChatSessions.title,
      metadata: aiChatSessions.metadata,
      createdAt: aiChatSessions.createdAt,
      updatedAt: aiChatSessions.updatedAt,
      messageCount: sql<number>`(
        select count(*)::int from ${aiChatMessages}
        where ${aiChatMessages.sessionId} = ${aiChatSessions.id}
      )`,
    })
    .from(aiChatSessions)
    .where(and(eq(aiChatSessions.storeId, gate.storeId), eq(aiChatSessions.ownerId, gate.userId), eq(aiChatSessions.surface, surface), isNull(aiChatSessions.deletedAt)))
    .orderBy(desc(aiChatSessions.updatedAt))
    .limit(MAX_SESSIONS);
  return mobileOk({ sessions });
}

export async function POST(request: Request) {
  const gate = await requireMobileUser();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileGate(gate)!;
  const aiBlocked = await requireAiProviderConfigured();
  if (aiBlocked) return aiBlocked;

  const body = asObject(await readJson(request));
  const surface = normalizeSurface(body.surface);
  const title = asString(body.title, "AI Assistant").slice(0, 120) || "AI Assistant";
  const [session] = await db
    .insert(aiChatSessions)
    .values({ storeId: gate.storeId, ownerId: gate.userId, surface, title })
    .returning();
  return mobileOk({ session });
}

export async function PUT(request: Request) {
  const gate = await requireMobileUser();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileGate(gate)!;
  const aiBlocked = await requireAiProviderConfigured();
  if (aiBlocked) return aiBlocked;

  const body = asObject(await readJson(request));
  const surface = normalizeSurface(body.surface);
  const sessionId = asString(body.sessionId);
  const title = asString(body.title, "AI Assistant").slice(0, 120) || "AI Assistant";
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const session = sessionId ? await getOwnedSession(gate.storeId, sessionId, gate.userId) : null;

  const saved = await db.transaction(async (tx) => {
    const current = session ?? (await tx
      .insert(aiChatSessions)
      .values({ storeId: gate.storeId, ownerId: gate.userId, surface, title })
      .returning())[0];
    await tx.update(aiChatSessions)
      .set({ title, surface, updatedAt: sql`now()` })
      .where(and(eq(aiChatSessions.storeId, gate.storeId), eq(aiChatSessions.id, current.id)));
    await tx.delete(aiChatMessages).where(and(eq(aiChatMessages.storeId, gate.storeId), eq(aiChatMessages.sessionId, current.id)));
    const rows = messageRows(gate.storeId, current.id, messages);
    if (rows.length) await tx.insert(aiChatMessages).values(rows);
    return { ...current, title, surface, updatedAt: new Date() };
  });

  return mobileOk({ session: saved, messageCount: Math.min(messages.length, MAX_MESSAGES) });
}

export async function DELETE(request: Request) {
  const gate = await requireMobileUser();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileGate(gate)!;
  const aiBlocked = await requireAiProviderConfigured();
  if (aiBlocked) return aiBlocked;

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) return mobileError("ai.session.missing", 400);
  const session = await getOwnedSession(gate.storeId, sessionId, gate.userId);
  if (!session) return mobileError("ai.session.notFound", 404);
  await db.update(aiChatSessions)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(aiChatSessions.storeId, gate.storeId), eq(aiChatSessions.id, session.id)));
  return mobileOk({ ok: true });
}
