"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { paymentBankAccounts, storeSettings } from "@/db/schema";
import { getPaymentBankAccounts, getStaff } from "@/lib/data/settings";
import { getAiUsageStatus } from "@/lib/ai/usage";
import {
  aiSettingsInputSchema,
  paymentBankAccountInputSchema,
  shopeeSettingsInputSchema,
  storeSettingsSchema,
  storePrefsPatchSchema,
  zaloSettingsInputSchema,
  parseStorePrefs,
  type AiSettingsInput,
  type PaymentBankAccountInput,
  type ShopeeSettingsInput,
  type StoreSettingsInput,
  type StaffRole,
  type StorePrefsPatch,
  type ZaloSettingsInput,
} from "@/lib/schemas/settings";
import { writeAuditLog } from "@/lib/audit";
import { buildAiProviderConfig, completeAiText, completeAiVision } from "@/lib/ai/provider-adapter";
import { type ActionResult, requireManager, requireOwner, requireUser } from "./common";
import { Routes } from "@/lib/routes";
import { applyStaffSettingsMutation } from "@/lib/settings/staff-settings-service";
import { parseStaffSettingsMutation } from "@/lib/settings/staff-settings-mutation";

type AiProviderTestKind = "text" | "vision";

type AiProviderTestResult = {
  kind: AiProviderTestKind;
  provider: string;
  textModel: string;
  visionModel: string;
  keyConfigured: boolean;
  textPlanning: boolean;
  visionOcr: boolean;
  ok: boolean;
  message: string;
  testedAt: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

export async function loadSettingsStaff(): Promise<ActionResult<Awaited<ReturnType<typeof getStaff>>>> {
  try { await requireUser(); } catch { return { ok: false, error: "errors.unauthorized" }; }
  try {
    return { ok: true, data: await getStaff() };
  } catch (e) {
    console.error("loadSettingsStaff failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function loadSettingsPaymentBankAccounts(): Promise<ActionResult<Awaited<ReturnType<typeof getPaymentBankAccounts>>>> {
  try { await requireUser(); } catch { return { ok: false, error: "errors.unauthorized" }; }
  try {
    return { ok: true, data: await getPaymentBankAccounts() };
  } catch (e) {
    console.error("loadSettingsPaymentBankAccounts failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function loadSettingsAiUsage(): Promise<ActionResult<Awaited<ReturnType<typeof getAiUsageStatus>>>> {
  try { await requireUser(); } catch { return { ok: false, error: "errors.unauthorized" }; }
  try {
    return { ok: true, data: await getAiUsageStatus() };
  } catch (e) {
    console.error("loadSettingsAiUsage failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

function safeAiTestError(error: unknown) {
  const raw = error instanceof Error ? error.message : "provider_test_failed";
  if (raw === "missing_api_key") return "missing_api_key";
  if (raw.includes("unsupported_vision")) return "unsupported_vision";
  if (raw.includes("unsupported_text_planning")) return "unsupported_text_planning";
  return raw
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/AIza[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .slice(0, 220);
}

function blankToNull(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function updateStoreSettings(input: StoreSettingsInput): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = storeSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    await db.insert(storeSettings)
      .values({ id: "default", ...v })
      .onConflictDoUpdate({ target: storeSettings.id, set: { ...v, updatedAt: sql`now()` } });
    revalidatePath(Routes.Settings);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("updateStoreSettings failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

/** Cập nhật từng phần prefs (Thuế/Thanh toán/Thông báo/Phần cứng) — merge top-level. */
export async function updateStorePrefs(patch: StorePrefsPatch): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  return updateStorePrefsForUser(gate.userId, patch);
}

export async function updateStorePrefsForUser(
  _userId: string,
  patch: StorePrefsPatch,
): Promise<ActionResult> {
  const parsed = storePrefsPatchSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  try {
    const [row] = await db.select({ prefs: storeSettings.prefs }).from(storeSettings).where(eq(storeSettings.id, "default")).limit(1);
    const current = parseStorePrefs(row?.prefs);
    const next = { ...current, ...parsed.data };
    await db.insert(storeSettings)
      .values({ id: "default", prefs: next })
      .onConflictDoUpdate({ target: storeSettings.id, set: { prefs: next, updatedAt: sql`now()` } });
    revalidatePath(Routes.Settings);
    revalidatePath(Routes.POS);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("updateStorePrefs failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function updateAiSettings(input: AiSettingsInput): Promise<ActionResult> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;
  const parsed = aiSettingsInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    const [row] = await db.select({ prefs: storeSettings.prefs }).from(storeSettings).where(eq(storeSettings.id, "default")).limit(1);
    const current = parseStorePrefs(row?.prefs);
    const nextKey = v.clearOpenaiApiKey
      ? ""
      : (v.openaiApiKey?.trim() || current.ai.openaiApiKey);
    const requested = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const nextAi = {
      ...current.ai,
      provider: v.provider,
      textModel: v.textModel,
      visionModel: v.visionModel,
      openaiApiKey: nextKey,
      openaiApiKeySet: Boolean(nextKey),
      openaiVisionModel: v.visionModel,
      attachmentsBucket: v.attachmentsBucket,
      monthlyUsageLimit: typeof requested.monthlyUsageLimit === "number" ? v.monthlyUsageLimit : current.ai.monthlyUsageLimit,
      showFloatingLauncher: typeof requested.showFloatingLauncher === "boolean" ? v.showFloatingLauncher : current.ai.showFloatingLauncher,
    };
    const next = { ...current, ai: nextAi };
    await db.insert(storeSettings)
      .values({ id: "default", prefs: next })
      .onConflictDoUpdate({ target: storeSettings.id, set: { prefs: next, updatedAt: sql`now()` } });
    await writeAuditLog({
      actorUserId: gate.userId,
      source: "manual",
      action: "update_ai_settings",
      entityType: "store_settings",
      entityId: "default",
      status: "succeeded",
      before: {
        provider: current.ai.provider,
        textModel: current.ai.textModel,
        visionModel: current.ai.visionModel || current.ai.openaiVisionModel,
        openaiApiKeySet: Boolean(current.ai.openaiApiKey),
        openaiVisionModel: current.ai.openaiVisionModel,
        attachmentsBucket: current.ai.attachmentsBucket,
        monthlyUsageLimit: current.ai.monthlyUsageLimit,
        showFloatingLauncher: current.ai.showFloatingLauncher,
      },
      after: {
        provider: nextAi.provider,
        textModel: nextAi.textModel,
        visionModel: nextAi.visionModel,
        openaiApiKeySet: Boolean(nextAi.openaiApiKey),
        openaiVisionModel: nextAi.openaiVisionModel,
        attachmentsBucket: nextAi.attachmentsBucket,
        monthlyUsageLimit: nextAi.monthlyUsageLimit,
        showFloatingLauncher: nextAi.showFloatingLauncher,
      },
      metadata: { keyChanged: v.clearOpenaiApiKey || Boolean(v.openaiApiKey?.trim()) },
    });
    revalidatePath(Routes.Settings);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("updateAiSettings failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function updateZaloSettings(input: ZaloSettingsInput): Promise<ActionResult> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;
  const parsed = zaloSettingsInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    const [row] = await db.select({ prefs: storeSettings.prefs }).from(storeSettings).where(eq(storeSettings.id, "default")).limit(1);
    const current = parseStorePrefs(row?.prefs);
    const nextAppSecret = v.clearAppSecret ? "" : (v.appSecret?.trim() || current.zalo.appSecret);
    const nextAccessToken = v.clearAccessToken ? "" : (v.accessToken?.trim() || current.zalo.accessToken);
    const nextRefreshToken = v.clearRefreshToken ? "" : (v.refreshToken?.trim() || current.zalo.refreshToken);
    const nextWebhookSecret = v.clearWebhookSecret ? "" : (v.webhookSecret?.trim() || current.zalo.webhookSecret);
    const nextZalo = {
      ...current.zalo,
      enabled: v.enabled,
      deliveryMode: v.deliveryMode,
      oaId: v.oaId,
      appId: v.appId,
      appSecret: nextAppSecret,
      appSecretSet: Boolean(nextAppSecret),
      accessToken: nextAccessToken,
      accessTokenSet: Boolean(nextAccessToken),
      refreshToken: nextRefreshToken,
      refreshTokenSet: Boolean(nextRefreshToken),
      webhookSecret: nextWebhookSecret,
      webhookSecretSet: Boolean(nextWebhookSecret),
      portalTemplateId: v.portalTemplateId,
      invoiceTemplateId: v.invoiceTemplateId,
      debtTemplateId: v.debtTemplateId,
    };
    const next = { ...current, zalo: nextZalo };
    await db.insert(storeSettings)
      .values({ id: "default", prefs: next })
      .onConflictDoUpdate({ target: storeSettings.id, set: { prefs: next, updatedAt: sql`now()` } });
    await writeAuditLog({
      actorUserId: gate.userId,
      source: "manual",
      action: "update_zalo_settings",
      entityType: "store_settings",
      entityId: "default",
      status: "succeeded",
      before: {
        enabled: current.zalo.enabled,
        deliveryMode: current.zalo.deliveryMode,
        oaId: current.zalo.oaId,
        appId: current.zalo.appId,
        appSecretSet: Boolean(current.zalo.appSecret),
        accessTokenSet: Boolean(current.zalo.accessToken),
        refreshTokenSet: Boolean(current.zalo.refreshToken),
        webhookSecretSet: Boolean(current.zalo.webhookSecret),
        portalTemplateId: current.zalo.portalTemplateId,
        invoiceTemplateId: current.zalo.invoiceTemplateId,
        debtTemplateId: current.zalo.debtTemplateId,
      },
      after: {
        enabled: nextZalo.enabled,
        deliveryMode: nextZalo.deliveryMode,
        oaId: nextZalo.oaId,
        appId: nextZalo.appId,
        appSecretSet: Boolean(nextZalo.appSecret),
        accessTokenSet: Boolean(nextZalo.accessToken),
        refreshTokenSet: Boolean(nextZalo.refreshToken),
        webhookSecretSet: Boolean(nextZalo.webhookSecret),
        portalTemplateId: nextZalo.portalTemplateId,
        invoiceTemplateId: nextZalo.invoiceTemplateId,
        debtTemplateId: nextZalo.debtTemplateId,
      },
      metadata: {
        secretsChanged: [
          v.clearAppSecret || Boolean(v.appSecret?.trim()) ? "appSecret" : null,
          v.clearAccessToken || Boolean(v.accessToken?.trim()) ? "accessToken" : null,
          v.clearRefreshToken || Boolean(v.refreshToken?.trim()) ? "refreshToken" : null,
          v.clearWebhookSecret || Boolean(v.webhookSecret?.trim()) ? "webhookSecret" : null,
        ].filter(Boolean),
      },
    });
    revalidatePath(Routes.Settings);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("updateZaloSettings failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function updateShopeeSettings(input: ShopeeSettingsInput): Promise<ActionResult> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;
  const parsed = shopeeSettingsInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    const [row] = await db.select({ prefs: storeSettings.prefs }).from(storeSettings).where(eq(storeSettings.id, "default")).limit(1);
    const current = parseStorePrefs(row?.prefs);
    const nextPartnerKey = v.clearPartnerKey ? "" : (v.partnerKey?.trim() || current.shopee.partnerKey);
    const nextShopee = {
      ...current.shopee,
      enabled: v.enabled,
      environment: v.environment,
      region: v.region || "VN",
      partnerId: v.partnerId,
      partnerKey: nextPartnerKey,
      partnerKeySet: Boolean(nextPartnerKey),
      redirectPath: v.redirectPath || "/api/shopee/callback",
      defaultShopId: v.defaultShopId,
      defaultWarehouseId: v.defaultWarehouseId,
      syncInventory: v.syncInventory,
      syncOrders: v.syncOrders,
      syncMessages: v.syncMessages,
      autoCreateCustomer: v.autoCreateCustomer,
    };
    const next = { ...current, shopee: nextShopee };
    await db.insert(storeSettings)
      .values({ id: "default", prefs: next })
      .onConflictDoUpdate({ target: storeSettings.id, set: { prefs: next, updatedAt: sql`now()` } });
    await writeAuditLog({
      actorUserId: gate.userId,
      source: "manual",
      action: "update_shopee_settings",
      entityType: "store_settings",
      entityId: "default",
      status: "succeeded",
      before: {
        enabled: current.shopee.enabled,
        environment: current.shopee.environment,
        region: current.shopee.region,
        partnerId: current.shopee.partnerId,
        partnerKeySet: Boolean(current.shopee.partnerKey),
        defaultShopId: current.shopee.defaultShopId,
        syncInventory: current.shopee.syncInventory,
        syncOrders: current.shopee.syncOrders,
        syncMessages: current.shopee.syncMessages,
      },
      after: {
        enabled: nextShopee.enabled,
        environment: nextShopee.environment,
        region: nextShopee.region,
        partnerId: nextShopee.partnerId,
        partnerKeySet: Boolean(nextShopee.partnerKey),
        defaultShopId: nextShopee.defaultShopId,
        syncInventory: nextShopee.syncInventory,
        syncOrders: nextShopee.syncOrders,
        syncMessages: nextShopee.syncMessages,
      },
      metadata: { partnerKeyChanged: v.clearPartnerKey || Boolean(v.partnerKey?.trim()) },
    });
    revalidatePath(Routes.Settings);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("updateShopeeSettings failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function testAiProvider(input: AiSettingsInput, kind: AiProviderTestKind): Promise<ActionResult<AiProviderTestResult>> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;
  if (kind !== "text" && kind !== "vision") return { ok: false, error: "errors.invalidData" };
  const parsed = aiSettingsInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    const [row] = await db.select({ prefs: storeSettings.prefs }).from(storeSettings).where(eq(storeSettings.id, "default")).limit(1);
    const current = parseStorePrefs(row?.prefs);
    const nextKey = v.clearOpenaiApiKey
      ? ""
      : (v.openaiApiKey?.trim() || current.ai.openaiApiKey);
    const config = buildAiProviderConfig({
      ...current.ai,
      provider: v.provider,
      textModel: v.textModel,
      visionModel: v.visionModel,
      openaiVisionModel: v.visionModel,
      openaiApiKey: nextKey,
      openaiApiKeySet: Boolean(nextKey),
      attachmentsBucket: v.attachmentsBucket,
      monthlyUsageLimit: v.monthlyUsageLimit,
      showFloatingLauncher: v.showFloatingLauncher,
    });
    const base: Omit<AiProviderTestResult, "ok" | "message" | "tokenUsage"> = {
      kind,
      provider: config.provider,
      textModel: config.textModel,
      visionModel: config.visionModel,
      keyConfigured: Boolean(config.apiKey),
      textPlanning: config.capabilities.textPlanning,
      visionOcr: config.capabilities.visionOcr,
      testedAt: new Date().toISOString(),
    };
    if (!config.apiKey) {
      return { ok: true, data: { ...base, ok: false, message: "missing_api_key" } };
    }
    if (kind === "text" && !config.capabilities.textPlanning) {
      return { ok: true, data: { ...base, ok: false, message: "unsupported_text_planning" } };
    }
    if (kind === "vision" && !config.capabilities.visionOcr) {
      return { ok: true, data: { ...base, ok: false, message: "unsupported_vision" } };
    }
    const completion = kind === "text"
      ? await completeAiText({
        config,
        messages: [
          { role: "system", text: "You are a health check endpoint. Reply with exactly OK." },
          { role: "user", text: "LumaPOS AI provider diagnostics ping." },
        ],
      })
      : await completeAiVision({
        config,
        prompt: "Return exactly OK if you can read this tiny image.",
        imageDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3P1wAAAABJRU5ErkJggg==",
      });
    return {
      ok: true,
      data: {
        ...base,
        ok: true,
        message: completion.text.trim().slice(0, 80) || "ok",
        tokenUsage: completion.tokenUsage ? {
          inputTokens: completion.tokenUsage.inputTokens,
          outputTokens: completion.tokenUsage.outputTokens,
          totalTokens: completion.tokenUsage.totalTokens,
        } : undefined,
      },
    };
  } catch (error) {
    console.error("testAiProvider failed:", safeAiTestError(error));
    const config = buildAiProviderConfig({
      provider: v.provider,
      textModel: v.textModel,
      visionModel: v.visionModel,
      openaiApiKey: v.openaiApiKey?.trim() ?? "",
      openaiApiKeySet: Boolean(v.openaiApiKey?.trim()),
      openaiVisionModel: v.visionModel,
      attachmentsBucket: v.attachmentsBucket,
      monthlyUsageLimit: v.monthlyUsageLimit,
      showFloatingLauncher: v.showFloatingLauncher,
    });
    return {
      ok: true,
      data: {
        kind,
        provider: config.provider,
        textModel: config.textModel,
        visionModel: config.visionModel,
        keyConfigured: Boolean(config.apiKey),
        textPlanning: config.capabilities.textPlanning,
        visionOcr: config.capabilities.visionOcr,
        ok: false,
        message: safeAiTestError(error),
        testedAt: new Date().toISOString(),
      },
    };
  }
}

export async function updateStaffRole(id: string, role: StaffRole): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const mutation = parseStaffSettingsMutation({ id, role });
  if (!mutation) return { ok: false, error: "errors.invalidData" };
  const result = await applyStaffSettingsMutation({
    actorId: gate.userId,
    actorRole: gate.role,
    mutation,
    source: "manual",
  });
  if (!result.ok) return result;
  revalidatePath(Routes.Settings);
  return { ok: true, data: undefined };
}

export async function setStaffActive(id: string, active: boolean): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const mutation = parseStaffSettingsMutation({ id, active });
  if (!mutation) return { ok: false, error: "errors.invalidData" };
  const result = await applyStaffSettingsMutation({
    actorId: gate.userId,
    actorRole: gate.role,
    mutation,
    source: "manual",
  });
  if (!result.ok) return result;
  revalidatePath(Routes.Settings);
  return { ok: true, data: undefined };
}

export async function savePaymentBankAccount(input: PaymentBankAccountInput): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = paymentBankAccountInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    await db.transaction(async (tx) => {
      if (v.isDefault) {
        await tx
          .update(paymentBankAccounts)
          .set({ isDefault: false, updatedAt: sql`now()` })
          .where(eq(paymentBankAccounts.provider, v.provider));
      }
      if (v.id) {
        const [current] = await tx
          .select({ webhookSecret: paymentBankAccounts.webhookSecret, apiKey: paymentBankAccounts.apiKey })
          .from(paymentBankAccounts)
          .where(eq(paymentBankAccounts.id, v.id))
          .limit(1);
        await tx.update(paymentBankAccounts)
          .set({
            provider: v.provider,
            bankCode: v.bankCode,
            gateway: blankToNull(v.gateway),
            accountNumber: v.accountNumber,
            subAccount: blankToNull(v.subAccount),
            accountName: v.accountName,
            isDefault: v.isDefault,
            enabled: v.enabled,
            webhookEnabled: v.webhookEnabled,
            webhookSecret: blankToNull(v.webhookSecret) ?? current?.webhookSecret ?? null,
            apiKey: blankToNull(v.apiKey) ?? current?.apiKey ?? null,
            note: blankToNull(v.note),
            updatedAt: sql`now()`,
          })
          .where(eq(paymentBankAccounts.id, v.id));
      } else {
        await tx.insert(paymentBankAccounts).values({
          provider: v.provider,
          bankCode: v.bankCode,
          gateway: blankToNull(v.gateway),
          accountNumber: v.accountNumber,
          subAccount: blankToNull(v.subAccount),
          accountName: v.accountName,
          isDefault: v.isDefault,
          enabled: v.enabled,
          webhookEnabled: v.webhookEnabled,
          webhookSecret: blankToNull(v.webhookSecret),
          apiKey: blankToNull(v.apiKey),
          note: blankToNull(v.note),
          createdBy: gate.userId,
        });
      }
      const [defaultAccount] = await tx
        .select({ id: paymentBankAccounts.id })
        .from(paymentBankAccounts)
        .where(and(eq(paymentBankAccounts.provider, v.provider), eq(paymentBankAccounts.isDefault, true)))
        .limit(1);
      if (!defaultAccount) {
        const [firstEnabled] = await tx
          .select({ id: paymentBankAccounts.id })
          .from(paymentBankAccounts)
          .where(and(eq(paymentBankAccounts.provider, v.provider), eq(paymentBankAccounts.enabled, true)))
          .orderBy(asc(paymentBankAccounts.createdAt))
          .limit(1);
        if (firstEnabled) {
          await tx
            .update(paymentBankAccounts)
            .set({ isDefault: true, updatedAt: sql`now()` })
            .where(eq(paymentBankAccounts.id, firstEnabled.id));
        }
      }
    });
    revalidatePath(Routes.Settings);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("savePaymentBankAccount failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function setPaymentBankAccountEnabled(id: string, enabled: boolean): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  try {
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ provider: paymentBankAccounts.provider, isDefault: paymentBankAccounts.isDefault })
        .from(paymentBankAccounts)
        .where(eq(paymentBankAccounts.id, id))
        .limit(1);
      await tx.update(paymentBankAccounts)
        .set({ enabled, ...(enabled ? {} : { isDefault: false }), updatedAt: sql`now()` })
        .where(eq(paymentBankAccounts.id, id));
      if (current?.isDefault && !enabled) {
        const [next] = await tx
          .select({ id: paymentBankAccounts.id })
          .from(paymentBankAccounts)
          .where(and(eq(paymentBankAccounts.provider, current.provider), eq(paymentBankAccounts.enabled, true)))
          .orderBy(asc(paymentBankAccounts.createdAt))
          .limit(1);
        if (next) {
          await tx
            .update(paymentBankAccounts)
            .set({ isDefault: true, updatedAt: sql`now()` })
            .where(eq(paymentBankAccounts.id, next.id));
        }
      }
    });
    revalidatePath(Routes.Settings);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("setPaymentBankAccountEnabled failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function setDefaultPaymentBankAccount(id: string): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  try {
    await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ provider: paymentBankAccounts.provider })
        .from(paymentBankAccounts)
        .where(eq(paymentBankAccounts.id, id))
        .limit(1);
      if (!target) return;
      await tx.update(paymentBankAccounts)
        .set({ isDefault: false, updatedAt: sql`now()` })
        .where(eq(paymentBankAccounts.provider, target.provider));
      await tx.update(paymentBankAccounts)
        .set({ isDefault: true, enabled: true, updatedAt: sql`now()` })
        .where(eq(paymentBankAccounts.id, id));
    });
    revalidatePath(Routes.Settings);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("setDefaultPaymentBankAccount failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function deletePaymentBankAccount(id: string): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  try {
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ provider: paymentBankAccounts.provider, isDefault: paymentBankAccounts.isDefault })
        .from(paymentBankAccounts)
        .where(eq(paymentBankAccounts.id, id))
        .limit(1);
      if (!current) return;
      await tx.delete(paymentBankAccounts).where(eq(paymentBankAccounts.id, id));
      if (current.isDefault) {
        const [next] = await tx
          .select({ id: paymentBankAccounts.id })
          .from(paymentBankAccounts)
          .where(and(eq(paymentBankAccounts.provider, current.provider), eq(paymentBankAccounts.enabled, true)))
          .orderBy(asc(paymentBankAccounts.createdAt))
          .limit(1);
        if (next) {
          await tx
            .update(paymentBankAccounts)
            .set({ isDefault: true, updatedAt: sql`now()` })
            .where(eq(paymentBankAccounts.id, next.id));
        }
      }
    });
    revalidatePath(Routes.Settings);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("deletePaymentBankAccount failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
