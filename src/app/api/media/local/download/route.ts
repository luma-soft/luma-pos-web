import { Readable } from "node:stream";
import { attachmentContentDisposition } from "@/lib/media/r2-storage";
import { getLocalFileStorage } from "@/lib/media/local-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const storage = getLocalFileStorage();
  const token = storage.verifyToken(new URL(request.url).searchParams.get("token"), "download");
  if (!token) return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });

  try {
    const metadata = await storage.head({ bucket: token.bucket, key: token.key });
    if (!metadata) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    const headers = new Headers({
      "Cache-Control": "private, no-store",
      "Content-Type": token.contentType ?? metadata.contentType ?? "application/octet-stream",
      "Content-Length": String(metadata.sizeBytes),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    });
    if (token.downloadFileName) {
      headers.set("Content-Disposition", attachmentContentDisposition(token.downloadFileName));
    }
    return new Response(Readable.toWeb(storage.createReadStream({
      bucket: token.bucket,
      key: token.key,
    })) as ReadableStream, { headers });
  } catch {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
