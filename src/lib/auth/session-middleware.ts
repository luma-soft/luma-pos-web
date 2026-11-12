import { NextResponse, type NextRequest } from "next/server";
import { Routes } from "@/lib/routes";
import { ONLINE_SALES_ENABLED } from "@/lib/features";
import { AUTH_SESSION_COOKIE } from "@/lib/auth/provider";
import { getLumaAuthenticatedUser } from "@/lib/auth/lumapos-auth";

export async function updateLumaSession(request: NextRequest) {
  const token = request.cookies.get(AUTH_SESSION_COOKIE)?.value;
  const user = token ? await getLumaAuthenticatedUser(token, "web_session") : null;
  const path = request.nextUrl.pathname;
  const isAuthPath = path.startsWith(Routes.Login) || path.startsWith(Routes.Register);
  const isApiPath = path.startsWith("/api");
  const isPortalPath = path.startsWith("/portal");
  const isPublic =
    isAuthPath ||
    isApiPath ||
    isPortalPath ||
    path === Routes.Home ||
    path === Routes.CameraQuote ||
    path.startsWith(`${Routes.CameraQuote}/`) ||
    path === "/camera-price-list" ||
    path === "/privacy" ||
    path === "/support" ||
    path === Routes.HunonicPriceList ||
    path === Routes.RangDongSmartPriceList;

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = Routes.Login;
    return NextResponse.redirect(url);
  }

  if (user && isAuthPath) {
    const url = request.nextUrl.clone();
    if (ONLINE_SALES_ENABLED && user.email?.toLowerCase() === "review@lumapos.shop") {
      url.pathname = Routes.OnlineSales;
      url.searchParams.set("tab", "overview");
      url.searchParams.set("channel", "shopee");
    } else {
      url.pathname = Routes.Dashboard;
    }
    return NextResponse.redirect(url);
  }

  return NextResponse.next({ request });
}
