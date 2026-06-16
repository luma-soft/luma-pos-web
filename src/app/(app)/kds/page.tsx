import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getStoreSettings } from "@/lib/data/settings";
import { getActiveTickets } from "@/lib/data/kitchen";
import { KdsBoard } from "./kds-board";

export const dynamic = "force-dynamic";
const FNB = new Set(["restaurant", "cafe"]);

export default async function KdsPage() {
  const store = await getStoreSettings();
  if (!FNB.has(store.industry)) redirect("/dashboard");
  const t = await getTranslations();
  const tickets = await getActiveTickets();
  const data = tickets.map((tk) => ({
    id: tk.id, tableName: tk.tableName, round: tk.round, createdAtMs: new Date(tk.createdAt).getTime(),
    items: tk.items,
  }));

  return (
    <div className="p-6">
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-5 min-h-13 px-6 py-2.5 bg-surface border-b border-border flex items-center gap-2">
        <h1 className="text-[17px] font-bold">{t("kds.title")}</h1>
        <span className="text-xs text-slate-400">· {t("kds.sub")}</span>
      </div>
      <KdsBoard tickets={data} />
    </div>
  );
}
