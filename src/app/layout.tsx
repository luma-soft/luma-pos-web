import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { getTheme, getMode } from "@/lib/theme/cookie";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { SafariChromeColorSync } from "@/components/safari-chrome-color-sync";
import { ConfirmDialogProvider } from "@/components/confirm-dialog-provider";
import { DismissKeyboardOnOutsidePress } from "@/components/dismiss-keyboard-on-outside-press";
import { DATA_TABLE_FILL_INIT } from "@/lib/data-table-fill";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hải Đăng POS",
  description: "Hải Đăng POS — Quản lý bán hàng",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Hải Đăng POS" },
  icons: { icon: "/icon-192.png", apple: "/icon-180.png" },
};

export const viewport: Viewport = {
  // Initial value (grouped background) for the launch screen; SafariChromeColorSync
  // then follows the visible top surface of each page at runtime.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F2F2F7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
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
        <Script id="data-table-fill-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: DATA_TABLE_FILL_INIT }} />
        <ServiceWorkerRegister />
        <SafariChromeColorSync />
        <NextIntlClientProvider messages={messages}>
          <DismissKeyboardOnOutsidePress />
          <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
