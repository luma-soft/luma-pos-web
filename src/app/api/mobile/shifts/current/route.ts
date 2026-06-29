import { getProfileId } from "@/lib/actions/common";
import { getCurrentShift, getShiftSummary } from "@/lib/data/shifts";
import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileGate, mobileOk } from "@/lib/mobile/response";

export async function GET() {
  const gate = await requireMobileUser();
  if (!gate.ok) return mobileGate(gate)!;

  const profileId = await getProfileId(gate.userId);
  const shift = await getCurrentShift(profileId ?? gate.userId);
  const summary = await getShiftSummary(shift);

  return mobileOk({
    shift,
    expectedCash: summary.expectedCash,
    tenderTotals: summary.tenderTotals,
    orderCount: summary.orderCount,
    refundTotal: summary.refundTotal,
    cashIn: summary.cashIn,
    cashOut: summary.cashOut,
    zReportStatus: summary.zReportStatus,
  });
}
