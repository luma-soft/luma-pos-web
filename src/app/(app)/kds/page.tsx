import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getStoreSettings } from "@/lib/data/settings";
import { getActiveTickets } from "@/lib/data/kitchen";
import { Text } from "@/components/ui/text";
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
    <div className="min-w-0 overflow-x-hidden p-4 [&_button]:min-h-11 sm:p-6 lg:[&_button]:min-h-0">
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 mb-5 min-h-13 px-4 sm:px-6 py-2.5 bg-surface border-b border-border flex items-center gap-2 flex-wrap">
        <Text as="h1" weight="bold" className="text-[17px]" text={t("kds.title")} />
        <Text as="span" variant="muted" size="xs" text={`· ${t("kds.sub")}`} />
      </div>
      <KdsBoard tickets={data} />
    </div>
  );
}
