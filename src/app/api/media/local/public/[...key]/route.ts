import { Readable } from "node:stream";
import { getLocalMediaConfig } from "@/lib/media/config";
import { getLocalFileStorage } from "@/lib/media/local-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_PRODUCT_KEY = /^stores\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/products\/[0-9]{4}\/(?:0[1-9]|1[0-2])\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:original\.(?:jpg|png|webp)|thumbnail\.webp)$/i;
const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string[] }> },
) {
  const { key: segments } = await context.params;
  const key = segments.join("/");
  if (!PUBLIC_PRODUCT_KEY.test(key)) return new Response(null, { status: 404 });

  try {
    const config = getLocalMediaConfig();
    const storage = getLocalFileStorage();
    const metadata = await storage.head({ bucket: config.publicBucket, key });
    if (!metadata) return new Response(null, { status: 404 });
    const extension = key.split(".").at(-1)?.toLowerCase() ?? "";
    return new Response(Readable.toWeb(storage.createReadStream({
      bucket: config.publicBucket,
      key,
    })) as ReadableStream, {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": CONTENT_TYPES[extension] ?? metadata.contentType ?? "application/octet-stream",
        "Content-Length": String(metadata.sizeBytes),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
