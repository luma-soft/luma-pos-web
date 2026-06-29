import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { paymentBankAccounts } from "@/db/schema";
import { matchSepayWebhookEvent, recordSepayWebhookEvent } from "@/lib/payments/service";
import { normalizeSepayWebhookPayload, verifySepaySignature } from "@/lib/payments/sepay";

function bearerToken(value: string | null) {
  return value?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
}

function headerSignature(request: Request) {
  return request.headers.get("x-sepay-signature")
    ?? request.headers.get("sepay-signature")
    ?? request.headers.get("x-signature");
}

function headerApiKey(request: Request) {
  return request.headers.get("x-sepay-api-key")
    ?? request.headers.get("x-api-key")
    ?? bearerToken(request.headers.get("authorization"));
}

function headerTimestamp(request: Request) {
  return request.headers.get("x-sepay-timestamp")
    ?? request.headers.get("sepay-timestamp")
    ?? request.headers.get("x-timestamp");
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "errors.invalidData" }, { status: 400 });
  }

  const event = normalizeSepayWebhookPayload(json);
  if (!event || !event.accountNumber) {
    return NextResponse.json({ ok: false, error: "errors.invalidData" }, { status: 400 });
  }

  const [account] = await db
    .select()
    .from(paymentBankAccounts)
    .where(and(
      eq(paymentBankAccounts.provider, "sepay"),
      eq(paymentBankAccounts.accountNumber, event.accountNumber),
      eq(paymentBankAccounts.enabled, true),
    ))
    .limit(1);

  const configuredSecret = process.env.SEPAY_WEBHOOK_SECRET?.trim() || account?.webhookSecret?.trim() || null;
  const validSignature = verifySepaySignature(rawBody, headerSignature(request), configuredSecret, headerTimestamp(request));
  const configuredApiKey = process.env.SEPAY_API_KEY?.trim() || account?.apiKey?.trim();
  const validApiKey = Boolean(configuredApiKey && headerApiKey(request) === configuredApiKey);
  const hasConfiguredAuth = Boolean(configuredSecret || configuredApiKey);
  if (hasConfiguredAuth && !validSignature && !validApiKey) {
    return NextResponse.json({ ok: false, error: "errors.unauthorized" }, { status: 401 });
  }

  const recorded = await recordSepayWebhookEvent(event);
  if (!recorded.ok) {
    return NextResponse.json({ ok: false, error: recorded.error }, { status: 500 });
  }
  if (!account) {
    return NextResponse.json({
      success: true,
      ok: true,
      data: {
        eventId: recorded.data.eventId,
        duplicate: recorded.data.duplicate,
        matched: false,
        reason: "bank_account_not_found",
      },
    });
  }
  if (!account.webhookEnabled) {
    return NextResponse.json({
      success: true,
      ok: true,
      data: {
        eventId: recorded.data.eventId,
        duplicate: recorded.data.duplicate,
        matched: false,
        reason: "webhook_disabled",
      },
    });
  }

  const matched = await matchSepayWebhookEvent(recorded.data.eventId);
  if (!matched.ok) {
    return NextResponse.json({ ok: false, error: matched.error }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    ok: true,
    data: {
      eventId: recorded.data.eventId,
      duplicate: recorded.data.duplicate,
      matched: matched.data.matched,
      reason: matched.data.reason,
    },
  });
}
