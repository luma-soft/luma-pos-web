import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { paymentBankAccounts } from "@/db/schema";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileGate, mobileOk } from "@/lib/mobile/response";
import { getRawStorePrefs } from "@/lib/data/settings";
import { buildMobilePaymentMethods } from "@/lib/payments/mobile-methods";
import { resolveGatewayAvailability } from "@/lib/payments/gateways";

export async function GET() {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const [prefs, account] = await Promise.all([
    getRawStorePrefs(),
    db
      .select({ id: paymentBankAccounts.id })
      .from(paymentBankAccounts)
      .where(
        and(
          eq(paymentBankAccounts.provider, "sepay"),
          eq(paymentBankAccounts.enabled, true),
        ),
      )
      .limit(1),
  ]);

  return mobileOk({
    methods: buildMobilePaymentMethods({
      prefs: prefs.payments,
      hasSepayAccount: account.length > 0,
      gatewayAvailability: resolveGatewayAvailability(process.env),
    }),
  });
}
