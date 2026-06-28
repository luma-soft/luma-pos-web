import { getTranslations } from "next-intl/server";
import { Text } from "@/components/ui/text";
import { Assistant } from "./assistant";

export const dynamic = "force-dynamic";

export default async function AiPage() {
  const t = await getTranslations();

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden p-4 sm:p-6">
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 mb-5 shrink-0 bg-surface border-b border-border">
        <div className="min-h-13 px-4 sm:px-6 pt-2.5 flex items-center gap-2">
          <Text as="h1" weight="bold" className="text-[17px]" text={t("nav.ai")} />
        </div>
      </div>

      <Assistant />
    </div>
  );
}
