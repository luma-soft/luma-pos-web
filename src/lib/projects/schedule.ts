import { businessDateKey } from "@/lib/dates/business-date";

export type ProjectScheduleState = {
  orderInvalid: boolean;
  targetInPast: boolean;
};

export function projectScheduleState(input: {
  startsOn?: string | null;
  targetEndsOn?: string | null;
  completed: boolean;
  today?: string;
}): ProjectScheduleState {
  const startsOn = input.startsOn?.trim() ?? "";
  const targetEndsOn = input.targetEndsOn?.trim() ?? "";
  const today = input.today ?? businessDateKey();
  return {
    orderInvalid: Boolean(startsOn && targetEndsOn && targetEndsOn < startsOn),
    targetInPast: Boolean(
      targetEndsOn && targetEndsOn < today && !input.completed,
    ),
  };
}
