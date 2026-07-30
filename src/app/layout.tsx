import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { getTheme, getMode } from "@/lib/theme/cookie";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { ConfirmDialogProvider } from "@/components/confirm-dialog-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hải Đăng",
  description: "Hải Đăng — Quản lý bán hàng",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Hải Đăng" },
  icons: { icon: "/icon-192.png", apple: "/icon-180.png" },
};

export const viewport: Viewport = {
  themeColor: "#0C7B6B",
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
      data-scroll-behavior="smooth"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <Script id="mode-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: MODE_INIT }} />
        <ServiceWorkerRegister />
        <NextIntlClientProvider messages={messages}>
          <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
