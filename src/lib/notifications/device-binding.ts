import type { Role } from "@/lib/actions/common";

type PushDeviceActor = {
  principalId?: string;
  userId: string;
  role: Role;
};

export function pushDeviceBinding(actor: PushDeviceActor) {
  return {
    principalId: actor.principalId ?? actor.userId,
    effectiveUserId: actor.userId,
  };
}
