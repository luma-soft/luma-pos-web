export type DeclarationPeriod = {
  periodType: "monthly" | "quarterly" | "annual" | "per_occurrence";
  periodKey: string;
  from: string;
  to: string;
};

export function currentDeclarationPeriod(
  frequency: string,
  now = new Date(),
): DeclarationPeriod | null {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  if (frequency === "monthly") {
    return {
      periodType: "monthly",
      periodKey: `${year}-${String(month).padStart(2, "0")}`,
      from: new Date(year, month - 1, 1).toISOString(),
      to: new Date(year, month, 1).toISOString(),
    };
  }

  if (frequency === "quarterly") {
    const quarter = Math.floor((month - 1) / 3) + 1;
    return {
      periodType: "quarterly",
      periodKey: `${year}-Q${quarter}`,
      from: new Date(year, (quarter - 1) * 3, 1).toISOString(),
      to: new Date(year, quarter * 3, 1).toISOString(),
    };
  }

  if (frequency === "annual") {
    return {
      periodType: "annual",
      periodKey: `${year}`,
      from: new Date(year, 0, 1).toISOString(),
      to: new Date(year + 1, 0, 1).toISOString(),
    };
  }

  return null;
}

export function occurrenceDeclarationPeriod(dateValue: string): DeclarationPeriod | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return null;
  const [year, month, day] = dateValue.split("-").map(Number);
  const from = new Date(year, month - 1, day);
  if (from.getFullYear() !== year || from.getMonth() !== month - 1 || from.getDate() !== day) return null;
  const to = new Date(year, month - 1, day + 1);
  return { periodType: "per_occurrence", periodKey: dateValue, from: from.toISOString(), to: to.toISOString() };
}
