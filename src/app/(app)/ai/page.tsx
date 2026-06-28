import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getRole, requireUser } from "@/lib/actions/common";
import { getStoreSettings } from "@/lib/data/settings";
import { Text } from "@/components/ui/text";
import { Assistant } from "./assistant";
import { AiHelpButton } from "./ai-help-button";

export const dynamic = "force-dynamic";

export default async function AiPage() {
  const [t, user, store] = await Promise.all([
    getTranslations(),
    requireUser(),
    getStoreSettings(),
  ]);
  if (!store.prefs.ai.openaiApiKeySet) {
    const role = await getRole(user.id);
    redirect(role === "owner" ? "/settings?tab=ai" : "/dashboard");
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden p-4 sm:p-6">
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 mb-5 shrink-0 bg-surface border-b border-border">
        <div className="min-h-13 px-4 sm:px-6 pt-2.5 flex items-center gap-2">
          <Text as="h1" weight="bold" className="text-[17px]" text={t("nav.ai")} />
          <AiHelpButton />
        </div>
      </div>

      <Assistant />
    </div>
  );
}
