/**
 * Origin the client actually used to reach this server.
 *
 * Behind the Cloudflare Tunnel, Next builds `request.url` from the address it
 * is bound to (e.g. `https://localhost:3200`), so absolute links built from it
 * point at the store Mac instead of the public host. Prefer the forwarded /
 * `Host` headers the proxy passes through, and fall back to `request.url`.
 */
export function publicRequestOrigin(request: Request): string {
  const fallback = new URL(request.url);
  const firstHeader = (name: string) => request.headers.get(name)?.split(",")[0]?.trim() || null;

  const host = firstHeader("x-forwarded-host") ?? firstHeader("host");
  if (!host || !/^[A-Za-z0-9.\-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](:\d{1,5})?$/.test(host)) {
    return fallback.origin;
  }

  const forwardedProto = firstHeader("x-forwarded-proto")?.toLowerCase();
  const protocol = forwardedProto === "https" || forwardedProto === "http"
    ? forwardedProto
    : fallback.protocol.replace(/:$/, "");
  return `${protocol}://${host}`;
}
