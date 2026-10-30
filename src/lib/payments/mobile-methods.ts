export type MobilePaymentMethodId =
  | "cash"
  | "qr"
  | "credit";

export type MobilePaymentMethodCapability = {
  id: MobilePaymentMethodId;
  enabled: boolean;
  available: boolean;
  settlement: "manual_confirmed" | "sepay_pending" | "gateway_pending" | "debt";
  unavailableReason?: string;
};

type PaymentPreferences = Pick<Record<MobilePaymentMethodId, boolean>, "cash" | "qr" | "credit">;

export function buildMobilePaymentMethods(input: {
  prefs: PaymentPreferences;
  hasSepayAccount: boolean;
}): MobilePaymentMethodCapability[] {
  const { prefs, hasSepayAccount } = input;
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
      id: "credit",
      enabled: prefs.credit,
      available: true,
      settlement: "debt",
    },
  ];
}
