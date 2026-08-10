import { syncCameraDeviceLink } from "@/lib/camera-vendors/sync";
import { requireMobileServiceManager } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileServiceManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  const { id } = await params;
  try {
    return mobileOk(await syncCameraDeviceLink(id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "CAMERA_DEVICE_LINK_NOT_FOUND") {
      return mobileError("errors.notFound", 404);
    }
    if (message === "CAMERA_VENDOR_NOT_CONFIGURED" || message === "CAMERA_VENDOR_DISABLED") {
      return mobileError("services.cameraVendor.notConfigured", 409);
    }
    if (message === "CAMERA_VENDOR_RATE_LIMITED") {
      return mobileError("services.cameraVendor.rateLimited", 429);
    }
    return mobileError("services.cameraVendor.syncFailed", 502);
  }
}
