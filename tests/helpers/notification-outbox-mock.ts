type OutboxMock = Record<string, (...args: never[]) => unknown>;

export function createNotificationOutboxMock(
  overrides: Partial<OutboxMock> = {},
): OutboxMock {
  return {
    recordNotificationQueueRejection: () => undefined,
    publishCommittedNotification: async () => undefined,
    recoverDueNotifications: async () => 0,
    processNotificationMessage: async () => ({ completed: true }),
    republishDeadNotification: async () => false,
    ...overrides,
  };
}
