import { redirect } from "next/navigation";
import { getStoreSettings } from "@/lib/data/settings";
import { requireStoreContext } from "@/lib/auth/store-context";
import { OnboardingWizard } from "./onboarding-wizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const context = await requireStoreContext();
  const store = await getStoreSettings(context.storeId);
  if (store.onboarded) redirect("/dashboard");
  return <OnboardingWizard initial={store} />;
}
