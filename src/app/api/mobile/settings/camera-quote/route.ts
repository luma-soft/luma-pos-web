import { updateCameraQuoteSettingsForUser } from "@/lib/actions/settings";
import { authorizeMobileSensitiveAction } from "@/lib/auth/mobile-approval";
import { getCameraQuoteFormOptions } from "@/lib/data/camera-quotes";
import { getStoreSettings } from "@/lib/data/settings";
import { requireMobileManager, requireMobileRole } from "@/lib/mobile/auth";
import { MOBILE_SETTINGS_ADMIN_ROLES } from "@/lib/settings/mobile-settings-access";
import {
  mobileAction,
  mobileError,
  mobileGate,
  mobileOk,
  readJson,
} from "@/lib/mobile/response";
import type { StorePrefs } from "@/lib/schemas/settings";

function productOptions(
  options: Awaited<ReturnType<typeof getCameraQuoteFormOptions>>,
) {
  const map = (products: typeof options.cameras) =>
    products.map(({ id, sku, name, retailPrice }) => ({
      id,
      sku,
      name,
      retailPrice,
    }));
  return {
    cameras: map(options.cameras),
    cards: map(options.cards),
    installations: map(options.installations),
    materials: map(options.materials),
  };
}

export async function GET() {
  const gate = await requireMobileRole(MOBILE_SETTINGS_ADMIN_ROLES);
  if (!gate.ok) return mobileGate(gate)!;

  const [settings, options] = await Promise.all([
    getStoreSettings(gate.storeId),
    getCameraQuoteFormOptions(gate.storeId, false, false),
  ]);
  return mobileOk({
    prefs: settings.prefs.cameraQuote,
    options: productOptions(options),
  });
}

export async function PATCH(request: Request) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate)!;

  const body = await readJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }

  const authorization = await authorizeMobileSensitiveAction({
    request,
    storeId: gate.storeId,
    requesterId: gate.userId,
    requesterRole: gate.role,
    permission: "settings.sensitive",
    scope: "settings:camera-quote",
  });
  if (!authorization.ok) return mobileError(authorization.error, 403);

  return mobileAction(
    await updateCameraQuoteSettingsForUser(
      gate.userId,
      body as StorePrefs["cameraQuote"],
    ),
  );
}
