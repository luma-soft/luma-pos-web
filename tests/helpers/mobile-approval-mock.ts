type ApprovalMock = Record<string, (...args: never[]) => unknown>;

export function createMobileApprovalMock(
  overrides: Partial<ApprovalMock> = {},
): ApprovalMock {
  return {
    approvalModeFor: () => "reauth",
    createApprovalCredential: () => ({ token: "test-token", tokenHash: "test-token-hash" }),
    hashApprovalToken: () => "test-token-hash",
    issueMobileApproval: async () => ({ ok: false, error: "errors.unauthorized" }),
    consumeMobileApproval: async () => ({ ok: false, error: "errors.unauthorized" }),
    authorizeMobileSensitiveAction: async () => ({ ok: false, error: "errors.unauthorized" }),
    ...overrides,
  };
}
