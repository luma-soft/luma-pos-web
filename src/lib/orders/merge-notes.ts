/**
 * Keep operator-entered invoice notes separate from audit-only merge history.
 * Legacy merged invoices used to persist their merge marker in orders.note.
 * New merges derive the marker from replaced_by_order_id instead.
 */
export function separateMergeNotes(
  rawNote: string | null,
  context: {
    mergedFromCodes?: readonly string[];
    mergedIntoCode?: string | null;
    isMergedDocument?: boolean;
    isMergedSource?: boolean;
  } = {},
): { userNote: string | null; systemNote: string | null } {
  let userNote = rawNote?.trim() ?? "";
  let systemNote: string | null = null;

  const sourceCodes = context.mergedFromCodes ?? [];
  if (sourceCodes.length >= 2) {
    systemNote = `Gộp từ: ${sourceCodes.join(", ")}`;
    const legacySourceText = /^Gộp từ:\s*(.+)$/u.exec(userNote);
    if (legacySourceText) {
      const oldCodes = legacySourceText[1].split(",").map((code) => code.trim()).filter(Boolean).sort();
      const linkedCodes = [...sourceCodes].sort();
      if (oldCodes.length === linkedCodes.length && oldCodes.every((code, index) => code === linkedCodes[index])) {
        userNote = "";
      }
    }
  } else if (context.isMergedDocument) {
    // Older data can lack backfilled source relationships. DHG- is the
    // system-generated merged invoice code prefix, so only infer here.
    if (/^Gộp từ:\s*([^\s,]+(?:,\s*[^\s,]+)+)$/u.test(userNote)) {
      systemNote = userNote;
      userNote = "";
    }
  }

  if (!systemNote && (context.mergedIntoCode || context.isMergedSource)) {
    const legacyDestination = /(?:^| · )Đã gộp vào (DHG-[\w-]+)$/u.exec(userNote)?.[1];
    const destinationCode = context.mergedIntoCode ?? legacyDestination;
    if (destinationCode) {
      systemNote = `Đã gộp vào ${destinationCode}`;
      if (userNote === systemNote) {
        userNote = "";
      } else if (userNote.endsWith(` · ${systemNote}`)) {
        userNote = userNote.slice(0, -(` · ${systemNote}`).length).trim();
      }
    }
  }

  return { userNote: userNote || null, systemNote };
}
