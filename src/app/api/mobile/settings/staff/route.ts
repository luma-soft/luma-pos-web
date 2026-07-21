import { authorizeMobileSensitiveAction } from "@/lib/auth/mobile-approval";
import { getStaff } from "@/lib/data/settings";
import { requireMobileManager } from "@/lib/mobile/auth";
import {
  mobileAction,
  mobileError,
  mobileGate,
  mobileOk,
  readJson,
} from "@/lib/mobile/response";
import { applyStaffSettingsMutation } from "@/lib/settings/staff-settings-service";
import { parseStaffSettingsMutation } from "@/lib/settings/staff-settings-mutation";

export async function GET() {
  const gate = await requireMobileManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  return mobileOk(await getStaff());
}

export async function PATCH(request: Request) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate)!;

  const body = await readJson(request);
  const mutation = parseStaffSettingsMutation(body);
  if (!mutation) {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }

  const authorization = await authorizeMobileSensitiveAction({
    request,
    requesterId: gate.userId,
    requesterRole: gate.role,
    permission: "settings.sensitive",
    scope: mutation.scope,
  });
  if (!authorization.ok) return mobileError(authorization.error, 403);

  return mobileAction(await applyStaffSettingsMutation({
    actorId: gate.userId,
    actorRole: gate.role,
    mutation,
    source: "mobile",
  }));
}
