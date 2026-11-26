import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const backendOrigin = (process.env.LUMAPOS_BACKEND_URL?.trim()
  || `http://127.0.0.1:${process.env.LUMAPOS_BACKEND_PORT?.trim() || "3001"}`).replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // Self-hosted releases (ops/macos/build-release.sh) ship the standalone
  // server; other builds keep the default output.
  ...(process.env.LUMAPOS_NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  // Cho phép CI/sandbox build ra thư mục khác (mặc định .next)
  distDir: process.env.NEXT_DIST_DIR || ".next",
  turbopack: {
    root: process.cwd(),
  },
  // API requests (web clients, the iOS app, webhooks) go to the backend
  // service (luma-pos-backend) on this Mac; the browser keeps one origin.
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/api/:path*", destination: `${backendOrigin}/api/:path*` },
      ],
    };
  },
  experimental: {
    // Uploads, exports and AI requests can take longer than the 30 s default.
    proxyTimeout: 10 * 60_000,
    // Client Router Cache: giữ payload RSC của trang động 30s → đổi qua lại
    // giữa Sản phẩm/Thiết lập giá/Tồn kho trong 30s không query lại DB.
    staleTimes: { dynamic: 30, static: 180 },
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
