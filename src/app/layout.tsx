import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { getTheme, getMode } from "@/lib/theme/cookie";
import { ServiceWorkerRegister } from "@/components/sw-register";
import "./globals.css";

// Be Vietnam Pro: font chữ chính, có subset vietnamese đầy đủ (đúng dấu).
// JetBrains Mono: font số liệu (tiền/SL) — bật tabular figures để căn cột.
const beVietnam = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-be-vietnam",
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "LumaPOS",
  description: "LumaPOS — Quản lý bán hàng",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "LumaPOS" },
  icons: { icon: "/icon-192.png", apple: "/icon-180.png" },
};

export const viewport: Viewport = {
  themeColor: "#2563EB",
  viewportFit: "cover",
};

/** Chạy trước paint: mode "system" resolve theo OS để không bị flash. */
const MODE_INIT = `(function(){try{var d=document.documentElement;if(d.dataset.mode==="system"){d.dataset.mode=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}}catch(e){}})()`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const theme = await getTheme();
  const mode = await getMode();

  return (
    <html
      lang={locale}
      data-theme={theme}
      data-mode={mode}
      className={`${beVietnam.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: MODE_INIT }} />
        <ServiceWorkerRegister />
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
