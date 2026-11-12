import { getLocalFileStorage } from "@/lib/media/local-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const storage = getLocalFileStorage();
  const token = storage.verifyToken(new URL(request.url).searchParams.get("token"), "upload");
  if (!token || !token.contentType || !token.contentLength) {
    return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== token.contentType.toLowerCase() ||
    request.headers.get("if-none-match") !== "*" ||
    !request.body
  ) {
    return new Response(null, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const declaredSize = request.headers.get("content-length");
  if (declaredSize && Number(declaredSize) !== token.contentLength) {
    return new Response(null, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    await storage.putRequestBody({
      bucket: token.bucket,
      key: token.key,
      body: request.body,
      contentType: token.contentType,
      contentLength: token.contentLength,
    });
    return new Response(null, {
      status: 201,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    const code = error && typeof error === "object" ? (error as { outcome?: unknown }).outcome : null;
    return new Response(null, {
      status: code === "definitive-no-write" ? 412 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
