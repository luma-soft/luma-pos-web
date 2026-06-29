import { getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/utils";
import { requireUser, getProfileId } from "@/lib/actions/common";
import { getCurrentShift, getShiftSummary, getShifts } from "@/lib/data/shifts";
import { ShiftPanel } from "../shift-panel";
import { ShiftsTable } from "./shifts-table";

export async function ShiftsTab() {
  const t = await getTranslations();
  let openProps: { open: boolean; openingFloat?: number; expected?: number; openedAt?: string } = { open: false };
  try {
    const userId = (await requireUser()).id;
    const profileId = await getProfileId(userId);
    if (profileId) {
      const cur = await getCurrentShift(profileId);
      if (cur) {
        const summary = await getShiftSummary(cur);
        openProps = { open: true, openingFloat: Number(cur.openingFloat), expected: summary.expectedCash ?? 0, openedAt: formatDate(cur.openedAt) };
      }
    }
  } catch { /* layout handles auth */ }

  const rows = await getShifts(50);

  return (
    <>
      <ShiftPanel {...openProps} />

      <div className="bg-surface border border-border rounded-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border font-bold text-sm">{t("shifts.historyTitle")}</div>
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">{t("shifts.empty")}</p>
        ) : (
          <ShiftsTable rows={rows} />
        )}
      </div>
    </>
  );
}
