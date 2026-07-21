export const OFFLINE_ACTOR_HEADER = "x-luma-offline-actor";

type OfflineReplayActor = {
  header: string | null;
  principalId: string;
  actorId: string;
};

export function offlineActorKey(principalId: string, actorId: string) {
  return `${principalId.trim()}:${actorId.trim()}`;
}

export function validateOfflineReplayActor({
  header,
  principalId,
  actorId,
}: OfflineReplayActor) {
  if (header === null) return true;
  const supplied = header.trim();
  if (!supplied) return false;
  return supplied === offlineActorKey(principalId, actorId);
}
