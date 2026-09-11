import { resolveRevenueBook } from "@/lib/accounting/revenue-book";
import { getAccountingAuxiliaryBooks, getRevenueBook, getTaxActivityRevenue } from "@/lib/data/accounting";
import { getRawStorePrefs } from "@/lib/data/settings";
import { requireMobileManager } from "@/lib/mobile/auth";
import { mobileGate, mobileOk, searchParam } from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileManager(); if (!gate.ok) return mobileGate(gate)!;
  const prefs = await getRawStorePrefs(gate.storeId);
  const now = new Date();
  const year = Number(searchParam(request, "year", String(now.getFullYear()))) || now.getFullYear();
  const from = new Date(year, 0, 1); const to = new Date(year + 1, 0, 1);
  const [revenue, activityRevenue, auxiliary] = await Promise.all([
    getRevenueBook(gate.storeId, prefs.tax, { from, to, document: "all", einvoice: "all", page: 1, pageSize: 100 }),
    getTaxActivityRevenue(gate.storeId, from, to),
    getAccountingAuxiliaryBooks(gate.storeId, from, to),
  ]);
  return mobileOk({
    year,
    tax: { calculationMethod: prefs.tax.calculationMethod, filingFrequency: prefs.tax.filingFrequency },
    book: resolveRevenueBook(prefs.tax.calculationMethod),
    revenue,
    activityRevenue,
    books: { cash: auxiliary.cash.slice(0, 100), inventory: auxiliary.inventory.slice(0, 100), purchases: auxiliary.purchases.slice(0, 100), expenses: auxiliary.expenses.slice(0, 100), otherTaxes: auxiliary.taxes },
    declarations: auxiliary.declarations,
    bankAccounts: auxiliary.bankAccounts,
  });
}
