export function shouldExcludeNotificationActor(input: {
  excludeActor?: boolean;
  actorId?: string | null;
  directRecipientIds: ReadonlySet<string>;
  recipientIds: Iterable<string>;
}) {
  if (
    !input.excludeActor
    || !input.actorId
    || input.directRecipientIds.has(input.actorId)
  ) {
    return false;
  }
  // Avoid a zero-recipient event for a one-person store. Once another eligible
  // recipient exists, suppress the actor as before to prevent redundant push.
  return [...input.recipientIds].some(
    (recipientId) => recipientId !== input.actorId,
  );
}
