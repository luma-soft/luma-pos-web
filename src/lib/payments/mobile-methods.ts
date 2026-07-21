export type MobilePaymentMethodId =
  | "cash"
  | "qr"
  | "card"
  | "momo"
  | "zalopay"
  | "vnpay"
  | "credit";

export type MobilePaymentMethodCapability = {
  id: MobilePaymentMethodId;
  enabled: boolean;
  available: boolean;
  settlement: "manual_confirmed" | "sepay_pending" | "gateway_pending" | "debt";
  unavailableReason?: string;
};

type PaymentPreferences = Record<MobilePaymentMethodId, boolean>;

export function buildMobilePaymentMethods(input: {
  prefs: PaymentPreferences;
  hasSepayAccount: boolean;
  gatewayAvailability: Record<"momo" | "zalopay" | "vnpay", boolean>;
}): MobilePaymentMethodCapability[] {
  const { prefs, hasSepayAccount, gatewayAvailability } = input;
  return [
    {
      id: "cash",
      enabled: prefs.cash,
      available: true,
      settlement: "manual_confirmed",
    },
    {
      id: "qr",
      enabled: prefs.qr,
      available: hasSepayAccount,
      settlement: "sepay_pending",
      ...(!hasSepayAccount
        ? { unavailableReason: "payments.errors.bankAccountNotFound" }
        : {}),
    },
    {
      id: "card",
      enabled: prefs.card,
      available: true,
      settlement: "manual_confirmed",
    },
    ...(["momo", "zalopay", "vnpay"] as const).map((id) => ({
      id,
      enabled: prefs[id],
      available: gatewayAvailability[id],
      settlement: "gateway_pending" as const,
      ...(!gatewayAvailability[id]
        ? { unavailableReason: "payments.errors.providerNotConfigured" }
        : {}),
    })),
    {
      id: "credit",
      enabled: prefs.credit,
      available: true,
      settlement: "debt",
    },
  ];
}
