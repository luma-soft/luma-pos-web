type MobileAuthMock = Record<string, (...args: never[]) => Promise<unknown>>;

const deny = async () => ({ ok: false, error: "errors.unauthorized" });

export function createMobileAuthMock(
  overrides: Partial<MobileAuthMock> = {},
): MobileAuthMock {
  return {
    requireMobileRole: deny,
    requireMobileSalesAccess: deny,
    requireMobileStockAccess: deny,
    requireMobileStockReadAccess: deny,
    requireMobileManager: deny,
    requireMobileOwner: deny,
    requireMobileUser: deny,
    requireMobileServiceAccess: deny,
    requireMobileServiceManager: deny,
    requireMobileServiceStockAccess: deny,
    requireMobileServiceSalesAccess: deny,
    requireMobileAiUser: deny,
    requireMobileAiManager: deny,
    requireMobileAiStockAccess: deny,
    requireMobileEinvoiceManager: deny,
    requireMobileFeatureRole: deny,
    ...overrides,
  };
}
