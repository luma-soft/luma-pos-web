import type { ActionResult } from "@/lib/actions/common";

export type TableMoveTarget = {
  id: string;
  name: string;
  zone: string;
  status: string;
};

export function eligibleTableMoveTargets(
  sourceId: string,
  tables: readonly TableMoveTarget[],
) {
  return tables.filter((table) => table.id !== sourceId && table.status === "free");
}

export async function moveTableOrder(
  sourceId: string,
  targetId: string,
  mutation: (sourceId: string, targetId: string) => Promise<ActionResult>,
) {
  return mutation(sourceId, targetId);
}
